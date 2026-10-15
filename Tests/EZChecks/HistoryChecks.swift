import EZCheckSupport
import Foundation

@testable import EZCore

@MainActor func historyChecks() -> [CheckCase] {
    [
        CheckCase("history: history snapshots, Unicode, permissions") { directory in
            let store = try HistoryStore(directory: directory.appendingPathComponent("history"))
            var entry = HistoryEntry(
                mode: .dictionary, query: "你好\n\"serendipity\"", model: "m", effort: "low",
                requestedServiceTier: "priority")
            try store.append(entry)
            entry.response = "A happy discovery.\n偶然的好运"
            entry.status = "completed"
            entry.metrics = ResponseMetrics(
                inputTokens: 20, reasoningTokens: 10, outputTokens: 30, timeToFirstTokenSeconds: 0.4,
                durationSeconds: 2)
            try store.append(entry)
            let result = try store.load()
            try expect(result.entries.count == 1 && result.damagedLines == 0, "Latest snapshot should win")
            try expect(
                result.entries[0].query == entry.query && result.entries[0].response == entry.response,
                "Text must round trip")
            try expectEqual(result.entries[0].metrics, entry.metrics, "metrics mismatch")
            let attributes = try FileManager.default.attributesOfItem(atPath: store.url.path)
            try expect(
                (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600, "History must be owner-only")
        },
        CheckCase("history: legacy snapshots without metrics remain readable") { directory in
            let store = try HistoryStore(directory: directory.appendingPathComponent("legacy"))
            let entry = HistoryEntry(
                mode: .ask, query: "legacy", model: "m", effort: "", requestedServiceTier: nil)
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            guard var json = try JSONSerialization.jsonObject(with: encoder.encode(entry)) as? [String: Any]
            else { throw CheckFailure("Expected history object") }
            json.removeValue(forKey: "metrics")
            try JSONSerialization.data(withJSONObject: json).write(to: store.url)
            let result = try store.load()
            try expectEqual(result.damagedLines, 0, "damagedLines mismatch")
            try expect(
                result.entries.first?.metrics == nil && result.entries.first?.query == "legacy",
                "Legacy history lost")
        },
        CheckCase("history: damaged tail and interrupted query recovery") { directory in
            let store = try HistoryStore(directory: directory.appendingPathComponent("damaged"))
            try Data("{\"unfinished\":".utf8).write(to: store.url)
            try store.append(
                HistoryEntry(mode: .ask, query: "hello", model: "m", effort: "", requestedServiceTier: nil))
            let result = try store.load()
            try expect(
                result.damagedLines == 1 && result.entries.count == 1,
                "Damaged bytes must not poison future entries")
            try expect(
                result.entries[0].status == "interrupted", "Abandoned pending request must show interrupted")
            try expect(
                String(contentsOf: store.url, encoding: .utf8).hasPrefix("{\"unfinished\":\n"),
                "Damaged bytes must be preserved")
        },
        CheckCase("history: history failure surfaces and failed answers export") { directory in
            let store = try HistoryStore(directory: directory.appendingPathComponent("blocked"))
            try FileManager.default.createDirectory(at: store.url, withIntermediateDirectories: true)
            var entry = HistoryEntry(
                mode: .spelling, query: "teh", model: "m", effort: "low", requestedServiceTier: nil)
            entry.status = "failed"
            entry.error = "Usage limit"
            entry.response = "partial"
            try expectThrows(EZError.self) { try store.append(entry) }
            try expect(
                entry.markdown.contains("Usage limit") && entry.markdown.contains("partial"),
                "Export should include failure and partial text")
        },
        CheckCase("history: lookup deletion removes all snapshots and preserves unrelated bytes") {
            directory in
            let store = try HistoryStore(directory: directory.appendingPathComponent("deletion"))
            var removed = HistoryEntry(
                mode: .dictionary, query: "delete me 你好", model: "m", effort: "low", requestedServiceTier: nil
            )
            let kept = HistoryEntry(
                mode: .ask, query: "keep me", model: "m", effort: "", requestedServiceTier: nil)
            try store.append(kept)
            let keptBytes = try Data(contentsOf: store.url)
            try store.append(removed)
            removed.response = "private answer"
            removed.status = "completed"
            try store.append(removed)
            // Even an invalid snapshot with an identifiable UUID must be removed.
            let damagedTarget = Data("{\"id\":\"\(removed.id)\",\"invalid\":true}\n".utf8)
            let tail = Data("\n{broken tail".utf8)
            var original = try Data(contentsOf: store.url)
            original.append(damagedTarget)
            original.append(tail)
            try original.write(to: store.url)
            try store.delete(id: removed.id)
            var expected = keptBytes
            expected.append(tail)
            try expect(
                try Data(contentsOf: store.url) == expected,
                "Unrelated bytes changed or deleted snapshots remain")
            let loaded = try HistoryStore(directory: store.url.deletingLastPathComponent()).load()
            try expect(
                loaded.entries.map(\.id) == [kept.id] && loaded.damagedLines == 1,
                "Deletion did not survive reload")
            try store.delete(id: UUID())
            try expect(try Data(contentsOf: store.url) == expected, "Unknown identity changed history")
            let attributes = try FileManager.default.attributesOfItem(atPath: store.url.path)
            try expect(
                (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600,
                "Replacement is not owner-only")
            try store.append(removed)
            try expect(try store.load().entries.count == 2, "Append after replacement failed")
            try store.delete(id: removed.id)
            try store.delete(id: kept.id)
            try expect(
                try Data(contentsOf: store.url) == tail + Data([0x0A]),
                "Deleting last lookup discarded unidentified damaged bytes")
            let files = try FileManager.default.contentsOfDirectory(
                atPath: store.url.deletingLastPathComponent().path)
            try expect(
                !files.contains { $0.hasPrefix(".history-") }, "Deletion left a temporary history copy")
        },
        CheckCase("history: lookup deletion handles empty stores and storage failures") { directory in
            let store = try HistoryStore(directory: directory.appendingPathComponent("delete-empty"))
            let entry = HistoryEntry(
                mode: .ask, query: "only entry", model: "m", effort: "", requestedServiceTier: nil)
            try store.delete(id: entry.id)
            try store.append(entry)
            try store.delete(id: entry.id)
            try expect(
                try Data(contentsOf: store.url).isEmpty && store.load().entries.isEmpty,
                "Last deletion was not empty")
            try store.append(entry)
            try expect(try store.load().entries.count == 1, "Empty replacement cannot accept appends")
            try FileManager.default.removeItem(at: store.url)
            try FileManager.default.createDirectory(at: store.url, withIntermediateDirectories: true)
            try expectThrows(NSError.self, matching: isFileError) { try store.delete(id: entry.id) }
            try expect(
                FileManager.default.fileExists(atPath: store.url.path),
                "Failed deletion removed original storage")
        },
        CheckCase("history: one process owns rotating credentials") { directory in
            let lock = try SessionLock(directory: directory)
            try expectThrows(EZError.self) { _ = try SessionLock(directory: directory) }
            withExtendedLifetime(lock) {}
        },
    ]
}
