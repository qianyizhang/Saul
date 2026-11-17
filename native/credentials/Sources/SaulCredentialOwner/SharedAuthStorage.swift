import Darwin
import Foundation
import SaulCredentialClient
import SaulNativeValues

package final class SharedAuthStorage: CredentialStore, Sendable {
  let records: VerifiedCredentialRecords
  let directory: URL
  package init(records: any CredentialRecords, directory: URL) {
    self.records = VerifiedCredentialRecords(records)
    self.directory = directory
  }
  @MainActor package func read() async throws -> AuthState {
    try await Task.detached { try self.readState() }.value
  }
  private func readState() throws -> AuthState {
    if let data = try records.read(.chatGPT) {
      return try JSONDecoder().decode(AuthState.self, from: data)
    }
    return AuthState()
  }
  package func write(_ state: AuthState) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    try records.write(encoder.encode(state), to: .chatGPT)
  }
  package func apiKey() throws -> String {
    guard let data = try records.read(.openAI), let value = String(data: data, encoding: .utf8)
    else {
      throw CredentialStorageError("Save an OpenAI API key in Connections before running.")
    }
    return try validatedOpenAIKey(value)
  }
  package func saveKey(_ key: String?) throws {
    let data = try key.map { Data(try validatedOpenAIKey($0).utf8) }
    try records.write(data, to: .openAI)
  }

  // Keep the existing owner-local receipt shape: older shared registrations
  // may have a live pause here. The receipt never drives credential import.
  func isPaused(_ id: String) throws -> Bool { try migration().pausedAccounts.contains(id) }
  func pause(_ id: String, value: Bool) throws {
    var receipt = try migration()
    receipt.pausedAccounts.removeAll { $0 == id }
    if value { receipt.pausedAccounts.append(id) }
    try saveMigration(receipt)
  }
  private struct Migration: Codable {
    var version = 1
    var sourceDigest: String?
    var apiMigrated = false
    var clients: [String] = []
    var pausedAccounts: [String] = []
    var completed = false
  }
  private var migrationURL: URL { directory.appendingPathComponent("migration.json") }
  private func migration() throws -> Migration {
    guard FileManager.default.fileExists(atPath: migrationURL.path) else { return Migration() }
    let receipt = try JSONDecoder().decode(Migration.self, from: readPrivateFile(migrationURL))
    guard receipt.version == 1, Set(receipt.clients).isSubset(of: ["saul", "ez"]) else {
      throw CredentialStorageError("Unsupported Saul credential policy. It was preserved.")
    }
    return receipt
  }
  private func saveMigration(_ receipt: Migration) throws {
    try JSONEncoder().encode(receipt).write(to: migrationURL, options: .atomic)
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o600], ofItemAtPath: migrationURL.path)
  }
  private func readPrivateFile(_ url: URL) throws -> Data {
    let descriptor = open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
    guard descriptor >= 0 else {
      throw CredentialStorageError("Cannot read Saul's saved credential policy. It was preserved.")
    }
    let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
    defer { try? handle.close() }
    var attributes = stat()
    guard fstat(descriptor, &attributes) == 0, attributes.st_uid == getuid(),
      attributes.st_mode & S_IFMT == S_IFREG, attributes.st_mode & 0o077 == 0,
      attributes.st_size <= 2_000_000
    else {
      throw CredentialStorageError(
        "Saul's saved credential policy must be an owner-only regular file.")
    }
    guard let data = try handle.read(upToCount: 2_000_001), data.count <= 2_000_000 else {
      throw CredentialStorageError("Saul's saved credential policy is invalid. It was preserved.")
    }
    return data
  }
}
