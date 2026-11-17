import CryptoKit
import Foundation
import SaulNativeValues

/// The refresh owner serializes database reads off the main actor. Each request
/// opens a query-only connection to the current database and owns it through the snapshot.
public actor HistoryReader {
    private let directory: URL
    public init(directory: URL) { self.directory = directory }

    public func load() throws -> [HistoryEntry] {
        try Task.checkCancellation()
        let snapshot = try HistoryStore(reading: directory).snapshot()
        try Task.checkCancellation()
        return try snapshot.entries()
    }

    public func page(search: String = "", after cursor: HistoryCursor? = nil) throws -> HistoryPage {
        try Task.checkCancellation()
        return try HistoryStore(reading: directory).page(search: search, after: cursor)
    }

    public func count(search: String, excluding identities: [HistoryStore.RecordID]) throws -> Int {
        try Task.checkCancellation()
        return try HistoryStore(reading: directory).count(search: search, excluding: identities)
    }

    public func entry(_ id: HistoryStore.RecordID) throws -> HistoryEntry? {
        try Task.checkCancellation()
        return try HistoryStore(reading: directory).entry(id)
    }

    public func image(for entry: HistoryEntry) throws -> Data? {
        try Task.checkCancellation()
        return try HistoryStore(reading: directory).image(for: entry)
    }
}

extension HistoryEntry {
    public var recordID: HistoryStore.RecordID {
        sourceID.map { .browser(selectionID: $0) } ?? .native(id)
    }
}

/// Owns detached SQL values, not a connection or statement. Projection and JSON
/// decoding cannot keep locks from the read transaction alive.
struct HistorySnapshot {
    let native: [[String: Any]]
    let browser: [[String: Any]]

    func entries() throws -> [HistoryEntry] {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        var entries = try native.map { row in
            guard let json = row["data"] as? String else { throw EZError("Invalid saved history record.") }
            var entry = try decoder.decode(HistoryEntry.self, from: Data(json.utf8))
            guard entry.schemaVersion == 1 else { throw EZError("Unsupported history entry version.") }
            entry.storedImage = row["has_image"] as? Int64 == 1
            if entry.status == "pending" { entry.status = "interrupted" }
            return entry
        }
        entries.reserveCapacity(native.count + browser.count)
        for row in browser {
            entries.append(projectBrowser(row))
        }
        return entries.sorted {
            $0.createdAt == $1.createdAt ? $0.id.uuidString > $1.id.uuidString : $0.createdAt > $1.createdAt
        }
    }

    private func projectBrowser(_ row: [String: Any]) -> HistoryEntry {
        let source = row["id"] as? String ?? ""
        let input = (row["input_json"] as? String).flatMap {
            try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any]
        }
        var entry = HistoryEntry(
            mode: .ask, query: input?["userPrompt"] as? String ?? row["text"] as? String ?? "",
            model: row["model"] as? String ?? "", effort: "", requestedServiceTier: nil)
        entry.id = Self.browserID(source)
        entry.sourceID = source
        entry.sourceRunID = row["run_id"] as? String
        if let preset = input?["preset"] as? [String: Any], let capability = preset["capability"] as? String {
            entry.sourceCapability = ActionCapability(rawValue: capability)
            if let options = preset["imageOptions"] {
                entry.sourceImageOptions = try? JSONDecoder().decode(
                    ImageOptions.self, from: JSONSerialization.data(withJSONObject: options))
            }
            if entry.sourceCapability == .draw {
                entry.connectionSnapshot = ConnectionDefinition(
                    key: "openai-api", name: "OpenAI API", kind: .openAIAPI)
            }
        }
        entry.storedImage = row["has_image"] as? Int64 == 1 && row["status"] as? String == "completed"
        entry.sourceText = row["text"] as? String
        entry.sourceURL = row["url"] as? String
        entry.sourceTitle = row["title"] as? String
        entry.instructions = input?["systemPrompt"] as? String ?? row["prompt_raw"] as? String
        entry.response = row["response_raw"] as? String ?? ""
        entry.createdAt = Date(timeIntervalSince1970: Double(row["created_at"] as? Int64 ?? 0) / 1000)
        let status = row["status"] as? String ?? "interrupted"
        entry.status = ["queued", "running", "saving"].contains(status) ? "interrupted" : status
        entry.error = row["error_message"] as? String
        entry.durationSeconds = (row["latency_ms"] as? Int64).map { Double($0) / 1000 }
        return entry
    }

    static func browserID(_ id: String) -> UUID {
        let bytes = Array(SHA256.hash(data: Data(("saul:" + id).utf8)).prefix(16))
        return UUID(
            uuid: (
                bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7], bytes[8],
                bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
            ))
    }
}
