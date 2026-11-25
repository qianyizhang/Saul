import EZCheckSupport
import EZCore
import Foundation
import SaulNativeValues
import SaulTestSupport

@testable import EZApplication

@MainActor func historyStateChecks() -> [CheckCase] {
    [
        CheckCase("state: deletion persists clears selection and preserves composer draft") { directory in
            let f = try StateFixture(directory: directory)
            defer { f.model.shutdown() }
            let entry = try f.selectLookup()
            let draft = f.model.inputValues
            await f.model.deleteLookup(entry.recordID)?.value
            try expect(
                f.model.entries.isEmpty && f.model.selection == nil,
                "Successful deletion left lookup selected")
            try expect(f.model.inputValues == draft, "Deletion discarded draft")
            try expect(try f.history.load().isEmpty, "Deletion did not persist")
        },
        CheckCase("state: failed deletion keeps lookup selection and draft and displays error") { directory in
            let f = try StateFixture(directory: directory)
            defer { f.model.shutdown() }
            let entry = try f.selectLookup()
            let draft = f.model.inputValues
            try FileManager.default.removeItem(at: f.history.url)
            try FileManager.default.createDirectory(at: f.history.url, withIntermediateDirectories: true)
            await f.model.deleteLookup(entry.recordID)?.value
            try expect(
                f.model.entries == [HistoryRow(entry)] && f.model.selection == entry.id,
                "Failed deletion removed visible lookup")
            try expect(
                f.model.inputValues == draft && f.model.error != nil,
                "Failed deletion hid error or discarded draft")
        },
        CheckCase(
            "state: Library rejects a stale delete and can mask, restore and purge the refreshed record"
        ) {
            directory in
            let folder = directory.appendingPathComponent("shared")
            let url = try historyVersionFourFixture(folder, seed: true)
            let model = fixtureModel(directory: directory, historyDirectory: folder, includesLibrary: true)
            defer { model.shutdown() }
            await model.refreshHistory()?.value
            guard let original = model.entries.first, let library = model.library,
                let revision = original.revision
            else { throw CheckFailure("Library did not open shared record") }
            model.selection = original.id
            await model.waitForHistorySelection()
            _ = try historySQL(
                url,
                """
                INSERT INTO llm_run(id,selection_id,widget_id,provider,model,prompt_version,prompt_raw,context_json,response_raw,status,created_at)
                VALUES ('new-run','shared-selection','explain','openai-compatible','fixture','1','','{}','Newer answer','completed',8)
                """)
            await model.refreshHistory()?.value
            await model.deleteLookup(original.recordID, expectedRevision: revision)?.value
            try expect(
                model.error?.contains("History changed") == true, "Stale confirmation masked newer work")
            try expectEqual(
                model.selectedEntry?.sourceRunID, "new-run", "Stale confirmation cleared the answer")

            await model.deleteLookup(original.recordID)?.value
            try expect(model.entries.isEmpty && model.selection == nil, "Mask left visible Library history")
            let deleted = try await library.list(after: nil)
            guard let masked = deleted.rows.first else { throw CheckFailure("Recently deleted is empty") }
            try expectEqual(masked.recordID, original.recordID, "Mask changed identity")
            try await library.restore(masked)
            await model.refreshHistory()?.value
            try expectEqual(model.entries.first?.recordID, original.recordID, "Restore changed identity")

            await model.deleteLookup(original.recordID)?.value
            let remasked = try await library.list(after: nil)
            guard let purged = remasked.rows.first else { throw CheckFailure("Second mask was missing") }
            try await library.purge(purged)
            try expectEqual(try await library.list(after: nil).total, 0, "Permanent delete retained history")
            try expectEqual(
                try historySQL(url, "SELECT count(*) FROM llm_run"), "0", "Permanent delete retained runs")
        },
        CheckCase("state: preparing history gates Run and refresh, then recovers pending rows") { directory in
            let original = HistoryEntry(
                mode: .ask, query: "Before quit", model: "m", effort: "", requestedServiceTier: nil)
            let store = try HistoryStore(directory: directory)
            try store.append(original)
            let openStarted = CheckSignal()
            let release = CheckSignal()
            let writer = HistoryWriter(directory: directory)
            let model = fixtureModel(
                directory: directory,
                historyPreparation: .open {
                    await openStarted.signal()
                    try await release.wait()
                    try await writer.prepare()
                })
            defer {
                model.shutdown()
                Task { await release.signal() }
            }
            try await openStarted.wait()
            let refresh = model.refreshHistory()
            try expect(refresh != nil && model.entries.isEmpty, "Read did not wait for history preparation")
            try expect(
                !model.canDeleteLookup(original.recordID), "History mutation was enabled before preparation")
            await release.signal()
            await refresh?.value
            try expectEqual(model.entries.map(\.status), ["interrupted"], "Old pending row did not recover")
            let stored = try historySQL(store.url, "SELECT json_extract(data, '$.status') FROM ez_entry")
            try expectEqual(stored, "interrupted", "Recovery appeared in the read but never committed")
        },
        CheckCase("state: failed history preparation settles a waiting refresh") { directory in
            let started = CheckSignal()
            let release = CheckSignal()
            let model = fixtureModel(
                directory: directory,
                historyPreparation: .open {
                    await started.signal()
                    try await release.wait()
                    throw EZError("History cannot open.")
                })
            defer {
                model.shutdown()
                Task { await release.signal() }
            }
            try await started.wait()
            guard let refresh = model.refreshHistory() else { throw CheckFailure("No history refresh") }
            try expect(model.historyLoading, "Refresh did not wait for preparation")
            await release.signal()
            await refresh.value
            try expect(!model.historyLoading, "Failed preparation left the history loading")
            try expectEqual(model.storageWarning, "History cannot open.", "Preparation error was lost")
        },
        CheckCase("state: loading saved history checks its previously unopened connection") { directory in
            let store = try HistoryStore(directory: directory)
            let preset = ModelPreset(
                name: "Saved API", model: "fixture", effort: "", fast: false, connectionKey: "openai-api")
            var entry = HistoryEntry(
                mode: .ask, query: "Historical API lookup", model: preset.model, effort: "",
                requestedServiceTier: nil)
            entry.presetSnapshot = preset
            try store.append(entry)
            let requested = CheckSignal()
            let fixture = FixtureConnections()
            let checks = ConnectionChecks(
                status: { fixture.status($0) },
                catalog: { connection, _ in
                    if connection.key == preset.connectionKey { await requested.signal() }
                    return fixture.catalog(connection)
                })
            let model = fixtureModel(directory: directory, connectionChecks: checks)
            defer { model.shutdown() }
            await model.refreshHistory()?.value
            try expect(model.connectionCatalog(preset.connectionKey) == nil, "Fixture warmed the connection")
            model.selection = entry.id
            await model.waitForHistorySelection()
            try expectEqual(model.selectedEntry?.presetSnapshot, preset, "Saved detail did not load")
            try await requested.wait()
        },
        CheckCase("state: delete waits off the UI actor for SQLite write access") { directory in
            let f = try StateFixture(directory: directory)
            defer { f.model.shutdown() }
            let saved = try f.selectLookup()
            let blocker = try HistoryFixtureWriter(f.history.url, reservation: .exclusive)
            guard let deleting = f.model.deleteLookup(saved.recordID) else {
                throw CheckFailure("Delete was not admitted")
            }
            await Task.yield()
            try expect(
                !f.model.canDeleteLookup(saved.recordID), "Delete did not keep ownership until SQLite settled"
            )
            try expectEqual(f.model.selection, saved.id, "Delete changed selection before commit")
            try blocker.run("ROLLBACK")
            await deleting.value
            try expect(
                f.model.entries.isEmpty && f.model.selection == nil, "Acknowledged delete was not applied")
            try expect(try f.history.load().isEmpty, "Delete was not committed")
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
            let model = fixtureModel(
                directory: directory,
                readHistory: {
                    let reading = Task.detached {
                        await readStarted.signal()
                        return try await reader.load()
                    }
                    return try await reading.value
                })
            defer { model.shutdown() }
            model.showHistory([entry])
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
            let model = fixtureModel(
                directory: directory,
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
            model.showHistory([saved])
            model.selection = saved.id
            guard let pending = model.refreshHistory() else { throw CheckFailure("No history refresh") }
            try await readStarted.wait()
            await model.deleteLookup(saved.recordID)?.value
            release?.resume(returning: [saved])
            release = nil
            await pending.value
            try expect(
                model.entries.isEmpty && model.selection == nil, "A stale reply resurrected a deletion")
            try expect(try store.load().isEmpty, "Deletion did not persist")
            try expectEqual(model.historyTotal, 0, "Stale page resurrected the deleted count")
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
                    },
                    delete: { try store.discardPending($0) })
                let readStarted = CheckSignal()
                var release: CheckedContinuation<[HistoryEntry], Never>?
                let model = fixtureModel(
                    directory: fixture, attemptExecution: execution,
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
                try expectEqual(model.historyTotal, 2, "Startup count ignored the new outcome")
                try expectEqual(
                    model.selectedEntry?.status, failsSave ? "unsaved" : "completed",
                    "Startup replaced the newer terminal result")
                try expectEqual(
                    model.selectedEntry?.response, "Latest answer", "Startup lost the latest answer")
            }
        },
    ]
}
