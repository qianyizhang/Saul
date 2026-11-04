import Combine
import EZCheckSupport
import EZCore
import Foundation

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
    let observer = model.$busy.dropFirst().filter { !$0 }.sink { _ in Task { await signal.signal() } }
    return (signal, observer)
}

@MainActor private func imageModel(_ directory: URL, generate: @escaping AttemptExecution.Generation) throws
    -> AppModel
{
    var config = Configuration.starters(model: "fixture", effort: "low", fast: false)
    config.addIllustration()
    try ConfigurationStore(directory: directory).save(config)
    let store = try HistoryStore(directory: directory)
    let execution = AttemptExecution(generate: generate, append: { try store.append($0) })
    let model = AppModel(directory: directory, offline: true, attemptExecution: execution)
    model.apiConnected = true
    model.chooseAction(config.actions.first { $0.capability == .draw }!.id)
    model.query = "Trees share nutrients. 中文\n"
    return model
}

@MainActor func illustrationStateChecks() -> [CheckCase] {
    [
        CheckCase("action: provider key failures preserve credential and editor draft without generation") {
            directory in
            let keys = IllustrationKeyFixture()
            let model = AppModel(directory: directory, offline: true, apiKeyStore: keys)
            defer { model.shutdown() }
            await model.restoreAPIKey()
            try expect(model.apiConnected, "Existing API key did not restore")
            model.apiKeyDraft = "sk-replacement"
            await keys.setFailure(true)
            await model.saveAPIKey()
            try expect(
                model.apiConnected && model.apiKeyDraft == "sk-replacement",
                "Failed save lost the connection or draft")
            await model.removeAPIKey()
            try expect(
                model.apiConnected && model.apiKeyError != nil, "Failed removal disconnected or hid the error"
            )
            await keys.setFailure(false)
            await model.saveAPIKey()
            try expect(
                model.apiKeyDraft.isEmpty && model.apiKeyError == nil,
                "Successful save kept a secret in the editor")
            await model.removeAPIKey()
            try expect(!model.apiConnected && model.entries.isEmpty, "Provider editing generated work")
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
            try expectEqual(entry.providerSnapshot?.key, "openai-api", "Provider key not frozen")
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
        CheckCase("action: image save failure retains PNG and Save again never resends") { directory in
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
                "CREATE TRIGGER fail_save BEFORE INSERT ON ez_entry WHEN json_extract(NEW.data,'$.status') != 'pending' BEGIN SELECT RAISE(ABORT,'Synthetic final save failure'); END"
            )
            let (done, observer) = completionSignal(model)
            defer { observer.cancel() }
            model.send()
            try await done.wait()
            let id = model.selection!
            try expectEqual(model.selectedEntry?.status, "unsaved", "Failed PNG write reported saved")
            try expectEqual(model.selectedEntry?.imageData, fixturePNG, "Unsaved PNG was lost")
            try expect(model.saveError(for: id) != nil, "Image persistence error hidden")
            model.newQuery()
            model.selection = id
            _ = try historySQL(directory.appendingPathComponent("history.sqlite3"), "DROP TRIGGER fail_save")
            model.saveAgain(id)
            try expectEqual(model.selectedEntry?.status, "completed", "Save-only recovery failed")
            try expectEqual(calls, 1, "Save-only recovery generated another image")
            let saved = try HistoryStore(directory: directory).load()[0]
            try expectEqual(
                try HistoryStore(directory: directory).image(for: saved), fixturePNG,
                "Recovery did not save original PNG")
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
            model.stop()
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
        CheckCase("action: incompatible presets providers and missing API keys block before execution") {
            directory in
            var calls = 0
            let model = try imageModel(
                directory,
                generate: { _, _ in
                    calls += 1
                    return .image(fixturePNG)
                })
            defer { model.shutdown() }
            model.apiConnected = false
            model.send()
            try expect(!model.canSend && calls == 0, "Missing API key sent a request")
            model.apiConnected = true
            model.choosePreset(model.configuration.presets.first { $0.capability == .write }!.id)
            try expect(
                !model.canSend && model.requestIssue?.contains("Draw") == true,
                "Write preset accepted for Draw action")
            try expect(
                model.compatiblePresets.allSatisfy { $0.capability == .draw },
                "Incompatible preset offered for Draw")
            model.choosePreset(model.configuration.presets.first { $0.capability == .draw }!.id)
            var unavailable = model.configuration
            unavailable.providers.removeAll { $0.key == "openai-api" }
            try model.saveConfiguration(unavailable)
            model.send()
            try expect(
                !model.canSend && calls == 0 && model.providerIssue != nil,
                "Unavailable provider silently selected a different connection")
        },
    ]
}
