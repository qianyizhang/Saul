import CSQLite
import Foundation
import SaulTestSupport

/// Inject real SQLite failures and inspect durable bytes without changing app routes.
public func historySQL(_ url: URL, _ sql: String) throws -> String? {
    var database: OpaquePointer?
    guard sqlite3_open_v2(url.path, &database, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK else {
        sqlite3_close(database)
        throw CheckFailure("Cannot open fixture history")
    }
    defer { sqlite3_close(database) }
    // Match HistoryStore while the model finishes work on another connection.
    sqlite3_busy_timeout(database, 5000)
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else {
        throw CheckFailure(String(cString: sqlite3_errmsg(database)))
    }
    defer { sqlite3_finalize(statement) }
    let code = sqlite3_step(statement)
    guard code == SQLITE_ROW || code == SQLITE_DONE else {
        throw CheckFailure(String(cString: sqlite3_errmsg(database)))
    }
    guard code == SQLITE_ROW, let text = sqlite3_column_text(statement, 0) else { return nil }
    return String(cString: text)
}

/// Holds an independent SQLite write transaction through a reader's operations.
public final class HistoryFixtureWriter {
    public enum Reservation: String {
        case immediate = "IMMEDIATE"
        case exclusive = "EXCLUSIVE"
    }
    private var database: OpaquePointer?

    public init(_ url: URL, reservation: Reservation) throws {
        do {
            guard sqlite3_open_v2(url.path, &database, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK else {
                throw CheckFailure("Cannot open fixture writer")
            }
            try run("BEGIN \(reservation.rawValue)")
        } catch {
            sqlite3_close(database)
            database = nil
            throw error
        }
    }
    deinit { sqlite3_close(database) }

    public func run(_ sql: String) throws {
        guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else {
            throw CheckFailure(String(cString: sqlite3_errmsg(database)))
        }
    }
}
