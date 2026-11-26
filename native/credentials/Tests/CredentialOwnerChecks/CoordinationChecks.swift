import Darwin
import Foundation
import SaulConnectionCoordination
import SaulCredentialClient
import SaulCredentialOwner
import SaulCredentialTestSupport
import SaulNativeValues
import SaulTestSupport

@MainActor func holdConnectionForCheck(at file: String) throws {
  let coordination = ConnectionCoordination(settingsURL: URL(fileURLWithPath: file))
  let held = try coordination.read(ConnectionBinding(key: "shared-api"))
  defer { withExtendedLifetime(held.lease) {} }
  try FileHandle.standardOutput.write(contentsOf: Data(held.generation.utf8))
  _ = FileHandle.standardInput.readDataToEndOfFile()
}

private func canonical(_ url: URL) throws -> URL {
  guard let resolved = realpath(url.path, nil) else {
    throw CheckFailure("Could not resolve fixture path.")
  }
  defer { free(resolved) }
  return URL(fileURLWithPath: String(cString: resolved), isDirectory: true)
}

@MainActor func coordinationChecks() -> [CheckCase] {
  [
    CheckCase("coordination: interactive plan sign-in leaves unrelated API effects available") {
      directory in
      let root = try canonical(directory)
      try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
      let records = FixtureCredentialRecords()
      let storage = SharedAuthStorage(records: records, directory: root)
      let coordination = ConnectionCoordination(
        settingsURL: root.appendingPathComponent("settings.json"))
      let authorized = CheckSignal()
      let apiFinished = CheckSignal()
      let login = CredentialOwner(storage: storage, coordination: coordination) { event in
        if event["type"] as? String == "authorize" { Task { await authorized.signal() } }
      }
      let api = CredentialOwner(storage: storage, coordination: coordination) { _ in }
      func request(_ fields: [String: Any]) throws -> CredentialRequest {
        try CredentialRequest.decode(
          JSONSerialization.data(withJSONObject: [
            "version": CredentialRequest.version, "id": "fixture", "request": fields,
          ]), caller: .saul)
      }
      let loginRequest = try request(["action": "login"])
      let signingIn = Task { try await login.run(loginRequest) }
      defer { signingIn.cancel() }
      try await authorized.wait()

      let apiRequest = try request(["action": "api-key-save", "key": "fixture-api-key"])
      let savingKey = Task {
        try await api.run(apiRequest)
        await apiFinished.signal()
      }
      defer { savingKey.cancel() }
      try await apiFinished.wait()
      try await savingKey.value
      try expectEqual(
        try storage.apiKey(), "fixture-api-key", "API effect did not finish during sign-in")
      signingIn.cancel()
      try await expectAsyncThrows(CancellationError.self) { try await signingIn.value }
      let state = try await storage.read()
      try expect(state.profiles.isEmpty, "Cancelled sign-in saved a profile")
    },
    CheckCase("coordination: readers share a binding and process exit releases its last reader") {
      directory in
      let root = try canonical(directory)
      let file = root.appendingPathComponent("settings.json")
      let coordination = ConnectionCoordination(settingsURL: file)
      let binding = ConnectionBinding(key: "shared-api")

      func open() throws -> (Process, Pipe, String) {
        let child = Process()
        child.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
        child.arguments = ["--coordination-hold", file.path]
        let input = Pipe()
        let output = Pipe()
        child.standardInput = input
        child.standardOutput = output
        try child.run()
        var bytes = Data()
        while bytes.count < 64 {
          guard let chunk = try output.fileHandleForReading.read(upToCount: 64 - bytes.count),
            !chunk.isEmpty
          else { throw CheckFailure("The reader process stopped before holding its connection.") }
          bytes.append(chunk)
        }
        return (child, input, String(decoding: bytes, as: UTF8.self))
      }
      func stop(_ holder: (Process, Pipe, String)) {
        if holder.0.isRunning { holder.0.terminate() }
        try? holder.1.fileHandleForWriting.close()
        holder.0.waitUntilExit()
      }
      let first = try open()
      defer { stop(first) }
      let second = try open()
      defer { stop(second) }
      try expectEqual(
        first.2, second.2, "Concurrent readers disagreed on one credential generation")
      try expectThrows(
        ConnectionCoordinationError.self, matching: { $0.localizedDescription.contains("busy") }
      ) {
        _ = try coordination.mutate(binding, origin: "ez", token: nil)
      }
      _ = try coordination.mutate(ConnectionBinding(key: "other-api"), origin: "ez", token: nil)
      stop(first)
      try expectThrows(
        ConnectionCoordinationError.self, matching: { $0.localizedDescription.contains("busy") }
      ) {
        _ = try coordination.holdSetup(
          binding, origin: "saul", operationID: UUID(), previousToken: nil)
      }
      stop(second)
      _ = try coordination.mutate(binding, origin: "ez", token: nil)
      try expectThrows(
        ConnectionCoordinationError.self,
        matching: { $0.localizedDescription.contains("changed during the run") }
      ) {
        _ = try coordination.read(binding, generation: first.2)
      }
    },
    CheckCase("coordination: setup release, rotation and exact account fencing") { directory in
      let coordination = ConnectionCoordination(
        settingsURL: try canonical(directory).appendingPathComponent("settings.json"))
      let binding = ConnectionBinding(key: "plan", accountID: "existing-account")
      let operation = UUID()
      func reserve() throws -> ConnectionReservation {
        let (lease, record) = try coordination.holdSetup(
          binding, origin: "saul", operationID: operation, previousToken: nil)
        defer { withExtendedLifetime(lease) {} }
        try expectThrows(
          ConnectionCoordinationError.self, matching: { $0.localizedDescription.contains("busy") }
        ) {
          try coordination.release(.init(connectionKey: "plan", token: record.token))
        }
        try expect(
          try coordination.setups().first?.active == true, "Live reservation was reported as idle")
        try expectThrows(
          ConnectionCoordinationError.self,
          matching: { $0.localizedDescription.contains("setup changed") }
        ) {
          _ = try coordination.mutate(
            ConnectionBinding(key: nil, accountID: "other-account"), origin: "saul",
            token: record.token)
        }
        try expectThrows(
          ConnectionCoordinationError.self,
          matching: { $0.localizedDescription.contains("setup changed") }
        ) {
          _ = try coordination.mutate(binding, origin: "ez", token: record.token)
        }
        _ = try coordination.mutate(binding, origin: "saul", token: record.token)
        return record
      }
      let old = try reserve()
      try expect(
        try coordination.setups().first?.active == false, "Closed reservation was reported as live")
      try expectThrows(
        ConnectionCoordinationError.self,
        matching: { $0.localizedDescription.contains("Finish or release") }
      ) {
        _ = try coordination.read(binding)
      }
      func rotate() throws -> UUID {
        let (lease, replacement) = try coordination.holdSetup(
          binding, origin: "saul", operationID: operation, previousToken: old.token)
        defer { withExtendedLifetime(lease) {} }
        try expectThrows(
          ConnectionCoordinationError.self,
          matching: { $0.localizedDescription.contains("setup changed") }
        ) {
          _ = try coordination.mutate(binding, origin: "saul", token: old.token)
        }
        return replacement.token
      }
      let latest = try rotate()
      try coordination.release(.init(connectionKey: "plan", token: latest))
      try expectThrows(
        ConnectionCoordinationError.self,
        matching: { $0.localizedDescription.contains("setup changed") }
      ) {
        _ = try coordination.holdSetup(
          binding, origin: "saul", operationID: operation, previousToken: latest)
      }
      try expect(try coordination.setups().isEmpty, "Released setup reappeared")
    },
  ]
}
