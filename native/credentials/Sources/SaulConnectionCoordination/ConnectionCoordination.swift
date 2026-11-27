import CSQLite
import CryptoKit
import Foundation
import SaulNativeValues

package struct ConnectionBinding: Equatable, Sendable {
  package let key: String?
  package let accountID: String?
  package init(key: String?, accountID: String? = nil) {
    self.key = key
    self.accountID = accountID
  }
  fileprivate var locks: Set<String> {
    var result: Set<String> = []
    if let key { result.insert("key:" + key) }
    if let accountID { result.insert("plan:" + accountID) }
    return result
  }
}

package struct ConnectionReservation: Encodable {
  package let connectionKey: String
  package let accountId: String?
  package let origin: String
  package let operationId: UUID
  package let token: UUID

  fileprivate var binding: ConnectionBinding {
    ConnectionBinding(key: connectionKey, accountID: accountId)
  }
}

package struct ConnectionReservationStatus: Encodable {
  package let active: Bool
  fileprivate let reservation: ConnectionReservation

  package func encode(to encoder: Encoder) throws {
    try reservation.encode(to: encoder)
    var keyed = encoder.container(keyedBy: ActivityKey.self)
    try keyed.encode(active, forKey: .active)
  }

  private enum ActivityKey: String, CodingKey { case active }
}

public enum ConnectionCoordinationError: LocalizedError {
  case busy
  case reserved(String)
  case staleSetup
  case changedCredential
  case unavailable

  public var errorDescription: String? {
    switch self {
    case .busy: "This connection is busy. Try again after the current work stops."
    case .reserved(let origin):
      "Finish or release the connection setup in \(origin == "ez" ? "EZ" : "Saul") before using this connection."
    case .staleSetup: "Connection setup changed. Review the current setup before continuing."
    case .changedCredential:
      "This connection changed during the run. Start again with the saved connection."
    case .unavailable:
      "Shared connection coordination is unavailable. Check the helper and settings."
    }
  }
}

/// Coordination stores only public metadata. Each live lease owns its SQLite connection.
package final class ConnectionLease {
  fileprivate let databases: [CoordinationDatabase]
  fileprivate init(_ databases: [CoordinationDatabase]) { self.databases = databases }
}

public struct ConnectionCoordination {
  public enum SettingsLockError: LocalizedError {
    case busy
    case unavailable

    public var errorDescription: String? {
      switch self {
      case .busy: "Configuration is busy. Try Save again."
      case .unavailable: "Cannot open the configuration lock."
      }
    }
  }

  public let settingsURL: URL
  public init(settingsURL: URL) { self.settingsURL = settingsURL }

  private var registryURL: URL { URL(fileURLWithPath: settingsURL.path + ".lock.sqlite3") }
  private var bindingDirectory: URL {
    URL(fileURLWithPath: settingsURL.path + ".connections", isDirectory: true)
  }

  package func read(
    _ binding: ConnectionBinding, generation expected: String? = nil
  ) throws -> (lease: ConnectionLease, generation: String) {
    try registry { database in
      let scopes = binding.locks
      try Self.requireUnreserved(scopes, in: database)
      let lease = try acquire(scopes, exclusive: false)
      let generations = try scopes.sorted().map { scope in
        let counter =
          try database.rows(
            "SELECT generation FROM binding_generation WHERE binding = ?", [scope]
          ).first.flatMap { $0[0] } ?? "0"
        return scope + "\u{0}" + counter
      }
      let generation = Self.digest(generations.joined(separator: "\u{0}"))
      if let expected, generation != expected {
        throw ConnectionCoordinationError.changedCredential
      }
      return (lease, generation)
    }
  }

  package func mutate(
    _ binding: ConnectionBinding, origin: String, token: UUID?
  ) throws -> ConnectionLease {
    try registry { database in
      var scopes = binding.locks
      if let token {
        let record = try Self.reservations(in: database).first {
          $0.origin == origin && $0.token == token
            && (binding.key == nil || binding.key == $0.connectionKey)
            && (binding.accountID == nil || $0.accountId == binding.accountID)
        }
        guard let record else { throw ConnectionCoordinationError.staleSetup }
        try requireLiveSetup(record)
        scopes.formUnion(record.binding.locks)
        try Self.requireUnreserved(scopes, except: token, in: database)
      } else {
        try Self.requireUnreserved(scopes, in: database)
      }
      let lease = try acquire(scopes, exclusive: true)
      for scope in scopes.sorted() {
        try database.run(
          """
          INSERT INTO binding_generation(binding, generation) VALUES (?, 1)
          ON CONFLICT(binding) DO UPDATE SET generation = generation + 1
          """, [scope])
      }
      return lease
    }
  }

  package func holdSetup(
    _ binding: ConnectionBinding, origin: String, operationID: UUID, previousToken: UUID?
  ) throws -> (ConnectionLease, ConnectionReservation) {
    guard let key = binding.key else { throw ConnectionCoordinationError.staleSetup }
    return try registry { database in
      let current = try Self.reservations(in: database).first { $0.connectionKey == key }
      if let previousToken {
        guard let current, current.token == previousToken, current.operationId == operationID,
          current.origin == origin, current.binding == binding
        else { throw ConnectionCoordinationError.staleSetup }
      } else if let current {
        throw ConnectionCoordinationError.reserved(current.origin)
      }
      try Self.requireUnreserved(binding.locks, except: previousToken, in: database)
      let live = try acquire(["setup:" + key], exclusive: true)
      let effects = try acquire(binding.locks, exclusive: true)
      defer { withExtendedLifetime(effects) {} }
      let record = ConnectionReservation(
        connectionKey: key, accountId: binding.accountID, origin: origin,
        operationId: operationID, token: UUID())
      try database.run(
        """
        INSERT INTO connection_setup_reservation(connection_key, account_id, origin, operation_id, token)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(connection_key) DO UPDATE SET token = excluded.token
        """, [key, binding.accountID, origin, Self.id(operationID), Self.id(record.token)])
      return (live, record)
    }
  }

  package func bindAccount(_ accountID: String, origin: String, token: UUID) throws {
    try registry { database in
      guard
        let current = try Self.reservations(in: database).first(where: {
          $0.origin == origin && $0.token == token && $0.accountId == nil
        })
      else { throw ConnectionCoordinationError.staleSetup }
      try requireLiveSetup(current)
      let scope: Set<String> = ["plan:" + accountID]
      try Self.requireUnreserved(scope, except: token, in: database)
      let lease = try acquire(scope, exclusive: true)
      defer { withExtendedLifetime(lease) {} }
      try database.run(
        "UPDATE connection_setup_reservation SET account_id = ? WHERE token = ?",
        [accountID, Self.id(token)])
    }
  }

  package func release(_ fence: ConnectionFence) throws {
    try registry { database in
      guard
        let current = try Self.reservations(in: database).first(where: {
          $0.connectionKey == fence.connectionKey
        })
      else { return }
      guard current.token == fence.token else { throw ConnectionCoordinationError.staleSetup }
      let live = try acquire(["setup:" + current.connectionKey], exclusive: true)
      let effects = try acquire(current.binding.locks, exclusive: true)
      defer { withExtendedLifetime((live, effects)) {} }
      try database.run(
        "DELETE FROM connection_setup_reservation WHERE connection_key = ? AND token = ?",
        [current.connectionKey, Self.id(fence.token)])
    }
  }

  package func setups() throws -> [ConnectionReservationStatus] {
    try registry { database in
      try Self.reservations(in: database).map { reservation in
        do {
          _ = try acquire(
            reservation.binding.locks.union(["setup:" + reservation.connectionKey]),
            exclusive: true)
          return ConnectionReservationStatus(active: false, reservation: reservation)
        } catch ConnectionCoordinationError.busy {
          return ConnectionReservationStatus(active: true, reservation: reservation)
        }
      }
    }
  }

  /// Prepare the replacement under the document lock, then fence its commit against live work.
  public func withSettingsTransaction<T>(
    origin: String, fence: ConnectionFence?,
    prepare: () throws -> (
      before: [ConnectionDefinition], after: [ConnectionDefinition], write: () throws -> T
    )
  ) throws -> T {
    let database: CoordinationDatabase
    do {
      database = try openRegistryTransaction()
    } catch ConnectionCoordinationError.busy {
      throw SettingsLockError.busy
    } catch ConnectionCoordinationError.unavailable {
      throw SettingsLockError.unavailable
    }
    defer { try? database.run("ROLLBACK") }
    let change = try prepare()
    return try withSettingsWrite(
      in: database, before: change.before, after: change.after, origin: origin, fence: fence,
      write: change.write)
  }

  private func withSettingsWrite<T>(
    in database: CoordinationDatabase, before: [ConnectionDefinition],
    after: [ConnectionDefinition],
    origin: String, fence: ConnectionFence?, write: () throws -> T
  ) throws -> T {
    let prior = Dictionary(uniqueKeysWithValues: before.map { ($0.key, $0) })
    let next = Dictionary(uniqueKeysWithValues: after.map { ($0.key, $0) })
    let changed = Set(prior.keys).union(next.keys).filter { prior[$0] != next[$0] }
    if changed.isEmpty && fence == nil { return try write() }
    let scopes = Set(
      changed.flatMap { key in
        ["key:" + key]
          + [prior[key]?.accountId, next[key]?.accountId].compactMap { $0.map { "plan:" + $0 } }
      })
    if let fence {
      guard changed.allSatisfy({ $0 == fence.connectionKey }),
        let record = try Self.reservations(in: database).first(where: {
          $0.connectionKey == fence.connectionKey && $0.origin == origin && $0.token == fence.token
        }),
        record.accountId == nil || next[fence.connectionKey]?.accountId == record.accountId
      else { throw ConnectionCoordinationError.staleSetup }
      try requireLiveSetup(record)
    }
    try Self.requireUnreserved(scopes, except: fence?.token, in: database)
    let lease = try acquire(scopes, exclusive: true)
    defer { withExtendedLifetime(lease) {} }
    return try write()
  }

  private func requireLiveSetup(_ record: ConnectionReservation) throws {
    do {
      _ = try acquire(["setup:" + record.connectionKey], exclusive: true)
    } catch ConnectionCoordinationError.busy {
      return
    }
    throw ConnectionCoordinationError.staleSetup
  }

  private static func requireUnreserved(
    _ scopes: Set<String>, except token: UUID? = nil, in database: CoordinationDatabase
  ) throws {
    if let record = try reservations(in: database).first(where: {
      $0.token != token && !scopes.isDisjoint(with: $0.binding.locks)
    }) {
      throw ConnectionCoordinationError.reserved(record.origin)
    }
  }

  private func openRegistryTransaction() throws -> CoordinationDatabase {
    try FileManager.default.createDirectory(
      at: settingsURL.deletingLastPathComponent(), withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700])
    let database = try CoordinationDatabase(opening: registryURL)
    try database.run("PRAGMA busy_timeout = 5000")
    try database.run("BEGIN IMMEDIATE")
    return database
  }

  private func registry<T>(_ operation: (CoordinationDatabase) throws -> T) throws -> T {
    let database = try openRegistryTransaction()
    do {
      try database.run(
        """
        CREATE TABLE IF NOT EXISTS connection_setup_reservation(
          connection_key TEXT PRIMARY KEY, account_id TEXT UNIQUE, origin TEXT NOT NULL,
          operation_id TEXT NOT NULL UNIQUE, token TEXT NOT NULL UNIQUE
        ) WITHOUT ROWID
        """)
      try database.run(
        """
        CREATE TABLE IF NOT EXISTS binding_generation(
          binding TEXT PRIMARY KEY, generation INTEGER NOT NULL
        ) WITHOUT ROWID
        """)
      let result = try operation(database)
      try database.run("COMMIT")
      return result
    } catch {
      try? database.run("ROLLBACK")
      throw error
    }
  }

  private func acquire(_ scopes: Set<String>, exclusive: Bool) throws -> ConnectionLease {
    if scopes.isEmpty { return ConnectionLease([]) }
    try FileManager.default.createDirectory(
      at: bindingDirectory, withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700])
    let attributes = try FileManager.default.attributesOfItem(atPath: bindingDirectory.path)
    guard attributes[.type] as? FileAttributeType == .typeDirectory,
      attributes[.ownerAccountID] as? UInt32 == getuid(),
      (attributes[.posixPermissions] as? Int ?? 0o777) & 0o077 == 0
    else { throw ConnectionCoordinationError.unavailable }
    let databases = try scopes.sorted().map { scope in
      let database = try CoordinationDatabase(
        opening: bindingDirectory.appendingPathComponent(Self.digest(scope) + ".sqlite3"))
      if exclusive {
        try database.run("BEGIN EXCLUSIVE")
      } else {
        try database.run("BEGIN")
        _ = try database.rows("SELECT name FROM sqlite_schema LIMIT 1")
      }
      return database
    }
    return ConnectionLease(databases)
  }

  private static func reservations(in database: CoordinationDatabase) throws
    -> [ConnectionReservation]
  {
    guard
      !(try database.rows(
        "SELECT 1 FROM sqlite_schema WHERE name = 'connection_setup_reservation' LIMIT 1")).isEmpty
    else { return [] }
    return try database.rows(
      """
      SELECT connection_key, account_id, origin, operation_id, token
      FROM connection_setup_reservation ORDER BY connection_key
      """
    ).map {
      guard let key = $0[0], let origin = $0[2], ["ez", "saul"].contains(origin),
        let operation = $0[3].flatMap(UUID.init(uuidString:)),
        let token = $0[4].flatMap(UUID.init(uuidString:))
      else { throw ConnectionCoordinationError.unavailable }
      return ConnectionReservation(
        connectionKey: key, accountId: $0[1], origin: origin, operationId: operation, token: token)
    }
  }

  private static func id(_ id: UUID) -> String { id.uuidString.lowercased() }
  private static func digest(_ value: String) -> String {
    SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
  }
}

private final class CoordinationDatabase {
  private let connection: OpaquePointer?
  private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

  init(opening url: URL) throws {
    var handle: OpaquePointer?
    let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_NOFOLLOW
    // Darwin's system aliases are normal inputs from temporaryDirectory and tmpdir().
    // Keep NOFOLLOW for every remaining path component, including the file itself.
    let path = url.path
    let lockPath = path.hasPrefix("/var/") || path.hasPrefix("/tmp/") ? "/private" + path : path
    if let kind = try? FileManager.default.attributesOfItem(atPath: lockPath)[.type],
      kind as? FileAttributeType != .typeRegular
    {
      throw ConnectionCoordinationError.unavailable
    }
    guard sqlite3_open_v2(lockPath, &handle, flags, nil) == SQLITE_OK else {
      sqlite3_close(handle)
      throw ConnectionCoordinationError.unavailable
    }
    do {
      try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: lockPath)
    } catch {
      sqlite3_close(handle)
      throw error
    }
    connection = handle
  }

  deinit { sqlite3_close(connection) }

  private func check(_ code: Int32) throws {
    if code == SQLITE_BUSY || code == SQLITE_LOCKED { throw ConnectionCoordinationError.busy }
    guard code == SQLITE_OK else { throw ConnectionCoordinationError.unavailable }
  }

  func run(_ sql: String, _ bindings: [String?] = []) throws {
    if bindings.isEmpty {
      try check(sqlite3_exec(connection, sql, nil, nil, nil))
    } else {
      _ = try rows(sql, bindings)
    }
  }

  func rows(_ sql: String, _ bindings: [String?] = []) throws -> [[String?]] {
    var statement: OpaquePointer?
    try check(sqlite3_prepare_v2(connection, sql, -1, &statement, nil))
    defer { sqlite3_finalize(statement) }
    for (index, value) in bindings.enumerated() {
      let position = Int32(index + 1)
      try check(
        value.map { sqlite3_bind_text(statement, position, $0, -1, transient) }
          ?? sqlite3_bind_null(statement, position))
    }
    var result: [[String?]] = []
    while true {
      let status = sqlite3_step(statement)
      if status == SQLITE_DONE { return result }
      if status != SQLITE_ROW { try check(status) }
      result.append(
        (0..<sqlite3_column_count(statement)).map { index in
          sqlite3_column_text(statement, index).map { String(cString: $0) }
        })
    }
  }
}
