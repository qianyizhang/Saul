import EZCore
import Foundation
import SaulTestSupport

@testable import EZApplication

@MainActor func historyPagingStateChecks() -> [CheckCase] {
    [
        CheckCase(
            "history state: pages search all records and selection survives unloaded parent and refresh"
        ) { directory in
            let store = try HistoryStore(directory: directory)
            var oldest: HistoryEntry?
            for n in 0..<205 {
                var entry = HistoryEntry(
                    mode: .ask, query: "Question \(n)", model: "fixture", effort: "",
                    requestedServiceTier: nil)
                entry.createdAt = Date(timeIntervalSince1970: Double(n))
                entry.status = "completed"
                entry.response = n == 0 ? "Unique answer outside first page" : "Answer"
                try store.append(entry)
                if n == 0 { oldest = entry }
            }
            let model = fixtureModel(directory: directory)
            defer { model.shutdown() }
            await model.refreshHistory()?.value
            try expectEqual(model.entries.count, 100, "History was fully hydrated")
            try expectEqual(model.historyTotal, 205, "Count only covers loaded rows")
            model.lookup.selection = oldest!.id
            await model.waitForHistorySelection()
            try expectEqual(
                model.lookup.selectedEntry?.response, oldest?.response, "Unloaded parent could not be read")
            await model.loadMoreHistory()?.value
            try expectEqual(model.entries.count, 200, "Second page was not appended")
            await model.refreshHistory()?.value
            try expectEqual(model.lookup.selection, oldest?.id, "Refresh dropped off-page selection")
            try expectEqual(
                model.lookup.selectedEntry?.response, oldest?.response, "Refresh discarded selected detail")
            model.search = "unique answer"
            await model.refreshHistory()?.value
            try expectEqual(model.entries.map(\.id), [oldest!.id], "Search omitted an unloaded answer")
            try expectEqual(model.historyTotal, 1, "Search count did not cover all matches")
            model.search = "no match"
            await model.refreshHistory()?.value
            try expect(model.entries.isEmpty && model.historyTotal == 0, "Empty search kept stale list rows")
            try expectEqual(model.lookup.selection, oldest?.id, "Search discarded selected history")
        },
        CheckCase("history state: superseded detail cannot replace selection and failures remain recoverable")
        { directory in
            var a = HistoryEntry(
                mode: .ask, query: "A", model: "fixture", effort: "", requestedServiceTier: nil)
            a.status = "completed"
            a.response = "Answer A"
            var b = a
            b.id = UUID()
            b.query = "B"
            b.response = "Answer B"
            let firstStarted = CheckSignal()
            var first: CheckedContinuation<HistoryEntry?, Never>?
            var failB = true
            let model = fixtureModel(
                directory: directory,
                readHistoryPage: { _, _ in HistoryPage(rows: [HistoryRow(a), HistoryRow(b)]) },
                readHistoryEntry: { id in
                    if id == a.recordID {
                        return await withCheckedContinuation {
                            first = $0
                            Task { await firstStarted.signal() }
                        }
                    }
                    if failB { throw EZError("Fixture detail unavailable") }
                    return b
                })
            defer {
                first?.resume(returning: a)
                model.shutdown()
            }
            await model.refreshHistory()?.value
            model.lookup.selection = a.id
            try await firstStarted.wait()
            model.lookup.selection = b.id
            await model.waitForHistorySelection()
            try expect(
                model.historyDetailError != nil && model.lookup.selection == b.id,
                "Failure lost the selected row")
            first?.resume(returning: a)
            first = nil
            await Task.yield()
            try expect(model.lookup.selectedEntry == nil, "Old detail replaced B")
            failB = false
            model.reloadHistorySelection()
            await model.waitForHistorySelection()
            try expectEqual(
                model.lookup.selectedEntry?.response, "Answer B",
                "Detail recovery did not load the exact record")
            try expect(model.historyDetailError == nil, "Successful detail left a stale error")
        },
        CheckCase("history state: detail cache evicts old answers and reopens them from storage") {
            directory in
            let store = try HistoryStore(directory: directory)
            var values: [HistoryEntry] = []
            for n in 0..<25 {
                var entry = HistoryEntry(
                    mode: .ask, query: "Row \(n)", model: "m", effort: "", requestedServiceTier: nil)
                entry.status = "completed"
                entry.response = String(repeating: "answer", count: 1000)
                try store.append(entry)
                values.append(entry)
            }
            let reader = HistoryReader(directory: directory)
            var calls: [HistoryStore.RecordID: Int] = [:]
            let model = fixtureModel(
                directory: directory,
                readHistoryEntry: { id in
                    calls[id, default: 0] += 1
                    return try await reader.entry(id)
                })
            defer { model.shutdown() }
            await model.refreshHistory()?.value
            for entry in values {
                model.lookup.selection = entry.id
                await model.waitForHistorySelection()
            }
            model.lookup.selection = values[0].id
            await model.waitForHistorySelection()
            try expectEqual(calls[values[0].recordID], 2, "Full answers accumulated without a bound")
            try expectEqual(
                model.lookup.selectedEntry?.response, values[0].response,
                "Evicted detail did not reload exactly")
        },
        CheckCase("history state: obsolete refresh detail cannot clear a newer search error") { directory in
            let entry = HistoryEntry(
                mode: .ask, query: "Saved", model: "m", effort: "", requestedServiceTier: nil)
            let started = CheckSignal()
            var release: CheckedContinuation<HistoryEntry?, Never>?
            let model = fixtureModel(
                directory: directory,
                readHistoryPage: { query, _ in
                    if !query.isEmpty { throw EZError("New query failed") }
                    return HistoryPage(rows: [HistoryRow(entry)])
                },
                readHistoryEntry: { _ in
                    await withCheckedContinuation {
                        release = $0
                        Task { await started.signal() }
                    }
                })
            defer {
                release?.resume(returning: entry)
                model.shutdown()
            }
            model.showHistory([entry])
            model.lookup.selection = entry.id
            let old = model.refreshHistory()
            try await started.wait()
            model.search = "new"
            await model.refreshHistory()?.value
            release?.resume(returning: entry)
            release = nil
            await old?.value
            try expectEqual(
                model.storageWarning, "New query failed", "Obsolete refresh hid the active query error")
        },
        CheckCase("history state: cached detail reports refresh failure and off-page deletion evicts it") {
            directory in
            let store = try HistoryStore(directory: directory)
            var entry = HistoryEntry(
                mode: .ask, query: "Selected", model: "m", effort: "", requestedServiceTier: nil)
            entry.status = "completed"
            entry.response = "Exact saved answer"
            try store.append(entry)
            let reader = HistoryReader(directory: directory)
            var fail = false
            let model = fixtureModel(
                directory: directory,
                readHistoryEntry: { id in
                    if fail { throw EZError("Fixture refresh failure") }
                    return try await reader.entry(id)
                })
            defer { model.shutdown() }
            await model.refreshHistory()?.value
            model.lookup.selection = entry.id
            await model.waitForHistorySelection()
            fail = true
            model.reloadHistorySelection()
            await model.waitForHistorySelection()
            try expectEqual(
                model.lookup.selectedEntry?.response, entry.response,
                "Refresh failure discarded readable saved detail")
            try expectEqual(
                model.historyDetailError, "Fixture refresh failure", "Cached detail hid its refresh error")
            fail = false
            model.reloadHistorySelection()
            await model.waitForHistorySelection()
            try expect(model.historyDetailError == nil, "Recovered detail kept its error")
            model.search = "no matching rows"
            await model.refreshHistory()?.value
            try expect(
                model.entries.isEmpty && model.lookup.selectedEntry != nil,
                "Fixture is not an off-page selection")
            await model.deleteLookup(entry.recordID)?.value
            model.lookup.selection = entry.id
            await model.waitForHistorySelection()
            try expect(model.lookup.selectedEntry == nil, "Deleted off-page detail remained cached")
            try expect(model.historyDetailError != nil, "Missing detail was not reported")
        },
    ]
}
