import CSQLite
import Foundation
import SaulNativeValues

/// The shared database owns durable history. Execution stays app-local; credentials use the Saul owner.
public final class HistoryStore {
    public enum RecordID: Hashable, Sendable {
        case native(UUID)
        case browser(selectionID: String)
    }

    public static var defaultDirectory: URL { SharedSettingsDocument.defaultURL.deletingLastPathComponent() }
    public let url: URL
    var database: OpaquePointer?
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    public init(directory: URL = HistoryStore.defaultDirectory) throws {
        try Self.regular(directory, directory: true)
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        url = directory.appendingPathComponent("history.sqlite3")
        try Self.regular(url)
        try open(flags: SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE)
        do {
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
            try execute("PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;")
            try transaction {
                let version = try rows("PRAGMA user_version").first?["user_version"] as? Int64 ?? 0
                guard [0, 3, 4, 5].contains(version) else {
                    throw EZError("Unsupported shared history version.")
                }
                if version < 5 { try upgradeSchema(from: version) }
            }
            try expireMasks()
        } catch {
            sqlite3_close(database)
            database = nil
            throw error
        }
    }
    convenience init(reading directory: URL) throws {
        try self.init(opening: directory, readOnly: true)
    }

    convenience init(writing directory: URL) throws {
        try self.init(opening: directory, readOnly: false)
    }

    private init(opening directory: URL, readOnly: Bool) throws {
        try Self.regular(directory, directory: true)
        url = directory.appendingPathComponent("history.sqlite3")
        try Self.regular(url)
        // Keep the same descriptor mode as peers. Mixed modes can give Apple's SQLite
        // writer EBADF taking its reservation. SQL writes stay disabled on this connection.
        try open(flags: SQLITE_OPEN_READWRITE)
        do {
            try execute(
                readOnly ? "PRAGMA query_only=ON" : "PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;")
            try requireCurrentSchema()
        } catch {
            sqlite3_close(database)
            database = nil
            throw error
        }
    }
    private func open(flags: Int32) throws {
        guard sqlite3_open_v2(url.path, &database, flags | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
            let error = failure()
            sqlite3_close(database)
            database = nil
            throw error
        }
        sqlite3_busy_timeout(database, 5000)
        try installHistoryFunctions()
    }
    deinit { sqlite3_close(database) }

    private func upgradeSchema(from version: Int64) throws {
        let installed = Bundle.main.resourceURL.flatMap {
            Bundle(url: $0.appendingPathComponent("EZ_EZCore.bundle"))
        }
        guard let schema = (installed ?? Bundle.module).url(forResource: "history", withExtension: "sql")
        else { throw EZError("Shared history schema is missing.") }
        let sections = try String(contentsOf: schema, encoding: .utf8)
            .components(separatedBy: "\n-- Migrate v4 to v5\n")
        guard sections.count == 2 else { throw EZError("Shared history schema is incomplete.") }
        let upgrade = sections[1].components(separatedBy: "\n-- Shared history v5\n")
        guard upgrade.count == 2 else { throw EZError("Shared history schema is incomplete.") }
        if version == 0 {
            try execute(sections[0])
        } else {
            if version == 3 { try upgradeConnectionNames() }
            try execute(upgrade[0])
        }
        try execute(upgrade[1])
        try execute("PRAGMA user_version=5")
    }

    private func upgradeConnectionNames() throws {
        for (table, field, upgrade) in [
            ("ez_entry", "data", HistoryConnectionMigration.history),
            ("llm_run", "input_json", HistoryConnectionMigration.run),
        ] {
            for row in try rows("SELECT id,\(field) AS value FROM \(table) WHERE \(field) IS NOT NULL") {
                guard let json = row["value"] as? String,
                    let value = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any]
                else { throw EZError("Invalid stored history. Original data preserved.") }
                let data = try JSONSerialization.data(withJSONObject: upgrade(value))
                try execute(
                    "UPDATE \(table) SET \(field)=? WHERE id=?",
                    [String(decoding: data, as: UTF8.self), row["id"]])
            }
        }
        for row in try rows("SELECT id,data FROM digest_batch") {
            guard let json = row["data"] as? String,
                var value = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any]
            else { throw EZError("Invalid stored summary. Original data preserved.") }
            if var action = value["action"] as? [String: Any], let input = action["input"] as? [String: Any] {
                action["input"] = try HistoryConnectionMigration.run(input)
                value["action"] = action
            }
            let data = try JSONSerialization.data(withJSONObject: value)
            try execute(
                "UPDATE digest_batch SET data=? WHERE id=?",
                [String(decoding: data, as: UTF8.self), row["id"]])
        }
    }

    public func recoverInterrupted() throws {
        try execute(
            "UPDATE ez_entry SET data=json_set(data,'$.status','interrupted') WHERE json_extract(data,'$.status')='pending'"
        )
    }
    public func append(_ entry: HistoryEntry) throws {
        let previous = try recordMetadata(entry.recordID)?.revision
        _ = try commit(entry.recordID, snapshot: entry, write: HistoryWrite(expectedRevision: previous))
    }

    public func delete(_ id: RecordID, settledPending: Bool = false, expectedRevision: Int64? = nil) throws {
        guard let revision = try expectedRevision ?? recordMetadata(id)?.revision else { return }
        let write = HistoryWrite(expectedRevision: revision)
        if settledPending, case .native = id {
            _ = try maskLocallySettledAttempt(id, write: write)
        } else {
            _ = try mask(.record(id), write: write)
        }
    }

    public func load() throws -> [HistoryEntry] { try snapshot().entries() }

    func requireCurrentSchema() throws {
        guard try rows("PRAGMA user_version").first?["user_version"] as? Int64 == 5 else {
            throw EZError("Unsupported shared history version.")
        }
    }

    public func image(for entry: HistoryEntry, visibility: HistoryVisibility = .visible) throws -> Data? {
        try attachment(.output(entry.recordID, browserAttempt: entry.sourceRunID), visibility: visibility)
    }

    public func inputImage(for entry: HistoryEntry, visibility: HistoryVisibility = .visible) throws
        -> ImageAttachment?
    {
        guard let metadata = entry.inputImage else { return nil }
        guard let data = try attachment(.input(entry.recordID), visibility: visibility) else {
            throw EZError("The saved input image is unavailable.")
        }
        let image = try ImageAttachment(data: data, name: metadata.name)
        guard image.mediaType == metadata.mediaType else {
            throw EZError("The saved input image format changed.")
        }
        return image
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
    enum Transaction: String {
        case deferred = "DEFERRED"
        case immediate = "IMMEDIATE"
    }
    func transaction<T>(_ mode: Transaction = .immediate, _ body: () throws -> T) throws -> T {
        try execute("BEGIN \(mode.rawValue)")
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
    func execute(_ sql: String, _ values: [Any?] = []) throws {
        if values.isEmpty {
            guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else { throw failure() }
            return
        }
        let statement = try statement(sql, values)
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_DONE else { throw failure() }
    }
    func rows(_ sql: String, _ values: [Any?] = []) throws -> [[String: Any]] {
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
