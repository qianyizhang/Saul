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
      var loginFailure: Error?
      let signingIn = Task {
        do { try await login.run(loginRequest) } catch {
          loginFailure = error
          await authorized.signal()
          throw error
        }
      }
      defer { signingIn.cancel() }
      try await authorized.wait()
      if let loginFailure { throw loginFailure }

      let apiRequest = try request(["action": "api-key-save", "key": "fixture-api-key"])
      let savingKey = Task {
        do { try await api.run(apiRequest) } catch {
          await apiFinished.signal()
          throw error
        }
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
    CheckCase("coordination: Darwin path aliases share leases and unexpected symlinks fail") {
      directory in
      let root = try canonical(directory)
      let file = root.appendingPathComponent("settings.json")
      let canonical = ConnectionCoordination(settingsURL: file)
      let binding = ConnectionBinding(key: "shared-api")
      let primary = try canonical.read(binding)
      defer { withExtendedLifetime(primary.lease) {} }
      try expect(
        root.path.hasPrefix("/private/var/") || root.path.hasPrefix("/private/tmp/"),
        "The test fixture must use a Darwin temporary directory")
      let alias = URL(fileURLWithPath: String(file.path.dropFirst("/private".count)))
      let alternate = ConnectionCoordination(settingsURL: alias)
      try expectEqual(
        try alternate.read(binding).generation, primary.generation, "Alias changed the registry")
      try expectThrows(
        ConnectionCoordinationError.self, matching: { $0.localizedDescription.contains("busy") }
      ) {
        _ = try alternate.mutate(binding, origin: "ez", token: nil)
      }

      for name in [
        "alias-parent", "alias-lock.json.lock.sqlite3", "alias-directory.json.connections",
      ] {
        let link = root.appendingPathComponent(name)
        let destination =
          name.hasSuffix(".sqlite3")
          ? URL(fileURLWithPath: file.path + ".lock.sqlite3") : root
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: destination)
      }
      for relative in ["alias-parent/settings.json", "alias-lock.json", "alias-directory.json"] {
        let invalid = ConnectionCoordination(settingsURL: root.appendingPathComponent(relative))
        try expectThrows(ConnectionCoordinationError.self) { _ = try invalid.read(binding) }
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
    CheckCase("coordination: signed client can list and release an abandoned foreign setup") {
      directory in
      let root = try canonical(directory)
      let storage = SharedAuthStorage(records: FixtureCredentialRecords(), directory: root)
      let coordination = ConnectionCoordination(
        settingsURL: root.appendingPathComponent("settings.json"))
      let binding = ConnectionBinding(key: "shared-api")
      let operation = UUID()
      let initial = try coordination.holdSetup(
        binding, origin: "saul", operationID: operation, previousToken: nil
      ).1
      var holder: ConnectionLease?
      let current: ConnectionReservation
      do {
        let (lease, row) = try coordination.holdSetup(
          binding, origin: "saul", operationID: operation, previousToken: initial.token)
        holder = lease
        current = row
      }
      var reply: [String: Any] = [:]
      let owner = CredentialOwner(storage: storage, coordination: coordination) { reply = $0 }
      @MainActor func request(_ fields: [String: Any]) async throws {
        try await owner.run(
          CredentialRequest.decode(
            JSONSerialization.data(withJSONObject: [
              "version": CredentialRequest.version, "id": "fixture", "request": fields,
            ]), caller: .ez))
      }
      @MainActor func release(_ token: UUID) async throws {
        try await request([
          "action": "connection-setup-release", "connectionKey": "shared-api",
          "token": token.uuidString,
        ])
      }
      try await request(["action": "connection-setups"])
      guard let setups = reply["connectionSetups"] as? [[String: Any]] else {
        throw CheckFailure("Invalid reservation list")
      }
      let listed = try JSONSerialization.data(withJSONObject: setups)
      let rows = try JSONDecoder().decode([FixtureReservationStatus].self, from: listed)
      try expectEqual(
        rows,
        [.init(connectionKey: "shared-api", origin: "saul", token: current.token, active: true)],
        "Foreign reservation was not correctly identified")
      try await expectAsyncThrows(
        ConnectionCoordinationError.self,
        matching: {
          $0.localizedDescription.contains("busy")
        }
      ) { try await release(current.token) }
      withExtendedLifetime(holder) {}
      holder = nil
      try await expectAsyncThrows(
        ConnectionCoordinationError.self,
        matching: {
          $0.localizedDescription.contains("setup changed")
        }
      ) { try await release(initial.token) }
      try await release(current.token)
      try await request(["action": "connection-setups"])
      try expect(
        (reply["connectionSetups"] as? [[String: Any]])?.isEmpty == true,
        "Released setup still listed")
    },
  ]
}

private struct FixtureReservationStatus: Decodable, Equatable {
  let connectionKey: String
  let origin: String
  let token: UUID
  let active: Bool
}
