import EZCheckSupport
import EZCore
import Foundation

@MainActor private func response(_ text: String, completed: Bool = true) throws -> ResponseAccumulator {
    var result = ResponseAccumulator()
    try result.consume(
        JSONSerialization.data(withJSONObject: ["type": "response.output_text.delta", "delta": text]),
        elapsedSeconds: 0.2)
    if completed {
        try result.consume(
            JSONSerialization.data(withJSONObject: [
                "type": "response.completed",
                "response": [
                    "status": "completed", "service_tier": "default",
                    "usage": ["input_tokens": 3, "output_tokens": 4],
                ],
            ]), elapsedSeconds: 0.8)
    }
    return result
}

/// Deliberately ignores task cancellation so late provider callbacks can be tested.
@MainActor private final class HeldResponse {
    let started = CheckSignal()
    let returned = CheckSignal()
    private var completion: CheckedContinuation<Void, Never>?
    private var result: Result<ResponseAccumulator, Error>?
    private var update: (@MainActor (ResponseAccumulator) -> Void)?

    func stream(update: @escaping @MainActor (ResponseAccumulator) -> Void) async throws
        -> ResponseAccumulator
    {
        self.update = update
        defer { Task { await returned.signal() } }
        await withCheckedContinuation {
            completion = $0
            Task { await started.signal() }
        }
        guard let result else { throw CheckFailure("Held response released without an outcome") }
        return try result.get()
    }
    func progress(_ result: ResponseAccumulator) { update?(result) }
    func finish(_ result: Result<ResponseAccumulator, Error>) {
        self.result = result
        completion?.resume()
        completion = nil
    }
}

@MainActor private final class AttemptFixture {
    let state: StateFixture
    let execution: AttemptExecution
    let control: Control
    var terminal = CheckSignal()
    var model: AppModel { state.model }

    @MainActor final class Control {
        let history: HistoryStore
        var tokenCalls = 0
        var providerCalls = 0
        var appends: [HistoryEntry] = []
        var failedWrites: Set<Int> = []
        var writeBeforeFailure = false
        var beforeAppend: ((HistoryEntry) -> Void)?
        var generate: AttemptExecution.Stream = { _, _, update in
            let result = try response("Frozen answer")
            update(result)
            return result
        }
        init(history: HistoryStore) { self.history = history }
        func append(_ entry: HistoryEntry) throws {
            appends.append(entry)
            beforeAppend?(entry)
            if failedWrites.contains(appends.count) {
                if writeBeforeFailure { try history.append(entry) }
                throw EZError("Synthetic history write failure")
            }
            try history.append(entry)
        }
    }

    init(directory: URL) throws {
        let control = Control(history: try HistoryStore(directory: directory))
        self.control = control
        execution = AttemptExecution(
            accessToken: {
                control.tokenCalls += 1
                return "synthetic-token"
            },
            stream: { entry, token, update in
                control.providerCalls += 1
                return try await control.generate(entry, token, update)
            },
            append: { try control.append($0) })
        state = try StateFixture(directory: directory, attemptExecution: execution)
        model.signedIn = true
        model.planEnabled = true
        model.chooseRecipe(state.single.id)
        model.query = "Frozen question"
        let receive = execution.onChange
        execution.onChange = { [weak self] update in
            receive?(update)
            if !update.isActive, let signal = self?.terminal {
                Task { await signal.signal() }
            }
        }
    }
}

@MainActor private func attemptCase(
    _ name: String, _ body: @escaping @MainActor (AttemptFixture) async throws -> Void
) -> CheckCase {
    CheckCase("attempt: " + name) { directory in
        let fixture = try AttemptFixture(directory: directory)
        defer {
            fixture.model.shutdown()
            fixture.control.beforeAppend = nil
        }
        try await body(fixture)
    }
}

@MainActor func attemptStateChecks() -> [CheckCase] {
    [
        attemptCase("initial save failure prevents credential and provider work") { f in
            f.control.failedWrites = [1]
            try expect(f.model.canSend, "Controlled execution should be available")
            f.model.send()
            try expectEqual(f.control.tokenCalls, 0, "Credentials requested before initial save")
            try expectEqual(f.control.providerCalls, 0, "Provider started before initial save")
            try expect(!f.model.busy && f.model.entries.isEmpty, "Failed submission changed attempt state")
            try expect(f.model.error?.contains("Query not sent") == true, "Missing submission failure")
        },
        attemptCase("saved completion publishes only after terminal persistence") { f in
            var visibleDuringWrite: String?
            f.control.beforeAppend = { entry in
                if entry.status == "completed" { visibleDuringWrite = f.model.selectedEntry?.status }
            }
            f.model.send()
            try await f.terminal.wait()
            try expectEqual(visibleDuringWrite, "pending", "Completion published before save")
            try expectEqual(f.model.selectedEntry?.status, "completed", "Saved outcome missing")
            try expectEqual(f.model.selectedEntry?.response, "Frozen answer", "Answer lost")
            try expectEqual(try f.state.history.load().entries.count, 1, "One attempt became multiple rows")
        },
        attemptCase("immediate Stop prevents credential and provider work") { f in
            f.model.send()
            f.model.stop()
            try await f.terminal.wait()
            try expectEqual(f.control.tokenCalls, 0, "Stopped attempt requested credentials")
            try expectEqual(f.control.providerCalls, 0, "Stopped attempt reached provider")
            try expectEqual(f.model.selectedEntry?.status, "interrupted", "Stop did not publish interruption")
        },
        attemptCase("unsaved answer survives navigation and retries only its exact final save") { f in
            f.control.failedWrites = [2, 3]
            f.model.send()
            try await f.terminal.wait()
            guard let unsaved = f.model.selectedEntry else { throw CheckFailure("Missing answer") }
            try expectEqual(unsaved.status, "unsaved", "Failed save claimed completion")
            try expectEqual(
                f.model.saveError(for: unsaved.id), "Synthetic history write failure", "Missing attempt error"
            )
            try expect(f.model.storageWarning == nil, "Save failure became a dismissible global warning")
            let terminal = f.control.appends[1]
            f.model.newQuery()
            f.model.query = "A newer draft"
            f.model.selection = unsaved.id
            try expectEqual(f.model.selectedEntry, unsaved, "Navigation lost the unsaved answer")
            f.model.saveAgain(unsaved.id)
            try expectEqual(f.model.selectedEntry?.status, "unsaved", "Failed retry lost recovery")
            f.model.saveAgain(unsaved.id)
            try expectEqual(
                f.model.selectedEntry, terminal, "Save retry changed the frozen terminal snapshot")
            try expectEqual(f.model.query, "A newer draft", "Save retry changed the composer")
            try expectEqual(f.control.appends[2], terminal, "First retry did not append exact snapshot")
            try expectEqual(f.control.appends[3], terminal, "Second retry did not append exact snapshot")
            try expectEqual(f.control.tokenCalls, 1, "Save retry reacquired credentials")
            try expectEqual(f.control.providerCalls, 1, "Save retry regenerated")
            try expect(f.model.saveError(for: unsaved.id) == nil, "Successful save retained error")
            f.model.saveAgain(unsaved.id)
            f.model.saveAgain(UUID())
            try expectEqual(f.control.appends.count, 4, "Repeated recovery appended again")
            try expectEqual(try f.state.history.load().entries.count, 1, "Retries duplicated lookup identity")
        },
        attemptCase("uncertain append retry retains one historical lookup") { f in
            f.control.failedWrites = [2]
            f.control.writeBeforeFailure = true
            f.model.send()
            try await f.terminal.wait()
            guard let entry = f.model.selectedEntry else { throw CheckFailure("Missing unsaved answer") }
            try expectEqual(entry.status, "unsaved", "Ambiguous write claimed success")
            f.model.saveAgain(entry.id)
            let loaded = try f.state.history.load().entries
            try expectEqual(loaded.count, 1, "Ambiguous write retry duplicated lookup")
            try expectEqual(loaded[0].response, "Frozen answer", "Retry lost answer")
            try expectEqual(loaded[0].status, "completed", "Retry did not retain terminal status")
        },
        attemptCase("multiple unsaved attempts recover independently of current selection") { f in
            f.control.failedWrites = [2, 4]
            f.model.send()
            try await f.terminal.wait()
            guard let firstID = f.model.selection else { throw CheckFailure("Missing first attempt") }
            f.terminal = CheckSignal()
            f.model.newQuery()
            f.model.query = "Second unsaved question"
            f.model.send()
            try await f.terminal.wait()
            guard let secondID = f.model.selection else { throw CheckFailure("Missing second attempt") }
            f.model.selection = firstID
            f.model.saveAgain(secondID)
            try expectEqual(f.model.selection, firstID, "Saving another attempt changed selection")
            try expectEqual(
                f.model.selectedEntry?.status, "unsaved", "Saving another attempt changed this outcome")
            try expect(
                f.model.saveError(for: firstID) != nil, "Saving another attempt discarded this recovery")
            try expect(f.model.saveError(for: secondID) == nil, "Target attempt did not recover")
            f.model.saveAgain(firstID)
            try expect(f.model.entries.allSatisfy { $0.status == "completed" }, "Independent recovery failed")
            try expectEqual(f.control.providerCalls, 2, "Recovery regenerated an attempt")
        },
        attemptCase("provider failure and partial output survive failed terminal save") { f in
            f.control.failedWrites = [2]
            f.control.generate = { _, _, update in
                update(try response("Partial answer", completed: false))
                throw EZError("Synthetic provider failure")
            }
            f.model.send()
            try await f.terminal.wait()
            guard let entry = f.model.selectedEntry else { throw CheckFailure("Missing failure") }
            try expectEqual(entry.status, "unsaved", "Unpersisted provider failure marked saved")
            try expectEqual(
                entry.error, "Synthetic provider failure", "Provider error replaced by save error")
            try expectEqual(entry.response, "Partial answer", "Partial output lost")
            f.model.saveAgain(entry.id)
            try expectEqual(f.model.selectedEntry?.status, "failed", "Original terminal failure lost")
            try expectEqual(f.model.selectedEntry?.error, entry.error, "Original provider error changed")
            try expectEqual(f.control.providerCalls, 1, "Recovery resent provider failure")
        },
        attemptCase("Stop retains partial output and ignores old progress during a new attempt") { f in
            let first = HeldResponse()
            let second = HeldResponse()
            defer {
                first.finish(.failure(CancellationError()))
                second.finish(.failure(CancellationError()))
            }
            f.control.failedWrites = [2]
            f.control.generate = { _, _, update in try await first.stream(update: update) }
            f.model.send()
            try await first.started.wait()
            first.progress(try response("Stopped partial", completed: false))
            let firstID = f.model.selection!
            f.model.stop()
            try expectEqual(f.model.selectedEntry?.status, "unsaved", "Stopped save failure not retained")
            try expectEqual(f.model.selectedEntry?.response, "Stopped partial", "Stop lost partial text")
            f.model.saveAgain(firstID)
            try expectEqual(f.model.selectedEntry?.status, "interrupted", "Recovery changed stopped outcome")
            f.terminal = CheckSignal()
            f.control.generate = { _, _, update in try await second.stream(update: update) }
            f.model.newQuery()
            f.model.query = "Second question"
            f.model.send()
            try await second.started.wait()
            let secondID = f.model.selection!
            first.progress(try response("Late old answer"))
            first.finish(.success(try response("Late old answer")))
            try await first.returned.wait()
            try expect(f.model.busy, "Late completion stopped the new attempt")
            try expectEqual(f.model.selection, secondID, "Late completion changed selection")
            try expectEqual(f.model.selectedEntry?.response, "", "Late progress entered the new attempt")
            second.finish(.success(try response("Second answer")))
            try await f.terminal.wait()
            try expectEqual(f.model.selectedEntry?.response, "Second answer", "New attempt did not complete")
            try expectEqual(
                f.model.entries.first(where: { $0.id == firstID })?.response, "Stopped partial",
                "Late callbacks rewrote stopped answer")
        },
        attemptCase("stream ending without completion is not a successful answer") { f in
            f.control.generate = { _, _, _ in
                let partial = try response("Only partial", completed: false)
                return partial
            }
            f.model.send()
            try await f.terminal.wait()
            try expectEqual(f.model.selectedEntry?.status, "failed", "Missing completion was accepted")
            try expectEqual(f.model.selectedEntry?.response, "Only partial", "Incomplete stream lost output")
        },
        attemptCase("failed delete preserves unsaved recovery and successful delete removes it") { f in
            f.control.failedWrites = [2]
            f.model.send()
            try await f.terminal.wait()
            let id = f.model.selection!
            let bytes = try Data(contentsOf: f.state.history.url)
            try FileManager.default.removeItem(at: f.state.history.url)
            try FileManager.default.createDirectory(
                at: f.state.history.url, withIntermediateDirectories: false)
            f.model.deleteLookup(id)
            try expectEqual(f.model.selection, id, "Failed deletion changed selection")
            try expect(f.model.saveError(for: id) != nil, "Failed deletion discarded unsaved recovery")
            try FileManager.default.removeItem(at: f.state.history.url)
            try bytes.write(to: f.state.history.url)
            f.model.deleteLookup(id)
            try expect(f.model.entries.isEmpty && f.model.selection == nil, "Deleted lookup still visible")
            try expect(f.model.saveError(for: id) == nil, "Deleted lookup retained recovery state")
            f.model.saveAgain(id)
            try expectEqual(f.control.appends.count, 2, "Recovery recreated a deleted lookup")
        },
        attemptCase("reload reflects only persisted bytes and never resubmits") { f in
            f.control.failedWrites = [2]
            f.model.send()
            try await f.terminal.wait()
            let loaded = try f.state.history.load().entries
            try expectEqual(loaded.count, 1, "Initial record lost")
            try expectEqual(loaded[0].status, "interrupted", "Pending restart outcome changed")
            try expectEqual(loaded[0].response, "", "Reload invented unpersisted output")
            try expectEqual(f.control.providerCalls, 1, "Reload resubmitted")
        },
    ] + sharedAttemptChecks()
}

private struct AttemptContract: Decodable {
    struct Scenario: Decodable {
        enum Outcome: String, Decodable { case complete, error, eof, cancel }
        struct Expected: Decodable {
            let providerCalls: Int
            let hasOutput: Bool
            let savedSuccess: Bool
        }
        let id: String
        let text: String
        let providerOutcome: Outcome
        let initialSaveFails: Bool
        let finalSaveFails: Bool
        let expected: Expected
    }
    let version: Int
    let cases: [Scenario]
}

@MainActor private func sharedAttemptChecks() -> [CheckCase] {
    do {
        let fixture = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../../contracts/fixtures/attempts.json")
            .standardizedFileURL
        let contract = try JSONDecoder().decode(AttemptContract.self, from: Data(contentsOf: fixture))
        guard contract.version == 1, !contract.cases.isEmpty,
            Set(contract.cases.map(\.id)).count == contract.cases.count
        else { throw CheckFailure("Invalid shared attempt contract") }
        return contract.cases.map { scenario in
            attemptCase("shared contract / " + scenario.id) { f in
                f.control.failedWrites = scenario.initialSaveFails ? [1] : scenario.finalSaveFails ? [2] : []
                let held = HeldResponse()
                defer { held.finish(.failure(CancellationError())) }
                f.control.generate = { _, _, update in
                    if scenario.providerOutcome == .cancel { return try await held.stream(update: update) }
                    let result = try response(scenario.text, completed: scenario.providerOutcome == .complete)
                    update(result)
                    if scenario.providerOutcome == .error { throw EZError("Synthetic provider failure") }
                    return result
                }
                f.model.send()
                if !scenario.initialSaveFails {
                    if scenario.providerOutcome == .cancel {
                        try await held.started.wait()
                        held.progress(try response(scenario.text, completed: false))
                        f.model.stop()
                        held.finish(.failure(CancellationError()))
                        try await held.returned.wait()
                    }
                    try await f.terminal.wait()
                }
                let entry = f.model.selectedEntry
                let saved = try f.state.history.load().entries.first
                try expectEqual(f.control.providerCalls, scenario.expected.providerCalls, "Provider count")
                try expectEqual(
                    !(entry?.response ?? "").isEmpty, scenario.expected.hasOutput, "Retained output")
                try expectEqual(
                    entry?.status == "completed" && saved?.status == "completed",
                    scenario.expected.savedSuccess, "Saved success")
            }
        }
    } catch {
        return [CheckCase("attempt: shared contract fixture") { _ in throw error }]
    }
}
