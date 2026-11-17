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
        model.chooseAction(state.single.id)
        model.query = "Frozen question"
        let receive = execution.onChange
        execution.onChange = { [weak self] update in
            receive?(update)
            if case .running = update { return }
            if let signal = self?.terminal {
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
        attemptCase("retry freezes the request and keeps the failed result and unrelated draft") { f in
            f.control.generate = { _, _, _ in throw EZError("Provider unavailable") }
            f.model.send()
            try await f.terminal.wait()
            let failed = f.model.selectedEntry!
            f.model.newQuery()
            f.model.chooseAction(f.state.multi.id)
            f.model.setInput("do not send", for: "fuzzy term")
            f.model.setInput("current draft", for: "fuzzy context")
            let draft = f.model.inputValues
            var seen: HistoryEntry?
            f.control.generate = { entry, _, _ in
                seen = entry
                return try response("Recovered")
            }
            f.terminal = CheckSignal()
            f.model.retry(failed.id)
            try await f.terminal.wait()
            let saved = f.model.selectedEntry!
            try expect(saved.id != failed.id, "Retry overwrote the failed attempt")
            try expectEqual(seen?.query, failed.query, "Retry sent the current draft")
            try expectEqual(seen?.actionSnapshot, failed.actionSnapshot, "Retry changed action")
            try expectEqual(seen?.presetSnapshot, failed.presetSnapshot, "Retry changed preset")
            try expectEqual(seen?.connectionSnapshot, failed.connectionSnapshot, "Retry changed connection")
            try expectEqual(f.model.inputValues, draft, "Retry changed the unrelated draft")
            try expectEqual(saved.status, "completed", "Retry did not finish")
            try expectEqual(
                f.model.entries.first { $0.id == failed.id }?.status, "failed", "Failure was lost")
            try expectEqual(f.control.providerCalls, 2, "Retry sent more than one request")
            f.model.retry(saved.id)
            try expectEqual(f.control.providerCalls, 2, "Completed answer offered a retry")
        },
        attemptCase("retry blocks changed routes and failed initial saves without losing the result") { f in
            f.control.generate = { _, _, _ in throw EZError("Provider unavailable") }
            f.model.send()
            try await f.terminal.wait()
            let failed = f.model.selectedEntry!
            var config = f.model.configuration
            config.connections[0].accountId = "different-account"
            try f.model.saveConfiguration(config)
            f.model.retry(failed.id)
            try expect(f.model.retryFailure != nil, "Changed account was accepted")
            try expectEqual(f.control.providerCalls, 1, "Changed route reached provider")
            try f.model.saveConfiguration(f.state.configuration)
            f.control.failedWrites = [3]
            f.model.retry(failed.id)
            try expect(
                f.model.retryFailure?.message.contains("history could not be saved") == true,
                "Initial-save failure was not explained")
            try expectEqual(f.model.selection, failed.id, "Blocked retry changed selected answer")
            try expectEqual(f.control.providerCalls, 1, "Initial-save failure reached provider")
        },
        attemptCase("follow-ups retain earlier context, saved model and the original draft") { f in
            f.model.send()
            try await f.terminal.wait()
            let first = f.model.selectedEntry!
            f.model.followUpDrafts[first.id] = "Why does that happen?"
            f.model.followUpTargetID = first.id
            f.terminal = CheckSignal()
            f.model.performLookupCommand(.send)
            try await f.terminal.wait()
            let second = f.model.selectedEntry!
            try expectEqual(second.parentID, first.id, "Parent link lost")
            try expectEqual(second.displayQuery, "Why does that happen?", "Question not displayed")
            try expect(
                second.query.contains(first.query) && second.query.contains(first.response),
                "Saved context lost")
            try expectEqual(second.model, first.model, "Model changed")
            try expectEqual(f.model.query, "Frozen question", "Original draft changed")
            try expect(f.model.followUpDrafts[first.id] == nil, "Accepted draft not cleared")
            f.terminal = CheckSignal()
            f.model.followUpDrafts[second.id] = "And an example?"
            f.model.followUp(second.id)
            try await f.terminal.wait()
            let third = f.model.selectedEntry!
            try expect(third.query.contains(second.query), "Earlier exchanges lost")
            let loaded = try f.state.history.load()
            try expectEqual(
                loaded.first(where: { $0.id == third.id })?.parentID, second.id, "Parent link did not persist"
            )
            try expectEqual(loaded.count, 3, "Follow-up replaced an earlier answer")
            try expectEqual(f.control.providerCalls, 3, "Unexpected provider request")
        },
        attemptCase("invalid follow-ups and failed initial saves retain the question") { f in
            f.model.send()
            try await f.terminal.wait()
            let first = f.model.selectedEntry!
            for question in ["  ", String(repeating: "x", count: 2_001)] {
                f.model.followUpDrafts[first.id] = question
                f.model.followUp(first.id)
                try expectEqual(f.control.providerCalls, 1, "Invalid follow-up was sent")
            }
            f.model.followUpDrafts[first.id] = "Keep this question"
            f.control.failedWrites = [3]
            f.model.followUp(first.id)
            try expectEqual(f.model.selection, first.id, "Failed submission changed answer")
            try expectEqual(
                f.model.followUpDrafts[first.id], "Keep this question", "Failed submission lost draft")
            try expectEqual(f.control.providerCalls, 1, "Initial-save failure reached provider")
            var unsaved = first
            unsaved.status = "unsaved"
            try expectThrows(EZError.self) {
                _ = try unsaved.prepareFollowUp(
                    "Why?", models: f.model.models, provider: .chatGPTPlan)
            }
            try expectThrows(EZError.self) {
                _ = try first.prepareFollowUp("Why?", models: [], provider: .chatGPTPlan)
            }
            var long = first
            long.query = String(repeating: "x", count: 120_000)
            try expectThrows(EZError.self) {
                _ = try long.prepareFollowUp(
                    "Why?", models: f.model.models, provider: .chatGPTPlan)
            }
            try expectEqual(f.model.selectedEntry?.response, first.response, "Failure lost original answer")
        },
        attemptCase("Run blocks a route changed on disk until the user reviews and runs again") { f in
            var revised = f.model.configuration
            revised.connections[0].accountId = "new-choice"
            try ConfigurationStore(directory: f.state.directory).save(revised)
            f.model.send()
            try expectEqual(f.control.appends.count, 0, "Run bypassed the displayed setup")
            try expect(f.model.error?.contains("setup changed") == true, "Changed setup was silent")
            try expectEqual(f.model.query, "Frozen question", "Changed setup lost the draft")
            try expectEqual(
                f.model.currentConnection?.accountId, "new-choice", "Review did not reveal new route")
            f.model.send()
            try await f.terminal.wait()
            try expectEqual(
                f.model.selectedEntry?.connectionSnapshot?.accountId, "new-choice",
                "Reviewed route not frozen")
            try expectEqual(f.control.providerCalls, 1, "Review sent more than once")
        },
        attemptCase("follow-up blocks a changed connection and preserves the question") { f in
            f.model.send()
            try await f.terminal.wait()
            let first = f.model.selectedEntry!
            f.model.followUpDrafts[first.id] = "Keep this question"
            var config = f.model.configuration
            config.connections[0].accountId = "different-account"
            try f.model.saveConfiguration(config)
            f.model.followUp(first.id)
            try expectEqual(f.model.selection, first.id, "Changed account replaced the original answer")
            try expectEqual(
                f.model.followUpDrafts[first.id], "Keep this question", "Blocked question was lost")
            try expect(f.model.error?.contains("changed") == true, "Changed route was not explained")
            try expectEqual(f.control.appends.count, 2, "Changed account was accepted")
        },
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
            try expectEqual(try f.state.history.load().count, 1, "One attempt became multiple rows")
        },
        attemptCase("launcher waits once for startup, locks competing actions and sends the exact draft") {
            f in
            let startup = CheckSignal()
            let ready = Task { _ = try? await startup.wait() }
            defer { Task { await startup.signal() } }
            let saved = try f.state.savedAnswer()
            try f.state.history.append(saved)
            f.model.refreshHistory()
            try f.model.submitLauncher("A launcher question", after: ready)
            try expect(f.model.launcherPending && !f.model.busy, "Launcher did not wait for startup")
            try expectThrows(EZError.self) { try f.model.submitLauncher("Duplicate", after: ready) }
            try expectThrows(EZError.self) { try f.model.prepareSelectedText("Selected text") }
            f.model.performLookupCommand(.newLookup)
            f.model.chooseAction(f.state.multi.id)
            f.model.deleteLookup(saved.id)
            f.model.fillQuickLookupSelection("Late selection")
            try expectEqual(f.model.query, "A launcher question", "Competing action replaced launcher draft")
            try expectEqual(f.control.appends.count, 0, "Launcher transmitted before startup")
            try expect(
                try f.state.history.load().contains { $0.id == saved.id }, "Launcher deletion lost history")
            await startup.signal()
            try await f.terminal.wait()
            try expect(!f.model.launcherPending && !f.model.busy, "Launcher did not settle")
            try expectEqual(
                f.model.selectedEntry?.displayQuery, "A launcher question", "Launcher sent the wrong draft")
            try expectEqual(f.control.providerCalls, 1, "Launcher did not submit exactly once")
        },
        attemptCase("shutdown cancels a waiting launcher without sending") { f in
            let startup = CheckSignal()
            let ready = Task { _ = try? await startup.wait() }
            try f.model.submitLauncher("Do not send", after: ready)
            f.model.shutdown()
            await startup.signal()
            await ready.value
            try expect(!f.model.launcherPending && !f.model.busy, "Shutdown left launcher work")
            try expectEqual(f.control.appends.count, 0, "Cancelled launcher wrote a request")
        },
        attemptCase("active lookup owns command guards and activity while viewing another answer") { f in
            let saved = try f.state.savedAnswer()
            try f.state.history.append(saved)
            f.model.refreshHistory()
            let held = HeldResponse()
            defer { held.finish(.failure(CancellationError())) }
            f.control.generate = { _, _, update in try await held.stream(update: update) }
            f.model.send()
            try await held.started.wait()
            let id = f.model.selection
            let draft = f.model.query
            var thinking = ResponseAccumulator()
            try thinking.consume(
                Data(#"{"type":"response.output_item.added","item":{"type":"reasoning"}}"#.utf8))
            held.progress(thinking)
            try expectEqual(
                f.model.selectedResponseActivity, .thinking, "No thinking activity for active lookup")
            f.model.selection = saved.id
            try expectEqual(f.model.selectedResponseActivity, nil, "Unrelated answer showed activity")
            f.model.deleteLookup(saved.id)
            try expect(
                try f.state.history.load().contains { $0.id == saved.id }, "Busy deletion removed history")
            try expectThrows(EZError.self) { try f.model.prepareSelectedText("do not replace") }
            try expectThrows(EZError.self) { try f.model.saveConfiguration(Configuration()) }
            f.model.fillQuickLookupSelection("late selection")
            f.model.chooseAction(f.state.multi.id)
            f.model.performLookupCommand(.nextRecipe)
            f.model.performLookupCommand(.newLookup)
            try expectEqual(f.model.currentAction?.id, f.state.single.id, "Active lookup changed action")
            try expectEqual(f.model.query, draft, "Active lookup lost the draft")
            f.model.selection = id
            held.progress(try response("Visible partial", completed: false))
            try expectEqual(f.model.selectedResponseActivity, .responding, "Text did not end thinking")
            f.model.stop()
            try expectEqual(f.model.selectedResponseActivity, nil, "Stop left activity visible")
        },
        attemptCase("immediate Stop prevents credential and provider work") { f in
            f.model.send()
            f.model.stop()
            try await f.terminal.wait()
            try expectEqual(f.control.tokenCalls, 0, "Stopped attempt requested credentials")
            try expectEqual(f.control.providerCalls, 0, "Stopped attempt reached provider")
            try expectEqual(f.model.selectedEntry?.status, "interrupted", "Stop did not publish interruption")
        },
        attemptCase("failed terminal save reports unsaved and a new Run saves a separate attempt") { f in
            f.control.failedWrites = [2]
            f.model.send()
            try await f.terminal.wait()
            guard let unsaved = f.model.selectedEntry else { throw CheckFailure("Missing answer") }
            try expectEqual(unsaved.status, "unsaved", "Failed save claimed completion")
            try expect(
                unsaved.error?.contains("Synthetic history write failure") == true, "Missing save error")
            try expect(!f.model.canRetry(unsaved), "Unsaved answer offered inference retry")
            try expectEqual(
                try f.state.history.load()[0].status, "interrupted", "Terminal save wrote success")
            try expectEqual(f.control.appends.count, 2, "Failed save wrote again")
            f.model.newQuery()
            f.model.query = "A new question"
            f.model.refreshHistory()
            try expectEqual(f.control.providerCalls, 1, "Reading history resubmitted")
            f.terminal = CheckSignal()
            f.model.send()
            try await f.terminal.wait()
            let saved = f.model.selectedEntry!
            try expect(saved.id != unsaved.id, "New Run reused failed save identity")
            try expectEqual(saved.status, "completed", "New Run did not save")
            try expectEqual(f.control.providerCalls, 2, "New Run generated more than once")
            let history = try f.state.history.load()
            try expectEqual(history.count, 2, "New Run replaced the older record")
            try expectEqual(
                history.first { $0.id == saved.id }?.status, "completed", "New completion did not save")
            try expectEqual(
                history.first { $0.id == unsaved.id }?.status, "interrupted", "Failed save rewrote history")
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
            try expect(entry.error?.contains("Synthetic provider failure") == true, "Provider error was lost")
            try expect(
                entry.error?.contains("Synthetic history write failure") == true, "Save error was lost")
            try expectEqual(entry.response, "Partial answer", "Partial output lost")
            try expectEqual(f.control.appends.count, 2, "Terminal write was replayed")
            try expectEqual(f.control.providerCalls, 1, "Failed provider request was replayed")
        },
        attemptCase("Stop retains partial output and ignores old progress during a new attempt") { f in
            let first = HeldResponse()
            let second = HeldResponse()
            defer {
                first.finish(.failure(CancellationError()))
                second.finish(.failure(CancellationError()))
            }
            f.control.generate = { _, _, update in try await first.stream(update: update) }
            f.model.send()
            try await first.started.wait()
            first.progress(try response("Stopped partial", completed: false))
            let firstID = f.model.selection!
            f.model.stop()
            try expectEqual(f.model.selectedEntry?.status, "interrupted", "Stop did not finish")
            try expectEqual(f.model.selectedEntry?.response, "Stopped partial", "Stop lost partial text")
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
        attemptCase("failed delete leaves selected result; successful delete removes its history") { f in
            f.control.failedWrites = [2]
            f.model.send()
            try await f.terminal.wait()
            let id = f.model.selection!
            _ = try historySQL(
                f.state.history.url,
                "CREATE TRIGGER fail_delete BEFORE DELETE ON ez_entry BEGIN SELECT RAISE(ABORT,'Synthetic delete failure'); END"
            )
            f.model.deleteLookup(id)
            try expectEqual(f.model.selection, id, "Failed deletion changed selection")
            try expectEqual(f.model.selectedEntry?.status, "unsaved", "Failed deletion discarded the result")
            _ = try historySQL(f.state.history.url, "DROP TRIGGER fail_delete")
            f.model.deleteLookup(id)
            try expect(f.model.entries.isEmpty && f.model.selection == nil, "Deleted lookup still visible")
            try expect(try f.state.history.load().isEmpty, "Deleted lookup remained in storage")
            try expectEqual(f.control.appends.count, 2, "Deletion replayed a history write")
        },
        attemptCase("reload reflects only persisted bytes and never resubmits") { f in
            f.control.failedWrites = [2]
            f.model.send()
            try await f.terminal.wait()
            let loaded = try f.state.history.load()
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
            enum Output: String, Decodable { case present, absent, optional }
            let output: Output
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
        guard contract.version == 2, !contract.cases.isEmpty,
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
                let saved = try f.state.history.load().first
                try expectEqual(f.control.providerCalls, scenario.expected.providerCalls, "Provider count")
                if scenario.expected.output != .optional {
                    try expectEqual(
                        !(entry?.response ?? "").isEmpty, scenario.expected.output == .present,
                        "Visible output")
                }
                try expectEqual(
                    entry?.status == "completed" && saved?.status == "completed",
                    scenario.expected.savedSuccess, "Saved success")
            }
        }
    } catch {
        return [CheckCase("attempt: shared contract fixture") { _ in throw error }]
    }
}
