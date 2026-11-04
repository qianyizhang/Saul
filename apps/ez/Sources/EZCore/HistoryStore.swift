import CSQLite
import CryptoKit
import Darwin
import Foundation

/// The shared database owns durable history. Execution stays app-local; credentials use the Saul owner.
public final class HistoryStore {
    public static var defaultDirectory: URL { SharedPresetsStore.defaultURL.deletingLastPathComponent() }
    public let url: URL
    private var database: OpaquePointer?
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    public init(directory: URL = HistoryStore.defaultDirectory, migrating legacyDirectory: URL? = nil) throws
    {
        try Self.regular(directory, directory: true)
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        url = directory.appendingPathComponent("history.sqlite3")
        try Self.regular(url)
        guard
            sqlite3_open_v2(
                url.path, &database, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil)
                == SQLITE_OK
        else {
            let message = failure()
            sqlite3_close(database)
            database = nil
            throw message
        }
        do {
            sqlite3_busy_timeout(database, 5000)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
            try execute("PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;")
            try transaction {
                let version = try rows("PRAGMA user_version").first?["user_version"] as? Int64 ?? 0
                guard version == 0 || version == 3 else {
                    throw EZError("Unsupported shared history version.")
                }
                if version == 0 {
                    let installed = Bundle.main.resourceURL.flatMap {
                        Bundle(url: $0.appendingPathComponent("EZ_EZCore.bundle"))
                    }
                    guard
                        let schema = (installed ?? Bundle.module).url(
                            forResource: "history", withExtension: "sql")
                    else { throw EZError("Shared history schema is missing.") }
                    try execute(String(contentsOf: schema, encoding: .utf8))
                    try execute("PRAGMA user_version=3")
                }
            }
            if let legacyDirectory { try migrate(from: legacyDirectory) }
        } catch {
            sqlite3_close(database)
            database = nil
            throw error
        }
    }
    deinit { sqlite3_close(database) }

    public func recoverInterrupted() throws {
        try execute(
            "UPDATE ez_entry SET data=json_set(data,'$.status','interrupted') WHERE json_extract(data,'$.status')='pending'"
        )
    }
    public func append(_ entry: HistoryEntry) throws {
        guard entry.sourceID == nil else { throw EZError("Open this saved request in Saul to run it again.") }
        guard entry.schemaVersion == 1 else { throw EZError("Unsupported history entry version.") }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(entry)
        let image = entry.imageData
        let input = try entry.inputImage?.data.map { _ in try entry.inputImage!.validatedData() }
        try execute(
            "INSERT INTO ez_entry(id,created_at,data,image,input_image) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,image=COALESCE(excluded.image,ez_entry.image),input_image=COALESCE(excluded.input_image,ez_entry.input_image)",
            [
                entry.id.uuidString.lowercased(), Int64(entry.createdAt.timeIntervalSince1970 * 1000),
                String(decoding: data, as: UTF8.self), image, input,
            ])
    }
    public func delete(id: UUID) throws {
        let foreign = try load().first { $0.id == id && $0.sourceID != nil }
        if let source = foreign?.sourceID {
            try transaction {
                guard
                    try rows(
                        "SELECT id FROM llm_run WHERE selection_id=? AND status IN ('queued','running','saving')",
                        [source]
                    ).isEmpty
                else { throw EZError("Stop the running request in Saul before deleting this history.") }
                try execute("DELETE FROM selection WHERE id=?", [source])
            }
        } else {
            try execute("DELETE FROM ez_entry WHERE id=?", [id.uuidString.lowercased()])
        }
    }
    public func load() throws -> [HistoryEntry] {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        var entries: [HistoryEntry] = []
        try transaction {
            for row in try rows(
                "SELECT data,image IS NOT NULL AS has_image FROM ez_entry ORDER BY created_at DESC,id DESC")
            {
                guard let json = row["data"] as? String else {
                    throw EZError("Invalid saved history record.")
                }
                var entry = try decoder.decode(HistoryEntry.self, from: Data(json.utf8))
                guard entry.schemaVersion == 1 else { throw EZError("Unsupported history entry version.") }
                entry.storedImage = row["has_image"] as? Int64 == 1
                if entry.status == "pending" { entry.status = "interrupted" }
                entries.append(entry)
            }
            for row in try rows(
                "SELECT s.id,s.text,p.url,p.title,r.input_json,r.prompt_raw,r.response_raw,r.model,r.status,r.error_message,r.created_at,r.latency_ms FROM selection s JOIN page p ON p.id=s.page_id JOIN llm_run r ON r.rowid=(SELECT rowid FROM llm_run WHERE selection_id=s.id AND status NOT IN ('queued','running','saving') ORDER BY created_at DESC,rowid DESC LIMIT 1)"
            ) {
                let source = row["id"] as? String ?? ""
                let input = (row["input_json"] as? String).flatMap {
                    try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any]
                }
                var entry = HistoryEntry(
                    mode: .ask, query: input?["userPrompt"] as? String ?? row["text"] as? String ?? "",
                    model: row["model"] as? String ?? "", effort: "", requestedServiceTier: nil)
                entry.id = Self.browserID(source)
                entry.sourceID = source
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
                entries.append(entry)
            }
        }
        return entries.sorted {
            $0.createdAt == $1.createdAt ? $0.id.uuidString > $1.id.uuidString : $0.createdAt > $1.createdAt
        }
    }
    public func image(for entry: HistoryEntry) throws -> Data? {
        if let data = entry.imageData { return data }
        return try rows("SELECT image FROM ez_entry WHERE id=?", [entry.id.uuidString.lowercased()]).first?[
            "image"] as? Data
    }
    public func inputImage(for entry: HistoryEntry) throws -> ImageAttachment? {
        guard let metadata = entry.inputImage else { return nil }
        if metadata.data != nil {
            _ = try metadata.validatedData()
            return metadata
        }
        guard
            let data = try rows(
                "SELECT input_image FROM ez_entry WHERE id=?", [entry.id.uuidString.lowercased()]
            ).first?["input_image"] as? Data
        else { throw EZError("The saved input image is unavailable.") }
        let image = try ImageAttachment(data: data, name: metadata.name)
        guard image.mediaType == metadata.mediaType else {
            throw EZError("The saved input image format changed.")
        }
        return image
    }
    private func migrate(from directory: URL) throws {
        let source = directory.appendingPathComponent("history.jsonl")
        guard FileManager.default.fileExists(atPath: source.path) else { return }
        try Self.regular(source)
        let images = directory.appendingPathComponent("images", isDirectory: true)
        if FileManager.default.fileExists(atPath: images.path) { try Self.regular(images, directory: true) }
        let lockURL = directory.appendingPathComponent("history.lock")
        try Self.regular(lockURL)
        let lock = Darwin.open(lockURL.path, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
        guard lock >= 0 else { throw EZError("Cannot lock original history for migration.") }
        defer { Darwin.close(lock) }
        guard flock(lock, LOCK_EX) == 0 else { throw EZError("Cannot lock original history for migration.") }
        defer { flock(lock, LOCK_UN) }
        let marker = "ez-jsonl"
        if try rows("SELECT id FROM history_migration WHERE id=?", [marker]).isEmpty {
            let data = try Data(contentsOf: source)
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            struct OldImage: Decodable { let imageFile: String? }
            var entries: [UUID: (entry: HistoryEntry, imageFile: String?)] = [:]
            for line in data.split(separator: 0x0A)
            where !line.allSatisfy({ [0x20, 0x09, 0x0D].contains($0) }) {
                do {
                    let entry = try decoder.decode(HistoryEntry.self, from: Data(line))
                    guard entry.schemaVersion == 1 else {
                        throw EZError("Unsupported original history version.")
                    }
                    entries[entry.id] = (entry, try decoder.decode(OldImage.self, from: Data(line)).imageFile)
                } catch {
                    throw EZError(
                        "Original EZ history contains damaged records. Migration stopped; the original file was retained. \(error.localizedDescription)"
                    )
                }
            }
            try transaction {
                for original in entries.values {
                    var entry = original.entry
                    if entry.status == "pending" { entry.status = "interrupted" }
                    if let filename = original.imageFile {
                        guard filename == entry.id.uuidString.lowercased() + ".png" else {
                            throw EZError("Invalid original image reference.")
                        }
                        let path = images.appendingPathComponent(filename)
                        try Self.regular(path)
                        entry.imageData = try Data(contentsOf: path)
                    }
                    if let metadata = entry.inputImage {
                        let path = images.appendingPathComponent(entry.id.uuidString.lowercased() + "-input")
                        try Self.regular(path)
                        let attachment = try ImageAttachment(
                            data: Data(contentsOf: path), name: metadata.name)
                        guard attachment.mediaType == metadata.mediaType else {
                            throw EZError("Original input image format changed.")
                        }
                        entry.inputImage = attachment
                    }
                    guard
                        try rows("SELECT id FROM ez_entry WHERE id=?", [entry.id.uuidString.lowercased()])
                            .isEmpty
                    else {
                        throw EZError(
                            "Original EZ history conflicts with a shared record. Original files retained.")
                    }
                    try append(entry)
                    let stored = try rows(
                        "SELECT data,image,input_image FROM ez_entry WHERE id=?",
                        [entry.id.uuidString.lowercased()]
                    ).first
                    guard let json = stored?["data"] as? String else {
                        throw EZError("History migration verification failed.")
                    }
                    var expected = entry
                    expected.imageData = nil
                    expected.inputImage?.data = nil
                    guard try decoder.decode(HistoryEntry.self, from: Data(json.utf8)) == expected,
                        entry.imageData == stored?["image"] as? Data,
                        entry.inputImage?.data == stored?["input_image"] as? Data
                    else { throw EZError("History migration verification failed. Original files retained.") }
                }
                try execute("INSERT INTO history_migration VALUES (?)", [marker])
            }
        }
        // The durable marker prevents re-import if cleanup is interrupted after commit.
        if FileManager.default.fileExists(atPath: images.path) {
            for path in try FileManager.default.contentsOfDirectory(
                at: images, includingPropertiesForKeys: [.isSymbolicLinkKey])
            {
                try Self.regular(path)
            }
            try FileManager.default.removeItem(at: images)
        }
        try FileManager.default.removeItem(at: source)
        try FileManager.default.removeItem(at: lockURL)
    }
    private static func browserID(_ id: String) -> UUID {
        let bytes = Array(SHA256.hash(data: Data(("saul:" + id).utf8)).prefix(16))
        return UUID(
            uuid: (
                bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7], bytes[8],
                bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
            ))
    }
    private static func regular(_ url: URL, directory: Bool = false) throws {
        guard
            FileManager.default.fileExists(atPath: url.path)
                || (try? url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == true
        else { return }
        let values = try url.resourceValues(forKeys: [.isSymbolicLinkKey, .isRegularFileKey, .isDirectoryKey])
        guard values.isSymbolicLink != true,
            directory ? values.isDirectory == true : values.isRegularFile == true
        else { throw EZError("History paths must not be symbolic links or special files.") }
    }
    private func failure() -> EZError {
        EZError("Shared history: " + String(cString: sqlite3_errmsg(database)))
    }
    private func transaction<T>(_ body: () throws -> T) throws -> T {
        try execute("BEGIN IMMEDIATE")
        do {
            let result = try body()
            try execute("COMMIT")
            return result
        } catch {
            try? execute("ROLLBACK")
            throw error
        }
    }
    private func statement(_ sql: String, _ values: [Any?]) throws -> OpaquePointer {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw failure()
        }
        for (offset, value) in values.enumerated() {
            let index = Int32(offset + 1)
            let code: Int32
            switch value {
            case let text as String:
                code = sqlite3_bind_text(statement, index, text, Int32(text.utf8.count), transient)
            case let number as Int64: code = sqlite3_bind_int64(statement, index, number)
            case let data as Data:
                code = data.withUnsafeBytes {
                    sqlite3_bind_blob(statement, index, $0.baseAddress, Int32(data.count), transient)
                }
            case nil: code = sqlite3_bind_null(statement, index)
            default:
                sqlite3_finalize(statement)
                throw EZError("Invalid history SQL value.")
            }
            guard code == SQLITE_OK else {
                sqlite3_finalize(statement)
                throw failure()
            }
        }
        return statement
    }
    private func execute(_ sql: String, _ values: [Any?] = []) throws {
        if values.isEmpty {
            guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else { throw failure() }
            return
        }
        let statement = try statement(sql, values)
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_DONE else { throw failure() }
    }
    private func rows(_ sql: String, _ values: [Any?] = []) throws -> [[String: Any]] {
        let statement = try statement(sql, values)
        defer { sqlite3_finalize(statement) }
        var result: [[String: Any]] = []
        while true {
            let code = sqlite3_step(statement)
            if code == SQLITE_DONE { return result }
            guard code == SQLITE_ROW else { throw failure() }
            var row: [String: Any] = [:]
            for column in 0..<sqlite3_column_count(statement) {
                let name = String(cString: sqlite3_column_name(statement, column))
                switch sqlite3_column_type(statement, column) {
                case SQLITE_INTEGER: row[name] = sqlite3_column_int64(statement, column)
                case SQLITE_TEXT:
                    if let bytes = sqlite3_column_text(statement, column) {
                        row[name] = String(
                            decoding: UnsafeBufferPointer(
                                start: bytes, count: Int(sqlite3_column_bytes(statement, column))),
                            as: UTF8.self)
                    }
                case SQLITE_BLOB:
                    if let bytes = sqlite3_column_blob(statement, column) {
                        row[name] = Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, column)))
                    }
                default: break
                }
            }
            result.append(row)
        }
    }
}
