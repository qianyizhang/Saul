import EZCheckSupport
import EZCore
import Foundation

@MainActor func historyStateChecks() -> [CheckCase] {
    [
        stateCase("deletion persists clears selection and preserves composer draft") { f in
            let entry = try f.selectLookup()
            let draft = f.model.inputValues
            f.model.deleteLookup(entry.recordID)
            try expect(
                f.model.entries.isEmpty && f.model.selection == nil,
                "Successful deletion left lookup selected")
            try expect(f.model.inputValues == draft, "Deletion discarded draft")
            try expect(try f.history.load().isEmpty, "Deletion did not persist")
        },
        stateCase("failed deletion keeps lookup selection and draft and displays error") { f in
            let entry = try f.selectLookup()
            let draft = f.model.inputValues
            try FileManager.default.removeItem(at: f.history.url)
            try FileManager.default.createDirectory(at: f.history.url, withIntermediateDirectories: true)
            f.model.deleteLookup(entry.recordID)
            try expect(
                f.model.entries == [entry] && f.model.selection == entry.id,
                "Failed deletion removed visible lookup")
            try expect(
                f.model.inputValues == draft && f.model.error != nil,
                "Failed deletion hid error or discarded draft")
        },
        CheckCase("state: locked history refresh yields, preserves selection and recovers on the next focus")
        {
            directory in
            let store = try HistoryStore(directory: directory)
            let entry = HistoryEntry(
                mode: .ask, query: "Previously loaded", model: "m", effort: "", requestedServiceTier: nil)
            try store.append(entry)
            let reader = HistoryReader(directory: directory)
            let readStarted = CheckSignal()
            let model = AppModel(
                directory: directory, offline: true,
                readHistory: {
                    let reading = Task.detached {
                        await readStarted.signal()
                        return try await reader.load()
                    }
                    return try await reading.value
                })
            defer { model.shutdown() }
            model.entries = [entry]
            model.selection = entry.id
            let writer = try HistoryFixtureWriter(store.url, reservation: .exclusive)
            guard let refresh = model.refreshHistory() else { throw CheckFailure("No history refresh") }
            try await readStarted.wait()
            try expect(model.storageWarning == nil, "The main actor stopped responding during a read")
            model.query = "Draft edited while history was locked"
            await refresh.value
            try expect(model.storageWarning?.contains("locked") == true, "Read failure was not reported")
            try expectEqual(model.selection, entry.id, "Read failure cleared selection")
            try expectEqual(model.entries.map(\.id), [entry.id], "Read failure replaced saved history")
            try writer.run("ROLLBACK")
            await model.refreshHistory()?.value
            try expect(model.storageWarning == nil, "Successful refresh left a stale warning")
            try expectEqual(model.selection, entry.id, "Recovery lost selection")
            try expectEqual(model.query, "Draft edited while history was locked", "Recovery lost the draft")
        },
        CheckCase("state: a late history refresh cannot resurrect a successfully deleted row") { directory in
            let store = try HistoryStore(directory: directory)
            let saved = HistoryEntry(
                mode: .ask, query: "Target", model: "m", effort: "", requestedServiceTier: nil)
            try store.append(saved)
            let readStarted = CheckSignal()
            var release: CheckedContinuation<[HistoryEntry], Never>?
            let model = AppModel(
                directory: directory, offline: true,
                readHistory: {
                    await withCheckedContinuation {
                        release = $0
                        Task { await readStarted.signal() }
                    }
                })
            defer {
                release?.resume(returning: [])
                model.shutdown()
            }
            model.entries = [saved]
            model.selection = saved.id
            guard let pending = model.refreshHistory() else { throw CheckFailure("No history refresh") }
            try await readStarted.wait()
            model.deleteLookup(saved.recordID)
            release?.resume(returning: [saved])
            release = nil
            await pending.value
            try expect(
                model.entries.isEmpty && model.selection == nil, "A stale reply resurrected a deletion")
            try expect(try store.load().isEmpty, "Deletion did not persist")
        },
        CheckCase("state: terminal lookup preserves the first history load and newer attempt state") {
            directory in
            for failsSave in [false, true] {
                let fixture = directory.appendingPathComponent(failsSave ? "unsaved" : "saved")
                let store = try HistoryStore(directory: fixture)
                let old = HistoryEntry(
                    mode: .ask, query: "Earlier", model: "m", effort: "", requestedServiceTier: nil)
                try store.append(old)
                let startupSnapshot = try store.load()
                let execution = AttemptExecution(
                    generate: { _, _ in
                        var result = ResponseAccumulator()
                        try result.consume(
                            Data(#"{"type":"response.output_text.delta","delta":"Latest answer"}"#.utf8))
                        try result.consume(
                            Data(#"{"type":"response.completed","response":{"status":"completed"}}"#.utf8))
                        return .text(result)
                    },
                    append: { entry in
                        if failsSave, entry.status != "pending" { throw EZError("Fixture save failed") }
                        try store.append(entry)
                    })
                let readStarted = CheckSignal()
                var release: CheckedContinuation<[HistoryEntry], Never>?
                let model = AppModel(
                    directory: fixture, offline: true, attemptExecution: execution,
                    readHistory: {
                        await withCheckedContinuation {
                            release = $0
                            Task { await readStarted.signal() }
                        }
                    })
                defer {
                    release?.resume(returning: [])
                    model.shutdown()
                }
                let terminal = CheckSignal()
                let receive = execution.onChange
                execution.onChange = { update in
                    receive?(update)
                    if case .running = update { return }
                    Task { await terminal.signal() }
                }
                guard let loading = model.refreshHistory() else {
                    throw CheckFailure("No startup history read")
                }
                try await readStarted.wait()
                let current = HistoryEntry(
                    mode: .ask, query: "Current", model: "m", effort: "", requestedServiceTier: nil)
                try execution.start(current)
                model.selection = current.id
                try await terminal.wait()
                release?.resume(returning: startupSnapshot)
                release = nil
                await loading.value
                try expectEqual(
                    Set(model.entries.map(\.id)), [old.id, current.id], "Startup lost history rows")
                try expectEqual(
                    model.selectedEntry?.status, failsSave ? "unsaved" : "completed",
                    "Startup replaced the newer terminal result")
                try expectEqual(
                    model.selectedEntry?.response, "Latest answer", "Startup lost the latest answer")
            }
        },
    ]
}
