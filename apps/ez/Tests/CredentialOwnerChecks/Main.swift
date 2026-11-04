import Darwin
import EZCore
import Foundation
import SaulCredentialOwner
import SaulCredentialStorage

private final class Records: CredentialRecords, @unchecked Sendable {
    var values: [CredentialRecord: Data] = [:]
    var denyRead = false
    var denyWrite = false
    func read(_ record: CredentialRecord) throws -> Data? {
        if denyRead { throw CredentialStorageError("Synthetic denial") }
        return values[record]
    }
    func contains(_ record: CredentialRecord) throws -> Bool { values[record] != nil }
    func write(_ data: Data?, to record: CredentialRecord) throws {
        if denyWrite { throw CredentialStorageError("Synthetic denial") }
        values[record] = data
    }
}
private enum Failure: Error { case check(String) }
private func expect(_ value: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !value() { throw Failure.check(message) }
}
private func denied(_ operation: () throws -> Void) throws {
    do { try operation() } catch is CredentialStorageError { return }
    throw Failure.check("Expected denial")
}
@main struct OwnerChecks {
    @MainActor static func main() async throws {
        let root = URL(fileURLWithPath: "/private/tmp/saul-owner-check-" + UUID().uuidString)
        try FileManager.default.createDirectory(
            at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: root) }
        let legacy = root.appendingPathComponent("accounts.json")
        let original = Data(
            #"{"version":1,"hostId":"fixture-host","accounts":[{"clientId":"saul-original","subject":"subject","email":"fixture@example.test","tokens":{"accessToken":"fixture-access","refreshToken":"fixture-refresh","idToken":"fixture-id","expiresAt":9999999999999,"scopes":["openid","chatgpt.tokens.use.direct"]}}]}"#
                .utf8)
        try original.write(to: legacy)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: legacy.path)
        let records = Records()
        let storage = SharedAuthStorage(records: records, directory: root, legacy: legacy, retireEZ: {})
        records.denyWrite = true
        do {
            _ = try await storage.read()
            throw Failure.check("Denied import succeeded")
        } catch is CredentialStorageError {}
        try expect(try Data(contentsOf: legacy) == original, "Denied import changed its source")
        records.denyWrite = false
        let state = try await storage.read()
        try expect(
            state.hostID == "fixture-host" && state.profiles.first?.id == "saul-original",
            "Registration changed")
        try expect(
            state.profiles.first?.credentials?.refreshToken == "fixture-refresh", "Refresh token changed")
        try expect(try !storage.verifyMigration(for: .saul), "One client retired the source")
        try expect(
            FileManager.default.fileExists(atPath: legacy.path), "Source retired before both clients verified"
        )
        records.denyRead = true
        try denied { _ = try storage.verifyMigration(for: .ez) }
        records.denyRead = false
        try expect(FileManager.default.fileExists(atPath: legacy.path), "Denied verification retired source")
        let failingCleanup = SharedAuthStorage(
            records: records, directory: root, legacy: legacy,
            retireEZ: { throw CredentialStorageError("Synthetic legacy denial") })
        try denied { _ = try failingCleanup.verifyMigration(for: .ez) }
        try expect(FileManager.default.fileExists(atPath: legacy.path), "Denied cleanup removed Saul source")
        try expect(try storage.verifyMigration(for: .ez), "Retry did not complete cleanup")
        try expect(!FileManager.default.fileExists(atPath: legacy.path), "Verified source was not retired")
        try expect(try storage.verifyMigration(for: .saul), "Completed migration was not idempotent")
        records.denyWrite = true
        try denied { try storage.importKey("fixture-original-key") }
        records.denyWrite = false
        try storage.importKey("fixture-original-key")
        try storage.importKey("fixture-stale-key")
        try expect(try storage.apiKey() == "fixture-original-key", "Repeated adoption replaced shared key")
        try storage.saveKey(nil)
        try storage.importKey("fixture-stale-key")
        try denied { _ = try storage.apiKey() }
        try expect(records.values[.chatGPT] != nil, "Key removal removed ChatGPT")
        try storage.saveKey("fixture-new-key")
        records.denyWrite = true
        try denied { try storage.saveKey("fixture-rejected-key") }
        records.denyWrite = false
        try expect(try storage.apiKey() == "fixture-new-key", "Denied replacement changed key")
        var replies: [[String: Any]] = []
        let owner = CredentialOwner(storage: storage, caller: .saul) { replies.append($0) }
        let frame = try JSONSerialization.data(withJSONObject: [
            "version": 1, "id": "test", "request": ["action": "status"],
        ])
        try await owner.run(CredentialRequest.decode(frame, caller: .saul))
        let summary = try JSONSerialization.data(withJSONObject: replies)
        try expect(
            !String(decoding: summary, as: UTF8.self).contains("fixture-access"),
            "Status exposed access token")
        try expect(
            !String(decoding: summary, as: UTF8.self).contains("fixture-refresh"),
            "Status exposed refresh token")
        try expect(
            !String(decoding: summary, as: UTF8.self).contains("fixture-new-key"), "Status exposed API key")
        // Changed legacy input remains available for a deliberate clean-slate decision.
        let changedRoot = root.appendingPathComponent("changed")
        try FileManager.default.createDirectory(
            at: changedRoot, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let changedLegacy = changedRoot.appendingPathComponent("accounts.json")
        try original.write(to: changedLegacy)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: changedLegacy.path)
        let changed = SharedAuthStorage(
            records: Records(), directory: changedRoot, legacy: changedLegacy, retireEZ: {})
        _ = try await changed.read()
        _ = try changed.verifyMigration(for: .saul)
        try Data((String(decoding: original, as: UTF8.self) + " ").utf8).write(to: changedLegacy)
        try denied { _ = try changed.verifyMigration(for: .ez) }
        try expect(FileManager.default.fileExists(atPath: changedLegacy.path), "Changed source was deleted")
        print(
            "Credential owner checks passed: denied import/save/read/retirement, exact registration, two-client verification, retry, no key resurrection and secret-free status."
        )
    }
}
