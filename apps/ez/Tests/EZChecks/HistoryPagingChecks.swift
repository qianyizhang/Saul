import EZCheckSupport
import Foundation
import SaulNativeValues
import SaulTestSupport

@testable import EZCore

@MainActor func historyPagingChecks() -> [CheckCase] {
    [
        CheckCase("history pages: bounded rows preserve Unicode search, ties and lazy exact detail") {
            directory in
            let store = try HistoryStore(directory: directory)
            var originals: [HistoryEntry] = []
            for index in 0..<205 {
                var entry = HistoryEntry(
                    mode: .ask, query: "Row \(index)", model: "fixture", effort: "", requestedServiceTier: nil
                )
                entry.id = UUID(uuidString: String(format: "00000000-0000-4000-8000-%012d", index))!
                entry.createdAt = Date(timeIntervalSince1970: 100 + Double(index % 3) / 10)
                entry.response = String(repeating: "Long saved answer. ", count: 500)
                entry.instructions = "Exact frozen instructions"
                entry.status = "completed"
                if index == 0 { entry.response += " CAFÉ 中文 Straße" }
                try store.append(entry)
                originals.append(entry)
            }
            let expected = try store.load()
            let reader = HistoryReader(directory: directory)
            let first = try await reader.page()
            try expectEqual(first.rows.count, 100, "Initial read decoded the full collection")
            try expectEqual(first.total, 205, "Count reported loaded rows instead of all results")
            let second = try await reader.page(after: first.next)
            let third = try await reader.page(after: second.next)
            try expectEqual(third.rows.count, 5, "Final page omitted rows")
            try expect(third.next == nil, "Final page loops")
            try expectEqual(
                (first.rows + second.rows + third.rows).map(\.id), expected.map(\.id),
                "Cursor changed JSON timestamp ordering or skipped equal-time rows")
            for query in ["café", "cafe", "中文", "STRASSE"] {
                let expectedMatches = expected.filter {
                    $0.query.localizedCaseInsensitiveContains(query)
                        || $0.response.localizedCaseInsensitiveContains(query)
                }
                let page = try await reader.page(search: query)
                try expectEqual(
                    page.rows.map(\.id), expectedMatches.map(\.id), "Search changed Foundation matching")
            }
            try await expectAsyncThrows(EZError.self) {
                _ = try await reader.page(search: "other", after: first.next)
            }
            let original = expected.last!
            let detail = try await reader.entry(original.recordID)
            try expectEqual(detail, original, "Detail changed frozen input or full output")
            try store.delete(original.recordID)
            let deleted = try await reader.entry(original.recordID)
            try expect(deleted == nil, "Deleted detail was cached by the reader")
        },
        CheckCase("history pages: live and persisted action rows share their complete projection") {
            directory in
            let store = try HistoryStore(directory: directory)
            for (capability, legacyMode, symbol) in [
                (ActionCapability.draw, QueryMode.dictionary, "photo"),
                (.write, nil, "text.badge.plus"),
            ] {
                var entry = HistoryEntry(
                    mode: .dictionary, query: "Expanded prompt", model: "fixture", effort: "",
                    requestedServiceTier: nil)
                entry.status = "completed"
                entry.actionSnapshot = Action(
                    name: "Custom \(capability.rawValue)", presetID: UUID(),
                    template: "{{first}} then {{second}}", legacyMode: legacyMode, capability: capability)
                entry.inputValues = ["second": "Suffix", "first": String(repeating: "👩🏽‍💻", count: 511)]
                var projection = entry
                projection.observedRevision = 1
                let live = HistoryRow(projection)
                try expectEqual(live.actionSymbol, symbol, "Live icon fixture is invalid")
                try store.append(entry)
                let persisted = try store.page().rows.first { $0.id == entry.id }
                try expectEqual(persisted, live, "Reload changed the complete row")
            }
        },
        CheckCase("history pages: browser and native rows share order and latest completed projection") {
            directory in
            let store = try HistoryStore(directory: directory)
            var native = HistoryEntry(
                mode: .dictionary, query: "Native", model: "m", effort: "", requestedServiceTier: nil)
            native.createdAt = Date(timeIntervalSince1970: 42)
            native.status = "completed"
            try store.append(native)
            _ = try historySQL(
                store.url,
                "INSERT INTO page(id,url,title,first_seen_at,last_seen_at) VALUES ('p','https://example.test','Source',1,1)"
            )
            _ = try historySQL(
                store.url,
                "INSERT INTO selection(id,page_id,text,created_at) VALUES ('s','p','Browser label',1)")
            for (id, time, status, answer) in [
                ("older", 41_000, "completed", "Old"), ("current", 42_500, "completed", "Needle in browser"),
                ("active", 43_000, "running", "Not eligible"),
            ] {
                _ = try historySQL(
                    store.url,
                    "INSERT INTO llm_run(id,selection_id,widget_id,provider,model,prompt_version,prompt_raw,context_json,response_raw,status,created_at) VALUES ('\(id)','s','explain','openai-compatible','m','2','Frozen','{}','\(answer)','\(status)',\(time))"
                )
            }
            let page = try store.page()
            let all = try store.load().map { entry in
                var projection = entry
                projection.observedRevision = try store.get(entry.recordID)?.revision
                return HistoryRow(projection)
            }
            try expectEqual(
                page.rows, all, "Mixed-source list differs from saved-history projection"
            )
            try expectEqual(try store.page(search: "Old").total, 1, "Search missed an older saved attempt")
            let older = HistoryTarget.entry(.browser(selectionID: "s"), .browser("older"))
            let revision = try store.get(.browser(selectionID: "s"))?.revision
            _ = try store.mask(older, write: HistoryWrite(expectedRevision: revision))
            try expectEqual(try store.page(search: "Old").total, 0, "Search included a masked older attempt")
            let found = try store.page(search: "needle")
            try expectEqual(found.total, 1, "Browser answer search missed the full text")
            let detail = try store.entry(found.rows[0].recordID)
            try expectEqual(detail?.sourceRunID, "current", "Detail selected an active or obsolete attempt")
            try expectEqual(detail?.instructions, "Frozen", "Browser detail lost frozen instructions")
        },
    ]
}
