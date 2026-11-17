import Foundation
import SaulCredentialClient
import SaulCredentialTestSupport
import SaulNativeValues
import SaulTestSupport

@testable import SaulCredentialOwner

@MainActor private func apiCatalog(_ client: SaulConnection, key: String = "openai-api")
  async throws -> ConnectionCatalog
{
  let reply = try await client.call(["action": "connection-catalog", "connectionKey": key])
  guard let catalog = reply["catalog"] else { throw CheckFailure("Missing catalog reply") }
  return try JSONDecoder().decode(
    ConnectionCatalog.self, from: JSONSerialization.data(withJSONObject: catalog))
}

private func savedCatalogs(_ path: URL) throws -> [String: Any] {
  guard
    let object = try JSONSerialization.jsonObject(with: Data(contentsOf: path)) as? [String: Any]
  else { throw CheckFailure("Invalid catalog cache after repair") }
  return object
}

@MainActor func cacheRecoveryChecks() -> [CheckCase] {
  [
    CheckCase("catalog repair: fresh valid slots survive a partially corrupt cache") { directory in
      let http = HTTPFixture { _ in HTTPReply(#"{"data":[{"id":"gpt-first"}]}"#) }
      defer { http.close() }
      let client = try credentialConnection(directory: directory, http: http)
      let first = try await apiCatalog(client)
      let path = directory.appendingPathComponent("connection-catalogs.json")
      var cache = try savedCatalogs(path)
      cache["plan:corrupt"] = ["identity": "corrupt", "catalog": ["models": "wrong type"]]
      try JSONSerialization.data(withJSONObject: cache).write(to: path)
      let afterRepair = try await apiCatalog(client)
      try expectEqual(afterRepair, first, "Partial corruption discarded a valid slot")
      try expectEqual(Set(try savedCatalogs(path).keys), ["api:openai-api"], "Bad cache slot kept")
      try expectEqual(http.requests.count, 1, "Fresh valid slot was fetched again")
    },
    CheckCase("catalog repair: damaged JSON allows key replacement and cold discovery") {
      directory in
      let http = HTTPFixture { request in
        try expectEqual(
          request.value(forHTTPHeaderField: "Authorization"), "Bearer replacement",
          "Corrupt cache blocked or replayed key replacement")
        return HTTPReply(#"{"data":[{"id":"gpt-replacement"}]}"#)
      }
      defer { http.close() }
      let client = try credentialConnection(directory: directory, http: http)
      let path = directory.appendingPathComponent("connection-catalogs.json")
      try Data("broken cache".utf8).write(to: path)
      _ = try await client.call(["action": "api-key-save", "key": "replacement"])
      try expect(try savedCatalogs(path).isEmpty, "Key replacement did not discard broken cache")
      let catalog = try await apiCatalog(client)
      try expectEqual(catalog.models.map(\.id), ["gpt-replacement"], "Cold discovery failed")
      try expectEqual(http.requests.count, 1, "Cold discovery retried")
    },
    CheckCase("catalog repair: failed repair is reported without replacing a key") { directory in
      let http = HTTPFixture { request in
        try expectEqual(
          request.value(forHTTPHeaderField: "Authorization"), "Bearer synthetic",
          "Failed repair replaced the saved key")
        return HTTPReply(#"{"data":[{"id":"gpt-original"}]}"#)
      }
      defer { http.close() }
      let client = try credentialConnection(directory: directory, http: http)
      _ = try await client.call(["action": "api-key-status"])
      let path = directory.appendingPathComponent("connection-catalogs.json")
      let corrupt = Data("broken cache".utf8)
      try corrupt.write(to: path)
      let fm = FileManager.default
      try fm.setAttributes([.posixPermissions: 0o000], ofItemAtPath: path.path)
      defer {
        try? fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
        try? fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
      }
      try await expectAsyncThrows(
        CredentialStorageError.self,
        matching: { $0.localizedDescription.contains("read the model cache") }
      ) {
        _ = try await client.call(["action": "api-key-save", "key": "replacement"])
      }
      try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
      try fm.setAttributes([.posixPermissions: 0o500], ofItemAtPath: directory.path)
      try await expectAsyncThrows(
        CredentialStorageError.self,
        matching: { $0.localizedDescription.contains("write the model cache") }
      ) {
        _ = try await client.call(["action": "api-key-save", "key": "replacement"])
      }
      try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
      try expectEqual(try Data(contentsOf: path), corrupt, "Failed recovery replaced the original")
      try expect(http.requests.isEmpty, "Failed recovery reached the provider")
      _ = try await apiCatalog(client)
      try expectEqual(http.requests.count, 1, "Explicit retry did not recover")
    },
    CheckCase("catalog repair: plan display preserves registration and pause") { directory in
      let http = HTTPFixture { _ in
        HTTPReply(#"{"models":[{"visibility":"list","slug":"preferred"}]}"#)
      }
      defer { http.close() }
      let fixture = try PlanCatalogFixture(directory, http: http)
      try fixture.storage.pause("a", value: true)
      let path = directory.appendingPathComponent("connection-catalogs.json")
      try Data("broken cache".utf8).write(to: path)
      let catalog = try await fixture.catalog("plan-a", intent: "display")
      try expectEqual(catalog.models.map(\.id), ["preferred"], "Corruption blocked plan display")
      try expect(try fixture.storage.isPaused("a"), "Display cleared a usage pause")
      let registrations = try await fixture.storage.read()
      try expectEqual(
        registrations.profiles.map(\.id), ["a", "b", "direct", "no-permission"],
        "Cache repair changed registrations")
      _ = try await fixture.catalog("plan-a", intent: "check")
      try expect(
        try !fixture.storage.isPaused("a"), "Successful explicit Check did not clear pause")
    },
  ]
}

private struct ModelPolicyFixture: Decodable {
  let endpoint: String
  let model: String
  let capabilities: [ActionCapability]
}

@MainActor func apiModelCapabilityChecks() -> [CheckCase] {
  [
    CheckCase("catalog policy: both endpoint families obey shared capability fixtures") {
      directory in
      let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../../../../contracts/fixtures/api-model-capabilities.json")
      let fixtures = try JSONDecoder().decode(
        [ModelPolicyFixture].self, from: Data(contentsOf: url))
      let endpoints = Dictionary(grouping: fixtures, by: \.endpoint)
      let definitions = endpoints.keys.sorted().enumerated().map { index, endpoint in
        ConnectionDefinition(
          key: "profile-\(index)", name: endpoint, kind: .openAIAPI, baseUrl: endpoint)
      }
      let http = HTTPFixture { request in
        guard let url = request.url?.deletingLastPathComponent().absoluteString,
          let rows = endpoints[url.trimmingCharacters(in: CharacterSet(charactersIn: "/"))]
        else { throw CheckFailure("Unexpected request: \(request)") }
        let data = try JSONSerialization.data(withJSONObject: [
          "data": rows.map { ["id": $0.model] }
        ])
        return HTTPReply(String(decoding: data, as: UTF8.self))
      }
      defer { http.close() }
      let client = try credentialConnection(
        directory: directory, http: http, definitions: definitions)
      for definition in definitions {
        _ = try await client.call([
          "action": "connection-key-save", "connectionKey": definition.key,
          "endpoint": definition.endpoint, "key": "fixture",
        ])
        let catalog = try await apiCatalog(client, key: definition.key)
        for fixture in endpoints[definition.endpoint] ?? [] {
          let model = catalog.models.first { $0.id == fixture.model }
          try expectEqual(model?.capabilities, fixture.capabilities, fixture.model)
          for capability in ActionCapability.allCases {
            let supported = fixture.capabilities.contains(capability)
            try expectEqual(
              catalog.options(for: capability).contains { $0.id == fixture.model },
              supported, "\(fixture.model) appears under \(capability)")
            try expectEqual(
              catalog.issue(model: fixture.model, capability: capability) == nil,
              supported, "\(fixture.model) has the wrong availability")
          }
        }
      }
      guard let official = definitions.first(where: { $0.endpoint == "https://api.openai.com/v1" })
      else { throw CheckFailure("Missing official fixture") }
      try await expectAsyncThrows(
        CredentialStorageError.self,
        matching: { $0.localizedDescription.contains("does not support Write") }
      ) {
        _ = try await client.call([
          "action": "api-chat", "connectionKey": official.key, "model": "unknown-example",
          "systemPrompt": "", "userPrompt": "Unsupported model must never send",
        ])
      }
      try expectEqual(http.requests.count, endpoints.count, "Unsupported model reached generation")
    }
  ]
}
