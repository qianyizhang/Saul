import EZCheckSupport
import Foundation

@testable import EZCore

@MainActor func historyChecks() -> [CheckCase] {
    [
        CheckCase("history: shared snapshots, Unicode and permissions") { directory in
            let first = try HistoryStore(directory: directory)
            var entry = HistoryEntry(
                mode: .dictionary, query: "你好\n\"serendipity\"", model: "m", effort: "low",
                requestedServiceTier: "priority")
            entry.createdAt = Date(timeIntervalSince1970: 42)
            try first.append(entry)
            entry.response = "A happy discovery.\n偶然的好运"
            entry.status = "completed"
            entry.metrics = ResponseMetrics(
                inputTokens: 20, reasoningTokens: 10, outputTokens: 30, timeToFirstTokenSeconds: 0.4,
                durationSeconds: 2)
            try first.append(entry)
            let second = try HistoryStore(directory: directory)
            let result = try second.load()
            try expectEqual(result, [entry], "Both connections must see the same exact snapshot")
            let attributes = try FileManager.default.attributesOfItem(atPath: first.url.path)
            try expectEqual(
                (attributes[.posixPermissions] as? NSNumber)?.intValue, 0o600, "History must be owner-only")
            try second.delete(id: entry.id)
            try expect(try first.load().isEmpty, "Deletion must be shared")
        },
        CheckCase("history: migrates original snapshots once and removes the old files") { directory in
            let legacy = directory.appendingPathComponent("old")
            let shared = directory.appendingPathComponent("shared")
            try FileManager.default.createDirectory(at: legacy, withIntermediateDirectories: true)
            var entry = HistoryEntry(
                mode: .ask, query: "legacy 你好", model: "m", effort: "", requestedServiceTier: nil)
            entry.createdAt = Date(timeIntervalSince1970: 42)
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            var original = try encoder.encode(entry)
            entry.response = "Final snapshot"
            entry.status = "completed"
            original.append(0x0A)
            original.append(try encoder.encode(entry))
            let source = legacy.appendingPathComponent("history.jsonl")
            try original.write(to: source)
            let store = try HistoryStore(directory: shared, migrating: legacy)
            try expectEqual(try store.load(), [entry], "Latest original snapshot lost")
            try expect(!FileManager.default.fileExists(atPath: source.path), "Original JSONL was not retired")
            try expect(
                !FileManager.default.fileExists(atPath: legacy.appendingPathComponent("history.lock").path),
                "Original lock was not retired")
            try store.delete(id: entry.id)
            try original.write(to: source)
            let reopened = try HistoryStore(directory: shared, migrating: legacy)
            try expect(try reopened.load().isEmpty, "A cleanup retry resurrected a deleted record")
        },
        CheckCase("history: migrates image attachments into SQLite and removes sidecars") { directory in
            let legacy = directory.appendingPathComponent("old")
            let images = legacy.appendingPathComponent("images")
            try FileManager.default.createDirectory(at: images, withIntermediateDirectories: true)
            var entry = HistoryEntry(
                mode: .ask, query: "Image context", model: "image", effort: "", requestedServiceTier: nil)
            entry.createdAt = Date(timeIntervalSince1970: 42)
            entry.status = "completed"
            entry.inputImage = try ImageAttachment(data: fixturePNG, name: "source.png")
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            guard var json = try JSONSerialization.jsonObject(with: encoder.encode(entry)) as? [String: Any]
            else { throw CheckFailure("Expected original JSON") }
            json["imageFile"] = entry.id.uuidString.lowercased() + ".png"
            try JSONSerialization.data(withJSONObject: json).write(
                to: legacy.appendingPathComponent("history.jsonl"))
            try fixturePNG.write(to: images.appendingPathComponent(entry.id.uuidString.lowercased() + ".png"))
            try fixturePNG.write(
                to: images.appendingPathComponent(entry.id.uuidString.lowercased() + "-input"))
            let store = try HistoryStore(
                directory: directory.appendingPathComponent("shared"), migrating: legacy)
            let saved = try store.load()[0]
            try expect(saved.storedImage, "Migrated output image is not visible")
            try expectEqual(try store.image(for: saved), fixturePNG, "Output image changed")
            try expectEqual(try store.inputImage(for: saved)?.data, fixturePNG, "Input image changed")
            try expect(
                try FileManager.default.contentsOfDirectory(atPath: legacy.path).isEmpty,
                "Migration left sidecars or backups")
        },
        CheckCase("history: Saul Draw images retain exact bytes and the displayed attempt") { directory in
            let store = try HistoryStore(directory: directory)
            let path = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent(
                "../../../../contracts/fixtures/animation.gif")
            let gif = try Data(contentsOf: path)
            let encoded = gif.base64EncodedString()
            let output = "{\"data\":\"\(encoded)\",\"mediaType\":\"image/gif\",\"complete\":true}"
            let statements =
                "INSERT INTO page(id,url,title,first_seen_at,last_seen_at) VALUES ('p','https://example.test','Tree',1,1); INSERT INTO selection(id,page_id,text,created_at) VALUES ('s','p','Tree',1); INSERT INTO llm_run(id,selection_id,widget_id,provider,model,prompt_version,prompt_raw,context_json,input_json,response_raw,response_structured,status,created_at) VALUES ('run','s','illustrate','openai-compatible','gpt-image-2.6-flare','2','','{}','{\"preset\":{\"capability\":\"draw\",\"imageOptions\":{\"size\":\"1024x1024\",\"quality\":\"low\",\"outputFormat\":\"gif\"}}}','','\(output)','completed',1);"
            for statement in statements.split(separator: ";") {
                _ = try historySQL(store.url, String(statement))
            }
            guard let entry = try store.load().first else {
                throw CheckFailure("Browser image fixture was not saved")
            }
            try expectEqual(entry.capability, .draw, "Browser Draw became text")
            try expectEqual(entry.imageOptions.outputFormat, "gif", "Browser format lost")
            try expect(entry.hasImage, "Browser image metadata lost")
            try expectEqual(try store.image(for: entry), gif, "Browser output bytes changed")
            _ = try historySQL(store.url, "UPDATE llm_run SET id='new-run'")
            try expect(try store.image(for: entry) == nil, "Old answer loaded another attempt's image")
            try store.delete(id: entry.id)
            try expect(try store.load().isEmpty, "Deleting browser image kept its history")
        },
        CheckCase("history: damaged original blocks migration without dropping records") { directory in
            let legacy = directory.appendingPathComponent("old")
            try FileManager.default.createDirectory(at: legacy, withIntermediateDirectories: true)
            let source = legacy.appendingPathComponent("history.jsonl")
            let bytes = Data("{\"unfinished\":".utf8)
            try bytes.write(to: source)
            try expectThrows(EZError.self) { _ = try HistoryStore(directory: directory, migrating: legacy) }
            try expectEqual(try Data(contentsOf: source), bytes, "Failed migration changed original bytes")
            try expect(
                try HistoryStore(directory: directory).load().isEmpty,
                "Failed migration committed records")
        },
        CheckCase("history: abandoned pending snapshots remain interrupted") { directory in
            let store = try HistoryStore(directory: directory)
            try store.append(
                HistoryEntry(mode: .ask, query: "hello", model: "m", effort: "", requestedServiceTier: nil))
            try expectEqual(
                try store.load().first?.status, "interrupted",
                "Abandoned request should be interrupted")
        },
        CheckCase("history: invalid paths fail without creating another store") { directory in
            let path = directory.appendingPathComponent("history.sqlite3")
            try FileManager.default.createDirectory(at: path, withIntermediateDirectories: true)
            try expectThrows(EZError.self) { _ = try HistoryStore(directory: directory) }
        },
        CheckCase("history: lookup deletion is durable and accepts new entries") { directory in
            let store = try HistoryStore(directory: directory)
            let entry = HistoryEntry(
                mode: .ask, query: "only entry", model: "m", effort: "", requestedServiceTier: nil)
            try store.delete(id: entry.id)
            try store.append(entry)
            try store.delete(id: entry.id)
            try expect(try store.load().isEmpty, "Last deletion was not empty")
            try store.append(entry)
            try expectEqual(try store.load().count, 1, "Append after deletion failed")
        },
        CheckCase("history: reads and deletes Saul records without changing frozen text") { directory in
            let store = try HistoryStore(directory: directory)
            _ = try historySQL(
                store.url,
                "INSERT INTO page(id,url,title,first_seen_at,last_seen_at) VALUES ('p','https://example.test/page','Source',1,1)"
            )
            _ = try historySQL(
                store.url,
                "INSERT INTO selection(id,page_id,text,created_at) VALUES ('selection','p','你好 gradient',1)")
            _ = try historySQL(
                store.url,
                #"INSERT INTO llm_run(id,selection_id,widget_id,provider,model,prompt_version,prompt_raw,context_json,response_raw,status,created_at,input_json) VALUES ('run','selection','explain','openai-compatible','m','2','Original instructions','{}','A <term note="Slope">gradient</term>.','completed',42,'{"systemPrompt":"Frozen instructions","userPrompt":"Frozen query"}')"#
            )
            let entry = try store.load()[0]
            try expectEqual(entry.sourceID, "selection", "Browser source identity lost")
            try expectEqual(entry.displayQuery, "你好 gradient", "Browser selection lost")
            try expectEqual(entry.query, "Frozen query", "Saved prompt reconstructed")
            try expectEqual(entry.instructions, "Frozen instructions", "Saved instructions reconstructed")
            try expect(
                entry.response.contains("<term") && entry.citedResponse == "A gradient.",
                "Raw response or reading projection changed")
            try expectEqual(
                try HistoryStore(directory: directory).load()[0].id, entry.id,
                "Browser identity changes on reload")
            _ = try historySQL(
                store.url,
                "INSERT INTO llm_run(id,selection_id,widget_id,provider,model,prompt_version,prompt_raw,context_json,status,created_at) VALUES ('active','selection','explain','openai-compatible','m','2','','{}','running',43)"
            )
            try expectThrows(EZError.self) { try store.delete(id: entry.id) }
            _ = try historySQL(store.url, "UPDATE llm_run SET status='interrupted' WHERE id='active'")
            try store.delete(id: entry.id)
            try expectEqual(
                try historySQL(store.url, "SELECT count(*) FROM llm_run"), "0",
                "Cross-app deletion left browser runs")
        },
        CheckCase("history: one EZ process owns native runtime coordination") { directory in
            let lock = try SessionLock(directory: directory)
            try expectThrows(EZError.self) { _ = try SessionLock(directory: directory) }
            withExtendedLifetime(lock) {}
        },
    ]
}
