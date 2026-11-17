import Darwin
import Foundation
import SaulCredentialClient
import SaulCredentialOwner
import SaulTestSupport

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
  @MainActor static func main() async {
    let legacy = CheckCase("credentials: legacy sources and pauses remain intact") { directory in
      try await legacyChecks(in: directory)
    }
    exit(
      await CheckRunner.run(
        [legacy] + identityChecks() + authenticationChecks() + illustrationChecks()
          + planCatalogChecks()
          + compatibleChatChecks() + cacheRecoveryChecks() + apiModelCapabilityChecks()))
  }

  @MainActor private static func legacyChecks(in root: URL) async throws {
    try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
    let legacy = root.appendingPathComponent("accounts.json")
    let original = Data(
      #"{"version":1,"hostId":"fixture-host","accounts":[{"clientId":"saul-original","subject":"subject","email":"fixture@example.test","tokens":{"accessToken":"fixture-access","refreshToken":"fixture-refresh","idToken":"fixture-id","expiresAt":9999999999999,"scopes":["openid","chatgpt.tokens.use.direct"]}}]}"#
        .utf8)
    try original.write(to: legacy)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: legacy.path)
    let records = Records()
    let storage = SharedAuthStorage(records: records, directory: root)
    let empty = try await storage.read()
    try expect(empty.profiles.isEmpty, "A legacy sign-in was imported")
    try expect(records.values[.chatGPT] == nil, "Reading absent shared state wrote Keychain")
    let shared = Data(
      #"{"hostID":"fixture-host","selectedID":"saul-existing","profiles":[{"clientID":"saul-existing","subject":"subject","credentials":{"accessToken":"fixture-access","refreshToken":"fixture-refresh","idToken":"fixture-id","expiresAt":3000000000,"scopes":["chatgpt.tokens.use.direct"]}}]}"#
        .utf8)
    records.values[.chatGPT] = shared
    let state = try await storage.read()
    try expect(
      state.hostID == "fixture-host" && state.selectedID == "saul-existing",
      "Existing shared registration changed")
    records.denyRead = true
    do {
      _ = try await storage.read()
      throw Failure.check("A denied shared read was not reported")
    } catch is CredentialStorageError {}
    records.denyRead = false
    try storage.saveKey(nil)
    try expect(records.values[.chatGPT] != nil, "Key removal removed ChatGPT")
    try storage.saveKey("fixture-new-key")
    records.denyWrite = true
    try denied { try storage.saveKey("fixture-rejected-key") }
    records.denyWrite = false
    try expect(try storage.apiKey() == "fixture-new-key", "Denied replacement changed key")
    var replies: [[String: Any]] = []
    let owner = CredentialOwner(storage: storage) { replies.append($0) }
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
      !String(decoding: summary, as: UTF8.self).contains("fixture-new-key"),
      "Status exposed API key")
    func planContent(_ extras: [String: Any]) throws -> Any {
      let defaults: [String: Any] = [
        "action": "generate", "accountId": "fixture", "model": "m", "systemPrompt": "",
      ]
      let frame = try JSONSerialization.data(withJSONObject: [
        "version": 2, "id": "plan-attachment",
        "request": defaults.merging(extras) { _, new in new },
      ])
      guard case .generate(let text) = try CredentialRequest.decode(frame, caller: .saul).operation
      else {
        throw Failure.check("Validated generation request did not retain its command type")
      }
      return CredentialOwner.planContent(text)
    }
    let image = "data:image/jpeg;base64,YQ=="
    let content =
      try planContent([
        "userPrompt": "Evidence", "images": [image],
        "attachments": [["type": "pdf-url", "url": "https://example.test/paper.pdf"]],
      ]) as? [[String: String]]
    try expect(
      content == [
        ["type": "input_text", "text": "Evidence"],
        ["type": "input_image", "image_url": image, "detail": "auto"],
        ["type": "input_file", "file_url": "https://example.test/paper.pdf"],
      ], "Image input silently removed the PDF attachment")
    try expect(
      try planContent(["userPrompt": "Text"]) as? String == "Text", "Text-only input changed")
    let receipt = root.appendingPathComponent("migration.json")
    let originalReceipt = Data(
      #"{"version":1,"apiMigrated":true,"clients":["saul","ez"],"pausedAccounts":["saul-existing"],"completed":true}"#
        .utf8)
    try originalReceipt.write(to: receipt)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: receipt.path)
    let generate = try JSONSerialization.data(withJSONObject: [
      "version": 2, "id": "paused",
      "request": [
        "action": "generate", "accountId": "saul-existing", "model": "fixture-model",
        "systemPrompt": "", "userPrompt": "Fixture notice",
      ],
    ])
    do {
      try await owner.run(CredentialRequest.decode(generate, caller: .saul))
      throw Failure.check("An existing account pause was lost")
    } catch let error as CredentialStorageError {
      try expect(error.localizedDescription.contains("paused"), "Expected preserved pause")
    }
    try expect(try Data(contentsOf: receipt) == originalReceipt, "Pause check rewrote receipt")
    try expect(try Data(contentsOf: legacy) == original, "Legacy credentials changed")
    try expect(records.values[.chatGPT] == shared, "Unexpected Keychain credential mutation")
  }
}
