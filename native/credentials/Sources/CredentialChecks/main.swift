import Darwin
import Foundation
import SaulCredentialStorage

final class MemoryRecords: CredentialRecords, @unchecked Sendable {
  var values: [CredentialRecord: Data] = [:]
  var rejectWrites = false
  var rejectReads = false
  var corruptWrite = false
  func read(_ record: CredentialRecord) throws -> Data? {
    if rejectReads { throw CredentialStorageError("Synthetic denied read") }
    return values[record]
  }
  func contains(_ record: CredentialRecord) throws -> Bool { values[record] != nil }
  func write(_ data: Data?, to record: CredentialRecord) throws {
    if rejectWrites { throw CredentialStorageError("Synthetic denied write") }
    values[record] = corruptWrite && data != nil ? Data("damaged".utf8) : data
  }
}

enum CheckFailure: Error { case failed(String) }
func expect(_ value: @autoclosure () throws -> Bool, _ message: String) throws {
  guard try value() else { throw CheckFailure.failed(message) }
}
func rejects(_ operation: () throws -> Void) throws {
  do { try operation() } catch is CredentialStorageError { return }
  throw CheckFailure.failed("Expected a credential storage rejection")
}

@main struct CredentialChecks {
  static func main() async throws {
    if CommandLine.arguments.dropFirst() == ["--echo-frame"] {
      var frames = NativeFrames()
      while let data = try NativeFrames.readChunk(from: STDIN_FILENO) {
        if let frame = try frames.append(data).first {
          try FileHandle.standardOutput.write(
            contentsOf: NativeFrames.encode(["bytes": frame.count]))
          return
        }
      }
      throw CheckFailure.failed("No frame received")
    }
    if CommandLine.arguments.count == 4, CommandLine.arguments[1] == "--hold-lock" {
      let lease = try await CredentialLease.acquire(
        in: URL(fileURLWithPath: CommandLine.arguments[2]))
      try Data().write(to: URL(fileURLWithPath: CommandLine.arguments[3]))
      var byte: UInt8 = 0
      _ = read(STDIN_FILENO, &byte, 1)
      withExtendedLifetime(lease) {}
      return
    }
    let memory = MemoryRecords()
    let vault = VerifiedCredentialRecords(memory)
    let original = Data("synthetic original".utf8)
    try vault.write(original, to: .chatGPT)
    memory.rejectWrites = true
    try rejects { try vault.write(Data("replacement".utf8), to: .chatGPT) }
    try expect(memory.values[.chatGPT] == original, "Denied write replaced the saved session")
    memory.rejectWrites = false
    memory.rejectReads = true
    try rejects { _ = try vault.read(.chatGPT) }
    memory.rejectReads = false
    memory.corruptWrite = true
    try rejects { try vault.write(Data("replacement".utf8), to: .chatGPT) }
    memory.corruptWrite = false
    try vault.write(original, to: .chatGPT)
    try vault.write(Data("synthetic key".utf8), to: .openAI)
    try vault.write(nil, to: .openAI)
    try expect(try vault.read(.chatGPT) == original, "API removal changed the OAuth record")

    let legacy = Data(
      """
      {"version":1,"hostId":"urn:uuid:fixture-host","accounts":[
        {"clientId":"saul-original","email":"same@example.test","subject":"subject-a","tokens":{
          "accessToken":"fixture-access","refreshToken":"fixture-refresh","idToken":"fixture-identity",
          "expiresAt":1793800000000,"scopes":["openid","chatgpt.tokens.use.direct"]}},
        {"clientId":"saul-second","email":"same@example.test","subject":"subject-a"}]}
      """.utf8)
    guard
      let imported = try JSONSerialization.jsonObject(
        with: LegacySaulCredentials.converted(legacy, selectedID: "saul-original"))
        as? [String: Any],
      let profiles = imported["profiles"] as? [[String: Any]],
      let credentials = profiles.first?["credentials"] as? [String: Any]
    else { throw CheckFailure.failed("Invalid imported credentials") }
    try expect(profiles.count == 2, "Same-email registrations were merged")
    try expect(imported["hostID"] as? String == "urn:uuid:fixture-host", "Host identity changed")
    try expect(
      imported["selectedID"] as? String == "saul-original", "Selected registration changed")
    try expect(
      credentials["refreshToken"] as? String == "fixture-refresh",
      "Rotating token lost its registration")
    try expect(
      credentials["expiresAt"] as? Double
        == Date(timeIntervalSince1970: 1_793_800_000).timeIntervalSinceReferenceDate,
      "Expiry units changed")
    try rejects { _ = try LegacySaulCredentials.converted(legacy, selectedID: "ez-discarded") }
    try rejects { _ = try LegacySaulCredentials.converted(Data("{\"version\":99}".utf8)) }

    let frameOne = try NativeFrames.encode(["id": "a", "request": ["action": "status"]])
    let frameTwo = try NativeFrames.encode(["id": "b", "request": ["action": "accounts"]])
    var frames = NativeFrames()
    var received: [Data] = []
    for byte in frameOne + frameTwo { received += try frames.append(Data([byte])) }
    try frames.requireComplete()
    try expect(received.count == 2, "Fragmented and consecutive frames were not decoded")
    var broken = NativeFrames()
    try rejects { _ = try broken.append(Data([255, 255, 255, 255])) }
    broken = NativeFrames()
    _ = try broken.append(Data([1]))
    try rejects { try broken.requireComplete() }
    try rejects { _ = try NativeCaller.authorize(arguments: ["--raw-secret"], extensionIDs: []) }
    func request(_ operation: [String: Any], version: Any = 1, caller: CredentialCaller = .saul)
      throws
    {
      _ = try CredentialRequest.decode(
        JSONSerialization.data(withJSONObject: [
          "version": version, "id": "fixture", "request": operation,
        ]), caller: caller)
    }
    try request(["action": "status"])
    try rejects { try request(["action": "status"], version: true) }
    try rejects {
      try request([
        "action": "api-chat", "model": "m", "systemPrompt": "", "userPrompt": "u",
        "url": "https://evil.test",
      ])
    }
    try rejects { try request(["action": "login", "consent": 1]) }
    let response: [String: Any] = [
      "model": "fixture", "input": [["role": "user", "content": "hello"]], "store": false,
      "stream": true,
    ]
    try request(
      ["action": "native-responses", "provider": "openai-api", "body": response], caller: .ez)
    try rejects {
      try request(["action": "native-responses", "provider": "openai-api", "body": response])
    }
    var invalidBody = response
    invalidBody["store"] = 0
    try rejects {
      try request(
        ["action": "native-responses", "provider": "openai-api", "body": invalidBody], caller: .ez)
    }
    invalidBody = response
    invalidBody["input"] = [
      ["role": "user", "content": [["type": "input_file", "file_url": "file:///private"]]]
    ]
    try rejects {
      try request(
        ["action": "native-responses", "provider": "openai-api", "body": invalidBody], caller: .ez)
    }
    var sse = CredentialSSE()
    var events: [Data] = []
    for byte in Data("data: 你好\r\n\r\ndata: one\ndata: two\n\n".utf8) {
      if let data = try sse.append(byte) { events.append(data) }
    }
    try sse.requireComplete()
    try expect(
      events.map { String(decoding: $0, as: UTF8.self) } == ["你好", "one\ntwo"],
      "Fragmented UTF-8 SSE changed")
    _ = try sse.append(255)
    try rejects { _ = try sse.append(10) }
    try expect(
      try OfficialOpenAI.request(route: .chat, body: nil, credential: "fixture").url?.absoluteString
        == "https://api.openai.com/v1/chat/completions", "Credential destination changed")

    let root = URL(fileURLWithPath: "/private/tmp").appendingPathComponent(
      "saul-credential-check-" + UUID().uuidString)
    try FileManager.default.createDirectory(
      at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: root) }
    let marker = root.appendingPathComponent("ready")
    let echo = Process()
    echo.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
    echo.arguments = ["--echo-frame"]
    let echoInput = Pipe()
    let echoOutput = Pipe()
    echo.standardInput = echoInput
    echo.standardOutput = echoOutput
    try echo.run()
    // Input remains open: a correct full-duplex read must reply before EOF.
    try echoInput.fileHandleForWriting.write(contentsOf: frameOne)
    let timeout = Task.detached {
      try? await Task.sleep(for: .seconds(5))
      if echo.isRunning { echo.terminate() }
    }
    let echoed = try NativeFrames.readChunk(from: echoOutput.fileHandleForReading.fileDescriptor)
    timeout.cancel()
    echo.waitUntilExit()
    try expect(
      echoed != nil && echo.terminationStatus == 0, "Live pipe waited for EOF instead of replying")
    try echoInput.fileHandleForWriting.close()
    let child = Process()
    child.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
    child.arguments = ["--hold-lock", root.path, marker.path]
    let input = Pipe()
    child.standardInput = input
    try child.run()
    defer {
      if child.isRunning {
        child.terminate()
        child.waitUntilExit()
      }
    }
    let deadline = ContinuousClock.now.advanced(by: .seconds(5))
    while !FileManager.default.fileExists(atPath: marker.path) {
      guard child.isRunning, ContinuousClock.now < deadline else {
        throw CheckFailure.failed("Lock child did not start")
      }
      try await Task.sleep(for: .milliseconds(10))
    }
    do {
      _ = try await CredentialLease.acquire(in: root, timeout: .milliseconds(50))
      throw CheckFailure.failed("Two processes acquired the refresh lease")
    } catch is CredentialStorageError {}
    child.terminate()
    child.waitUntilExit()
    let recovered = try await CredentialLease.acquire(in: root, timeout: .seconds(1))
    withExtendedLifetime(recovered) {}
    print(
      "Credential checks passed: denied/corrupt storage, provider isolation, exact registration import, bounded framing, caller rejection and cross-process lease recovery."
    )
  }
}
