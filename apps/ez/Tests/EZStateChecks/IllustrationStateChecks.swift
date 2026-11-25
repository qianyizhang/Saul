import Combine
import EZCheckSupport
import EZCore
import Foundation
import SaulNativeValues
import SaulTestSupport

@testable import EZApplication

private actor IllustrationKeyFixture: OpenAIKeyStorage {
    var key: String? = "sk-offline-fixture"
    var failWrites = false
    func read() -> String? { key }
    func write(_ key: String?) throws {
        if failWrites { throw EZError("Synthetic Keychain write failure") }
        self.key = key
    }
    func setFailure(_ value: Bool) { failWrites = value }
}

@MainActor private final class HeldImage {
    let started = CheckSignal()
    let returned = CheckSignal()
    var continuation: CheckedContinuation<Void, Never>?
    func generate() async -> AttemptExecution.Output {
        await withCheckedContinuation {
            continuation = $0
            Task { await started.signal() }
        }
        defer { Task { await returned.signal() } }
        return .image(fixturePNG)
    }
    func finish() {
        continuation?.resume()
        continuation = nil
    }
}

@MainActor private func completionSignal(_ model: AppModel) -> (CheckSignal, AnyCancellable) {
    let signal = CheckSignal()
    let observer = model.$runningAttempt.dropFirst().filter { $0 == nil }.sink { _ in
        Task { await signal.signal() }
    }
    return (signal, observer)
}

@MainActor private func imageModel(
    _ directory: URL, connections: FixtureConnections? = nil, generate: @escaping AttemptExecution.Generation
) throws
    -> AppModel
{
    var config = Configuration.starters(model: "fixture", effort: "low", fast: false)
    config.bindFixtureAccount()
    config.addIllustration()
    for index in config.presets.indices where config.presets[index].capability == .draw {
        config.presets[index].model = "gpt-image-2.6-flare"
    }
    try ConfigurationStore(directory: directory).save(config)
    let store = try HistoryStore(directory: directory)
    let execution = AttemptExecution(
        generate: generate, append: { try store.append($0) }, delete: { try store.discardPending($0) })
    let model = fixtureModel(directory: directory, attemptExecution: execution, connections: connections)
    model.chooseAction(config.actions.first { $0.capability == .draw }!.id)
    model.query = "Trees share nutrients. 中文\n"
    return model
}

@MainActor func illustrationStateChecks() -> [CheckCase] {
    [
        CheckCase("action: connection key failures preserve credential and configuration without generation")
        {
            directory in
            let keys = IllustrationKeyFixture()
            let fixtures = FixtureConnections()
            let model = fixtureModel(
                directory: directory, connections: fixtures,
                client: .init(
                    saveKey: { _, key in
                        try await keys.write(key)
                        fixtures.apiConnected = true
                    },
                    keyStatus: { connection in
                        ConnectionStatus(connected: fixtures.apiConnected, endpoint: connection.endpoint)
                    },
                    removeKey: { _ in
                        try await keys.write(nil)
                        fixtures.apiConnected = false
                    }))
            defer { model.shutdown() }
            let existingKey = await keys.read()
            try expectEqual(existingKey, "sk-offline-fixture", "Fixture has no existing key")
            let connection = ConnectionDefinition.defaults[1]
            await keys.setFailure(true)
            try await expectAsyncThrows(EZError.self) {
                try await model.saveConnection(connection, previous: connection, key: "sk-replacement")
            }
            try expect(
                model.connectionStatus(connection.key)?.connected == true,
                "Failed save lost the existing connection")
            try await expectAsyncThrows(EZError.self) {
                try await model.removeConnectionCredential(connection)
            }
            try expect(
                model.connectionStatus(connection.key)?.connected == true,
                "Failed removal disconnected the credential")
            await keys.setFailure(false)
            guard let pending = model.pendingConnectionSetup else {
                throw CheckFailure("Failed save lost the pending setup")
            }
            try await model.resumeConnectionSetup(pending.id, phase: pending.phase, key: "sk-replacement")
            try await model.removeConnectionCredential(connection)
            try expect(
                model.connectionStatus(connection.key)?.connected == false && model.entries.isEmpty,
                "Connection setup generated work")
        },
        CheckCase("action: runtime GIF format freezes in history and reuse without changing preset defaults")
        { directory in
            var seen: HistoryEntry?
            let model = try imageModel(
                directory,
                generate: { entry, _ in
                    seen = entry
                    return .image(fixturePNG)
                })
            defer { model.shutdown() }
            let id = model.currentPreset!.id
            model.chooseOutputFormat("gif")
            let (done, observer) = completionSignal(model)
            defer { observer.cancel() }
            model.send()
            try await done.wait()
            try expectEqual(
                seen?.presetSnapshot?.imageOptions?.outputFormat, "gif", "Runtime format was not frozen")
            try expectEqual(
                model.configuration.presets.first { $0.id == id }?.imageOptions?.outputFormat, "png",
                "Runtime override mutated the preset")
            await model.reuse(model.selectedEntry!)?.value
            try expectEqual(model.outputFormat, "gif", "Reuse lost the frozen output format")
            model.newQuery()
            try expectEqual(model.outputFormatOverride, nil, "New run retained an old override")
        },
        CheckCase("action: Draw shares frozen inputs history and one active request") { directory in
            let held = HeldImage()
            var calls = 0
            let model = try imageModel(
                directory,
                generate: { _, _ in
                    calls += 1
                    return await held.generate()
                })
            defer {
                model.shutdown()
                held.finish()
            }
            let (done, observer) = completionSignal(model)
            defer { observer.cancel() }
            try expect(model.canSend, "Configured Draw action cannot run while signed out of ChatGPT")
            model.send()
            try await held.started.wait()
            model.send()
            model.query = "Changed draft"
            held.finish()
            try await done.wait()
            let entry = model.selectedEntry!
            try expectEqual(calls, 1, "Duplicate Run started more work")
            try expectEqual(
                entry.inputValues?["context"], "Trees share nutrients. 中文\n", "Frozen image inputs changed")
            try expectEqual(entry.connectionSnapshot?.key, "openai-api", "Connection key not frozen")
            try expectEqual(entry.status, "completed", "Image result not saved")
            try expectEqual(model.query, "Changed draft", "Completion cleared draft")
            let saved = try HistoryStore(directory: directory).load()[0]
            try expectEqual(
                try HistoryStore(directory: directory).image(for: saved), fixturePNG, "Saved PNG missing")
            model.newQuery()
            model.selection = saved.id
            try expectEqual(
                model.selectedEntry?.id, entry.id, "Image unavailable through shared History selection")
        },
        CheckCase("action: image save failure reports unsaved and keeps Download available") { directory in
            var calls = 0
            let model = try imageModel(
                directory,
                generate: { _, _ in
                    calls += 1
                    return .image(fixturePNG)
                })
            defer { model.shutdown() }
            _ = try historySQL(
                directory.appendingPathComponent("history.sqlite3"),
                "CREATE TRIGGER fail_save BEFORE UPDATE ON ez_entry WHEN json_extract(NEW.data,'$.status') != 'pending' BEGIN SELECT RAISE(ABORT,'Synthetic final save failure'); END"
            )
            let (done, observer) = completionSignal(model)
            defer { observer.cancel() }
            model.send()
            try await done.wait()
            let entry = model.selectedEntry!
            try expectEqual(entry.status, "unsaved", "Failed PNG write reported saved")
            try expectEqual(
                model.imageData(for: entry), fixturePNG, "Current unsaved PNG could not be downloaded")
            try expect(
                entry.error?.contains("Synthetic final save failure") == true, "Image save error hidden")
            let saved = try HistoryStore(directory: directory).load()[0]
            try expectEqual(saved.status, "interrupted", "Failed save marked the image complete")
            try expectEqual(
                try HistoryStore(directory: directory).image(for: saved), nil, "Failed save had bytes")
            try expectEqual(calls, 1, "Failed save generated another image")
        },
        CheckCase("action: Stop ignores late Draw output during a replacement run") { directory in
            let first = HeldImage()
            let second = HeldImage()
            var calls = 0
            let model = try imageModel(
                directory,
                generate: { _, _ in
                    calls += 1
                    return await (calls == 1 ? first : second).generate()
                })
            defer {
                model.shutdown()
                first.finish()
                second.finish()
            }
            model.send()
            try await first.started.wait()
            let oldID = model.selection!
            let (stopped, stopObserver) = completionSignal(model)
            model.stop()
            try await stopped.wait()
            stopObserver.cancel()
            model.newQuery()
            model.query = "Second"
            let (done, observer) = completionSignal(model)
            defer { observer.cancel() }
            model.send()
            try await second.started.wait()
            first.finish()
            try await first.returned.wait()
            try expect(
                model.busy && model.selectedEntry?.hasImage == false,
                "Late output replaced the active request")
            second.finish()
            try await done.wait()
            try expectEqual(
                model.selectedEntry?.inputValues?["context"], "Second", "Replacement image did not finish")
            let store = try HistoryStore(directory: directory)
            let old = try store.load().first { $0.id == oldID }!
            try expect(try store.image(for: old) == nil, "Cancelled image was saved late")
        },
        CheckCase("action: incompatible presets connections and missing API keys block before execution") {
            directory in
            var calls = 0
            let fixtures = FixtureConnections()
            let model = try imageModel(
                directory, connections: fixtures,
                generate: { _, _ in
                    calls += 1
                    return .image(fixturePNG)
                })
            defer { model.shutdown() }
            fixtures.apiConnected = false
            model.send()
            try expect(!model.canSend && calls == 0, "Missing API key sent a request")
            fixtures.apiConnected = true
            let write = model.configuration.presets.first { $0.capability == .write }!
            model.chooseLookupPreset(write.id)
            try expectEqual(model.currentPreset?.capability, .draw, "Chooser selected Write for Draw")
            var unavailable = model.configuration
            unavailable.connections.removeAll { $0.key == "openai-api" }
            try model.saveConfiguration(unavailable)
            model.send()
            try expect(
                !model.canSend && calls == 0 && model.connectionIssue != nil,
                "Unavailable provider silently selected a different connection")
        },
    ]
}
