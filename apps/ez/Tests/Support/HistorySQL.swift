import CSQLite
import Foundation

/// Inject real SQLite failures and inspect durable bytes without changing app routes.
public func historySQL(_ url: URL, _ sql: String) throws -> String? {
    var database: OpaquePointer?
    guard sqlite3_open_v2(url.path, &database, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK else {
        sqlite3_close(database)
        throw CheckFailure("Cannot open fixture history")
    }
    defer { sqlite3_close(database) }
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
