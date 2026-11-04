import CryptoKit
import Darwin
import EZCore
import Foundation
import LocalAuthentication
import SaulCredentialStorage
import Security

package final class SharedAuthStorage: CredentialStore, Sendable {
    let records: VerifiedCredentialRecords
    let directory: URL
    let legacy: URL
    let retireEZ: @Sendable () throws -> Void
    package init(
        records: any CredentialRecords, directory: URL, legacy: URL,
        retireEZ: @escaping @Sendable () throws -> Void = { try SharedAuthStorage.retireLegacyEZ() }
    ) {
        self.records = VerifiedCredentialRecords(records)
        self.directory = directory
        self.legacy = legacy
        self.retireEZ = retireEZ
    }
    @MainActor package func read() async throws -> AuthState {
        try await Task.detached { try self.readState() }.value
    }
    private func readState() throws -> AuthState {
        if let data = try records.read(.chatGPT) {
            return try JSONDecoder().decode(AuthState.self, from: data)
        }
        guard FileManager.default.fileExists(atPath: legacy.path) else { return AuthState() }
        let lock = legacy.deletingLastPathComponent().appendingPathComponent("accounts.lock")
        let descriptor = open(lock.path, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0o600)
        guard descriptor >= 0 else {
            throw CredentialStorageError(
                "Finish Saul's current account operation before migrating its sign-in.")
        }
        defer {
            close(descriptor)
            try? FileManager.default.removeItem(at: lock)
        }
        try FileHandle(fileDescriptor: descriptor, closeOnDealloc: false).write(
            contentsOf: Data(String(getpid()).utf8))
        let data = try readPrivateFile(legacy)
        let converted = try LegacySaulCredentials.converted(data)
        let state = try JSONDecoder().decode(AuthState.self, from: converted)
        var receipt = try migration()
        receipt.sourceDigest = Self.digest(data)
        try saveMigration(receipt)
        try records.write(converted, to: .chatGPT)
        return state
    }
    package func write(_ state: AuthState) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        try records.write(encoder.encode(state), to: .chatGPT)
    }
    package func apiKey() throws -> String {
        guard let data = try records.read(.openAI), let value = String(data: data, encoding: .utf8) else {
            throw CredentialStorageError("Save an OpenAI API key in Saul Providers before running.")
        }
        return try validatedOpenAIKey(value)
    }
    package func saveKey(_ key: String?) throws {
        let data = try key.map { Data(try validatedOpenAIKey($0).utf8) }
        var receipt = try migration()
        receipt.apiMigrated = true
        // Record removal intent first so interruption cannot resurrect an old key.
        if key == nil { try saveMigration(receipt) }
        try records.write(data, to: .openAI)
        if key != nil { try saveMigration(receipt) }
    }
    package func importKey(_ key: String) throws {
        let receipt = try migration()
        // Repeated migrations must not restore a removed key or overwrite a newer shared key.
        if receipt.apiMigrated { return }
        if try !records.contains(.openAI) {
            try saveKey(key)
        } else {
            _ = try apiKey()
            var receipt = receipt
            receipt.apiMigrated = true
            try saveMigration(receipt)
        }
    }
    package func verifyMigration(for caller: CredentialCaller) throws -> Bool {
        var receipt = try migration()
        if receipt.completed { return true }
        _ = try records.read(.chatGPT)
        if try records.contains(.openAI) { _ = try apiKey() }
        if !receipt.clients.contains(caller.rawValue) { receipt.clients.append(caller.rawValue) }
        try saveMigration(receipt)
        guard Set(receipt.clients) == ["saul", "ez"] else { return false }
        if FileManager.default.fileExists(atPath: legacy.path) {
            let source = try readPrivateFile(legacy)
            guard receipt.sourceDigest == Self.digest(source) else {
                throw CredentialStorageError(
                    "Saul's old sign-in changed during migration. It was preserved; finish its old connection before retrying."
                )
            }
        }
        try retireEZ()
        if FileManager.default.fileExists(atPath: legacy.path) {
            try FileManager.default.removeItem(at: legacy)
        }
        receipt.completed = true
        try saveMigration(receipt)
        return true
    }
    package static func retireLegacyEZ() throws {
        let context = LAContext()
        context.interactionNotAllowed = true
        for (service, account) in [("local.ez.app.chatgpt", "accounts"), ("local.ez.app.openai", "api-key")] {
            let status = SecItemDelete(
                [
                    kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                    kSecAttrAccount as String: account,
                    kSecUseAuthenticationContext as String: context,
                ] as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else {
                throw CredentialStorageError(
                    "Shared connections work, but an old EZ record is still retained (\(status)). Retry cleanup explicitly."
                )
            }
        }
    }
    package func migrationCompleted() throws -> Bool { try migration().completed }
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
            throw CredentialStorageError("Unsupported Saul credential migration state. It was preserved.")
        }
        return receipt
    }
    private func saveMigration(_ receipt: Migration) throws {
        try JSONEncoder().encode(receipt).write(to: migrationURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: migrationURL.path)
    }
    private func readPrivateFile(_ url: URL) throws -> Data {
        let descriptor = open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else {
            throw CredentialStorageError("Cannot read Saul's original credential state. It was preserved.")
        }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer { try? handle.close() }
        var attributes = stat()
        guard fstat(descriptor, &attributes) == 0, attributes.st_uid == getuid(),
            attributes.st_mode & S_IFMT == S_IFREG, attributes.st_mode & 0o077 == 0,
            attributes.st_size <= 2_000_000
        else {
            throw CredentialStorageError(
                "Saul's original credential state must be an owner-only regular file.")
        }
        guard let data = try handle.read(upToCount: 2_000_001), data.count <= 2_000_000 else {
            throw CredentialStorageError("Saul's original credential state is invalid. It was preserved.")
        }
        return data
    }
    private static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
