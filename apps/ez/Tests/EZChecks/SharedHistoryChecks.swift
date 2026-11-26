import EZCheckSupport
import Foundation
import SaulNativeValues
import SaulTestSupport

@testable import EZCore

private struct HistoryContract: Decodable {
    struct Scenario: Decodable {
        let name: String
        let kind: String
        let entries: Int?
        let schemaVersion: Int?
    }
    let version: Int
    let query: String
    let response: String
    let cases: [Scenario]
}

@MainActor func sharedHistoryChecks() -> [CheckCase] {
    [
        CheckCase("history contract: shared recovery, deletion and schema scenarios") { directory in
            let source = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
                .appendingPathComponent("../../../../contracts/fixtures/history.json").standardizedFileURL
            let contract = try JSONDecoder().decode(HistoryContract.self, from: Data(contentsOf: source))
            try expectEqual(contract.version, 1, "Unknown History contract")
            for scenario in contract.cases {
                let folder = directory.appendingPathComponent(scenario.kind)
                let store = try HistoryStore(directory: folder)
                if scenario.kind == "newer-schema" {
                    guard let version = scenario.schemaVersion else {
                        throw CheckFailure("Missing schema version")
                    }
                    _ = try historySQL(store.url, "PRAGMA user_version=\(version)")
                    try expectThrows(EZError.self) { _ = try HistoryStore(directory: folder) }
                    continue
                }
                guard let expectedEntries = scenario.entries else {
                    throw CheckFailure("Missing entry count")
                }
                if scenario.kind == "active-delete" {
                    _ = try historySQL(
                        store.url,
                        "INSERT INTO page(id,url,title,first_seen_at,last_seen_at) VALUES ('p','https://example.test','Source',1,1)"
                    )
                    _ = try historySQL(
                        store.url,
                        "INSERT INTO selection(id,page_id,text,created_at) VALUES ('s','p','Foreign source',1)"
                    )
                    for (id, status) in [("done", "completed"), ("active", "running")] {
                        _ = try historySQL(
                            store.url,
                            "INSERT INTO llm_run(id,selection_id,widget_id,provider,model,prompt_version,prompt_raw,context_json,response_raw,status,created_at) VALUES ('\(id)','s','explain','openai-compatible','fixture','2','','{}','Frozen answer','\(status)',1)"
                        )
                    }
                    let saved = try store.load()[0]
                    try expectThrows(EZError.self) { try store.delete(saved.recordID) }
                    try expectEqual(try store.load().count, expectedEntries, scenario.name)
                    continue
                }
                var entry = HistoryEntry(
                    mode: .ask, query: contract.query, model: "fixture", effort: "", requestedServiceTier: nil
                )
                try store.append(entry)
                entry.response = contract.response
                entry.status = "completed"
                try store.append(entry)
                switch scenario.kind {
                case "repeat-save": try store.append(entry)
                case "delete": try store.delete(entry.recordID)
                default: throw CheckFailure("Unknown History contract case: \(scenario.kind)")
                }
                let rows = try HistoryStore(directory: folder).load()
                try expectEqual(rows.count, expectedEntries, scenario.name)
                if let saved = rows.first {
                    try expectEqual(saved.query, contract.query, "Saved prompt changed")
                    try expectEqual(saved.response, contract.response, "Saved response changed")
                }
            }
        },
        CheckCase("history contract: v4 conversion keeps IDs, bookmark and frozen data once") { directory in
            let url = try historyVersionFourFixture(directory, seed: true)
            let store = try HistoryStore(directory: directory)
            let id = HistoryStore.RecordID.browser(selectionID: "shared-selection")
            let record = try store.get(id)
            try expectEqual(record?.value.sourceRunID, "shared-run", "Stable run identity changed")
            try expectEqual(record?.value.query, "Exact old prompt", "Legacy frozen input changed")
            try expectEqual(record?.value.response, "Legacy answer 🌱", "Legacy frozen response changed")
            try expectEqual(
                try historySQL(url, "SELECT bookmarked_at FROM selection"), "4", "Bookmark timestamp changed")
            try expectEqual(
                try historySQL(
                    url,
                    "SELECT count(*) FROM sqlite_master WHERE name IN ('bookmark','interaction','history_migration')"
                ),
                "0", "Obsolete history state retained")
            try expectEqual(
                try historySQL(url, "SELECT count(*) FROM history_event"), "0", "Conversion fabricated events"
            )
            try store.delete(id)
            let reopened = try HistoryStore(directory: directory)
            try expect(try reopened.get(id) == nil, "Reopen resurrected masked data")
            let deleted = try reopened.get(id, visibility: .masked)
            try expectEqual(deleted?.value.sourceRunID, "shared-run", "Masked run identity changed")
            _ = try reopened.restore(.record(id), write: HistoryWrite(expectedRevision: deleted?.revision))
            try expectEqual(try reopened.get(id)?.value.query, "Exact old prompt", "Restore changed input")
        },
        CheckCase("history contract: receipt protects uncertain acknowledgement and stale revisions") {
            directory in
            let store = try HistoryStore(directory: directory)
            var entry = HistoryEntry(
                mode: .ask, query: "Exact", model: "fixture", effort: "", requestedServiceTier: nil)
            entry.status = "completed"
            let firstWrite = HistoryWrite(operationID: "first", expectedRevision: nil)
            let first = try store.commit(entry.recordID, snapshot: entry, write: firstWrite)
            try expectEqual(try store.receipt(firstWrite.operationID), first, "Receipt missing")
            try expectEqual(
                try store.commit(entry.recordID, snapshot: entry, write: firstWrite), first,
                "Repeat changed acknowledgement")
            entry.response = "Different"
            try expectThrows(EZError.self) {
                _ = try store.commit(entry.recordID, snapshot: entry, write: firstWrite)
            }
            try expectThrows(EZError.self) {
                _ = try store.commit(
                    entry.recordID, snapshot: entry, write: HistoryWrite(expectedRevision: nil))
            }
            _ = try historySQL(store.url, "UPDATE ez_entry SET data=json_set(data,'$.futureField',42)")
            let revision = try store.get(entry.recordID)?.revision
            let second = HistoryWrite(operationID: "second", expectedRevision: revision)
            _ = try store.commit(entry.recordID, snapshot: entry, write: second)
            try expectEqual(
                try historySQL(store.url, "SELECT json_extract(data,'$.futureField') FROM ez_entry"),
                "42", "A known writer discarded an unfamiliar field")
            _ = try historySQL(
                store.url, "UPDATE history_receipt SET acknowledgement='{}' WHERE operation_id='second'")
            try expectThrows(EZError.self) {
                _ = try store.commit(entry.recordID, snapshot: entry, write: second)
            }
            try expectEqual(
                try store.get(entry.recordID)?.value.response, "Different",
                "Lost acknowledgement undid the commit")
        },
        CheckCase("history contract: visibility, attachment, expiry and scope share one lifetime") {
            directory in
            let url = try historyVersionFourFixture(directory, seed: true)
            let store = try HistoryStore(directory: directory)
            var entry = HistoryEntry(
                mode: .ask, query: "Private word", model: "fixture", effort: "", requestedServiceTier: nil)
            entry.status = "completed"
            entry.imageData = fixturePNG
            entry.inputImage = try ImageAttachment(data: fixturePNG, name: "source.png")
            try store.append(entry)
            try store.delete(entry.recordID)
            try expectEqual(try store.count(search: "private"), 0, "Masked data leaked into search")
            try expectEqual(
                try store.list(.library, search: "PRIVATE", visibility: .masked).total, 1,
                "Masked search lost the row")
            try expect(try store.image(for: entry) == nil, "Stale detail exposed masked image bytes")
            try expectEqual(
                try store.image(for: entry, visibility: .masked), fixturePNG, "Masked image bytes changed")
            try expectEqual(
                try store.inputImage(for: entry, visibility: .all)?.data, fixturePNG,
                "All view lost original attachment")
            let deletedAttempt = try store.entries(entry.recordID, visibility: .all).entries.first
            try expectEqual(deletedAttempt?.id, .native(entry.id), "Entry identity changed")
            try expect(deletedAttempt?.maskedAt != nil, "All view did not mark the entry")
            let expired = HistoryVisibility.milliseconds(Date()) - HistoryVisibility.retention
            _ = try historySQL(
                url, "UPDATE history_record SET masked_at=\(expired) WHERE collection='library-native'")
            let reopened = try HistoryStore(directory: directory)
            try expect(
                try reopened.get(entry.recordID, visibility: .all) == nil, "Expired record still readable")
            try expect(
                try reopened.image(for: entry, visibility: .all) == nil, "Expired attachment still readable")
            try expectThrows(EZError.self) { try reopened.append(entry) }
            _ = try reopened.clear(.libraryNative, write: HistoryWrite(expectedRevision: nil))
            try expect(
                try reopened.get(.browser(selectionID: "shared-selection")) != nil,
                "Native clear affected browser")
            _ = try historySQL(
                url, "INSERT INTO digest_batch(id,created_at,data) VALUES ('independent',1,'{}')")
            _ = try reopened.clear(.library, write: HistoryWrite(expectedRevision: nil))
            try expectEqual(
                try reopened.list(.library, visibility: .all).total, 0, "Shared clear left a Library row")
            try expectEqual(
                try historySQL(url, "SELECT count(*) FROM digest_batch"), "1", "Library clear erased Calls")
        },
        CheckCase("history contract: shared prompt search excludes masked attempts independently") {
            directory in
            let store = try HistoryStore(directory: directory)
            let source = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
                .appendingPathComponent("../../../../contracts/fixtures/history-search.sql")
                .standardizedFileURL
            let writer = try HistoryFixtureWriter(store.url, reservation: .immediate)
            try writer.run(String(contentsOf: source, encoding: .utf8))
            try writer.run("COMMIT")
            let record = HistoryStore.RecordID.browser(selectionID: "search-selection")
            let reader = HistoryReader(directory: directory)
            let old = "first question only"
            let quoted = "quoted older answer"
            for query in [old, quoted] {
                try expectEqual(
                    try await reader.page(search: query).rows.map(\.recordID), [record],
                    "Search missed expected fixture prompt: \(query)")
            }
            let revision = try store.get(record)?.revision
            _ = try store.mask(
                .entry(record, .browser("search-old")), write: HistoryWrite(expectedRevision: revision))
            try expectEqual(try await reader.page(search: old).total, 0, "Masked prompt leaked into search")
            try expectEqual(
                try await reader.page(search: quoted).rows.map(\.recordID), [record],
                "A visible follow-up can quote an older answer")
        },
        CheckCase("history contract: pending reuse and record masking share one admission guard") {
            directory in
            let store = try HistoryStore(directory: directory)
            var source = HistoryEntry(
                mode: .ask, query: "Original", model: "fixture", effort: "", requestedServiceTier: nil)
            source.status = "completed"
            try store.append(source)
            var attempt = HistoryEntry(
                mode: .ask, query: "Retry", model: "fixture", effort: "", requestedServiceTier: nil)
            attempt.admissionSourceID = source.id.uuidString.lowercased()
            try store.append(attempt)
            try expectThrows(EZError.self) { try store.delete(source.recordID) }
            try expectThrows(EZError.self) {
                _ = try store.clear(.library, write: HistoryWrite(expectedRevision: nil))
            }
            attempt.status = "cancelled"
            try store.append(attempt)
            try store.delete(source.recordID)
            var stale = attempt
            stale.id = UUID()
            stale.status = "pending"
            try expectThrows(EZError.self) { try store.append(stale) }
            try expectEqual(
                try store.list(.library, visibility: .all).total, 2,
                "Rejected admission wrote a provisional record")
        },
        CheckCase("history contract: restoring a native parent preserves its independent child mask") {
            directory in
            let store = try HistoryStore(directory: directory)
            var saved = HistoryEntry(
                mode: .ask, query: "Hidden lookup", model: "fixture", effort: "", requestedServiceTier: nil)
            saved.status = "completed"
            saved.imageData = fixturePNG
            saved.inputImage = try ImageAttachment(data: fixturePNG, name: "source.png")
            let start = try store.commit(
                saved.recordID, snapshot: saved, write: HistoryWrite(expectedRevision: nil))
            let record = HistoryTarget.record(saved.recordID)
            let child = HistoryTarget.entry(saved.recordID, .native(saved.id))
            let maskedChild = try store.mask(child, write: HistoryWrite(expectedRevision: start.revision))
            try expectEqual(
                try store.list(.library, search: "Hidden").total, 0, "Masked child leaked into search")
            try expect(try store.image(for: saved) == nil, "Masked child returned visible image bytes")
            try expectEqual(
                try store.image(for: saved, visibility: .masked), fixturePNG, "Masked child lost bytes")
            let maskedParent = try store.mask(
                record, write: HistoryWrite(expectedRevision: maskedChild.revision))
            let restoredParent = try store.restore(
                record, write: HistoryWrite(expectedRevision: maskedParent.revision))
            try expect(try store.get(saved.recordID) == nil, "Restoring parent exposed the masked child")
            let maskedEntries = try store.entries(saved.recordID, visibility: .masked)
            try expectEqual(
                maskedEntries.entries.map(\.id), [.native(saved.id)], "Child mask or identity changed")
            let restoredChild = try store.restore(
                child, write: HistoryWrite(expectedRevision: restoredParent.revision))
            try expectEqual(
                try store.get(saved.recordID)?.value.query, "Hidden lookup", "Restore lost the lookup")
            let purgedChild = try store.purge(
                child, write: HistoryWrite(expectedRevision: restoredChild.revision))
            try expect(
                try store.image(for: saved, visibility: .all) == nil, "Purged child retained image bytes")
            try expectEqual(
                try historySQL(
                    store.url,
                    "SELECT count(*) FROM ez_entry WHERE data='{}' AND image IS NULL AND input_image IS NULL"),
                "1", "Purged child retained contents or removed its parent")
            try expectEqual(
                try historySQL(store.url, "SELECT revision FROM history_record"),
                String(purgedChild.revision), "Child purge lost parent revision")
            try expectThrows(EZError.self) { try store.append(saved) }
            _ = try store.purge(record, write: HistoryWrite(expectedRevision: purgedChild.revision))
            try expectEqual(
                try historySQL(store.url, "SELECT count(*) FROM ez_entry"), "0", "Parent purge left a shell")
        },
    ]
}
