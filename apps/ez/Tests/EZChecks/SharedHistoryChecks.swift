import EZCheckSupport
import Foundation

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
                    try expectThrows(EZError.self) { try store.delete(id: saved.id) }
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
                case "delete": try store.delete(id: entry.id)
                default: throw CheckFailure("Unknown History contract case: \(scenario.kind)")
                }
                let rows = try HistoryStore(directory: folder).load()
                try expectEqual(rows.count, expectedEntries, scenario.name)
                if let saved = rows.first {
                    try expectEqual(saved.query, contract.query, "Saved prompt changed")
                    try expectEqual(saved.response, contract.response, "Saved response changed")
                }
            }
        }
    ]
}
