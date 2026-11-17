import Foundation
import SaulCredentialClient
import SaulCredentialOwner
import SaulCredentialTestSupport
import SaulNativeValues
import SaulTestSupport

/// Exercise the signed owner boundary with a fresh owner for each request.
@MainActor final class PlanCatalogFixture {
  let http: HTTPFixture
  let storage: SharedAuthStorage
  var connections = [
    ConnectionDefinition(key: "plan-a", name: "Plan A", kind: .chatGPTPlan, accountId: "a"),
    ConnectionDefinition(key: "plan-a-alias", name: "Alias A", kind: .chatGPTPlan, accountId: "a"),
    ConnectionDefinition(key: "plan-b", name: "Plan B", kind: .chatGPTPlan, accountId: "b"),
  ]

  init(_ directory: URL, http: HTTPFixture) throws {
    self.http = http
    try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
    storage = SharedAuthStorage(records: FixtureCredentialRecords(), directory: directory)
    let state = try JSONSerialization.data(withJSONObject: [
      "selectedID": "b", "hostID": "fixture",
      "profiles": ["a", "b", "direct", "no-permission"].map { id in
        [
          "clientID": id, "email": "\(id)@example.test",
          "credentials": [
            "accessToken": "token-\(id)", "idToken": "fixture",
            "expiresAt": Date().addingTimeInterval(3600).timeIntervalSinceReferenceDate,
            "scopes": id == "no-permission" ? [] : ["chatgpt.tokens.use.direct"],
          ],
        ]
      },
    ])
    try storage.write(JSONDecoder().decode(AuthState.self, from: state))
  }

  func run(_ value: [String: Any], version: Int = CredentialRequest.version) async throws
    -> [[String: Any]]
  {
    var events: [[String: Any]] = []
    let owner = CredentialOwner(
      storage: storage, http: ConnectionHTTP(session: http.session),
      connectionDefinitions: { self.connections }, emit: { events.append($0) }
    )
    let data = try JSONSerialization.data(withJSONObject: [
      "version": version, "id": "catalog-fixture", "request": value,
    ])
    try await owner.run(CredentialRequest.decode(data, caller: .ez))
    return events
  }

  func catalog(_ key: String, intent: String? = nil, legacyForce: Bool? = nil, version: Int = 2)
    async throws -> ConnectionCatalog
  {
    var value: [String: Any] = ["action": "connection-catalog", "connectionKey": key]
    if let intent { value["intent"] = intent }
    if let legacyForce { value["force"] = legacyForce }
    guard let catalog = try await run(value, version: version).first?["catalog"] else {
      throw CredentialStorageError("No catalog from owner")
    }
    return try JSONDecoder().decode(
      ConnectionCatalog.self, from: JSONSerialization.data(withJSONObject: catalog))
  }

  func generate(
    _ account: String, key: String? = nil, model: String = "preferred", effort: String = "",
    fast: Bool = false
  ) async throws -> [[String: Any]] {
    var request: [String: Any] = [
      "action": "generate", "accountId": account, "model": model, "effort": effort, "fast": fast,
      "systemPrompt": "", "userPrompt": "Fixture prompt",
    ]
    if let key { request["connectionKey"] = key }
    return try await run(request)
  }
}
