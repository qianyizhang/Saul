import Foundation
import SaulCredentialClient
import SaulNativeValues
import SaulTestSupport

@testable import SaulCredentialOwner

private let planModels = """
  {"models":[
    {"slug":"preferred","display_name":"Zebra","visibility":"list","is_default":true,
     "default_reasoning_level":"medium","supported_reasoning_levels":[{"effort":"medium"}],
     "additional_speed_tiers":["fast"]},
    {"slug":"another","display_name":"Aardvark","visibility":"list"},
    {"slug":"hidden","visibility":"hidden"}
  ]}
  """
private let completedPlanResponse = """
  data: {"type":"response.output_text.delta","delta":"Fixture answer"}

  data: {"type":"response.completed","response":{"status":"completed"}}


  """

private let planUsageLimit = """
  data: {"type":"error","error":{"code":"subscription_sharing_usage_unavailable"}}


  """

@MainActor func planCatalogChecks() -> [CheckCase] {
  [
    CheckCase("connections: only a confirmed app name appears on the bound connection") {
      directory in
      let http = HTTPFixture { _ in throw CheckFailure("Reading an app name made an HTTP request") }
      defer { http.close() }
      let fixture = try PlanCatalogFixture(directory, http: http)
      var state = try await fixture.storage.read()
      try expect(
        state.profiles.allSatisfy { $0.suggestedAppName == nil }, "Old account names were invented")
      state.profiles[0].suggestedAppName = "Saul 0123456789AB"
      state.profiles[0].subject = "verified-account"
      try fixture.storage.write(state)
      let pending = try await fixture.run([
        "action": "connection-status", "connectionKey": "plan-a",
      ])
      try expectEqual(
        (pending.first?["connection"] as? [String: Any])?["identity"] as? String,
        "a@example.test · ChatGPT app name unconfirmed",
        "The suggestion appeared as an approved name")
      try await expectAsyncThrows(OwnerRequestError.self) {
        _ = try await fixture.run([
          "action": "confirm-app-name", "accountId": "b", "suggestedAppName": "Saul 0123456789AB",
        ])
      }
      _ = try await fixture.run([
        "action": "confirm-app-name", "accountId": "a", "suggestedAppName": "Saul 0123456789AB",
      ])
      let status = try await fixture.run(["action": "connection-status", "connectionKey": "plan-a"])
      let bound = status.first?["connection"] as? [String: Any]
      try expectEqual(
        bound?["identity"] as? String, "a@example.test · Saul 0123456789AB", "Bound name was lost")
      let listed = try await fixture.run(["action": "accounts"])
      let accounts = listed.first?["accounts"] as? [[String: Any]]
      try expectEqual(
        accounts?.first?["label"] as? String, bound?["identity"] as? String,
        "The picker and the bound connection showed different names")
    },
    CheckCase("connections: only successful explicit Check recovers the bound plan registration") {
      directory in
      var response = planModels
      let http = HTTPFixture { request in
        if request.httpMethod == "GET" {
          try expectEqual(request.url?.path, "/v1/models", "Unexpected discovery route")
          return HTTPReply(response)
        }
        return HTTPReply(completedPlanResponse)
      }
      defer { http.close() }
      let fixture = try PlanCatalogFixture(directory, http: http)
      // An actual usage-limit event persists the pause through the signed owner.
      let pauseHTTP = HTTPFixture { request in
        HTTPReply(request.httpMethod == "GET" ? planModels : planUsageLimit)
      }
      defer { pauseHTTP.close() }
      let pauseFixture = try PlanCatalogFixture(directory, http: pauseHTTP)
      for id in ["a", "direct"] {
        try await expectAsyncThrows(CredentialHTTPError.self) {
          _ = try await pauseFixture.generate(id)
        }
      }
      _ = try await fixture.catalog("plan-a", intent: "display")
      _ = try await fixture.catalog("plan-a", intent: "refresh")
      _ = try await fixture.catalog("plan-a", legacyForce: true, version: 1)
      _ = try await fixture.run(["action": "models", "accountId": "a"], version: 1)
      try await expectAsyncThrows(CredentialStorageError.self) {
        _ = try await fixture.generate("a")
      }
      let unpaused = try await fixture.generate("b", key: "plan-b")
      try expectEqual(unpaused.last?["type"] as? String, "complete", "A pause blocked account B")

      response =
        #"{"models":[{"slug":"preferred","visibility":"list","supported_reasoning_levels":[false]}]}"#
      let failed = try await fixture.catalog("plan-a", intent: "check")
      try expect(failed.error != nil, "Incomplete provider metadata was accepted")
      try expectEqual(
        failed.models.map(\.id), ["another", "preferred"], "Last good catalog was lost")
      try await expectAsyncThrows(CredentialStorageError.self) {
        _ = try await fixture.generate("a")
      }

      response = planModels
      let checked = try await fixture.catalog("plan-a", intent: "check")
      try expect(checked.isFresh, "Check did not persist verified evidence")
      try expectEqual(
        checked.models.map(\.id), ["another", "preferred"], "Fixture did not sort default last")
      try expectEqual(checked.models.last?.isDefault, true, "Provider default was lost")
      try expect(checked.models.first?.fastTier == nil, "Missing provider tier advertised Fast")
      let old = try await fixture.catalog("plan-a-alias", version: 1)
      let oldV2 = try await fixture.catalog("plan-a-alias")
      try expect(
        (old.models + oldV2.models).allSatisfy { $0.isDefault == nil }, "Old clients got new fields"
      )

      let before = http.requests.count
      _ = try await fixture.generate("a", key: "plan-a-alias", effort: "medium", fast: true)
      _ = try await fixture.generate("a", effort: "medium")
      try expectEqual(
        http.requests.dropFirst(before).map(\.httpMethod), ["POST", "POST"],
        "Separate owners did not reuse Check through alias/direct lookup")
      try await expectAsyncThrows(CredentialStorageError.self) {
        _ = try await fixture.generate("direct")
      }
      try await expectAsyncThrows(CredentialStorageError.self) {
        _ = try await fixture.generate("a", key: "plan-b")
      }
      try expectEqual(
        http.requests.suffix(2).map { $0.value(forHTTPHeaderField: "Authorization") },
        ["Bearer token-a", "Bearer token-a"], "Account selection changed the bound route")
    },
    CheckCase("connections: stale plan evidence is readable but never sends inference") {
      directory in
      var response = planModels
      let http = HTTPFixture { request in
        try expectEqual(request.httpMethod, "GET", "Stale or removed evidence sent inference")
        return HTTPReply(response)
      }
      defer { http.close() }
      let fixture = try PlanCatalogFixture(directory, http: http)
      let cacheURL = directory.appendingPathComponent("connection-catalogs.json")
      let prior = ConnectionCatalog(
        models: [ConnectionModel(id: "preferred", efforts: ["medium"], fastTier: "fast")],
        fetchedAt: 5)
      // This is the cache format deployed by the prior owner: no default marker or route prefix.
      try JSONSerialization.data(withJSONObject: [
        "plan-a": [
          "identity": "a",
          "catalog": try JSONSerialization.jsonObject(
            with: JSONEncoder().encode(prior)),
        ]
      ]).write(to: cacheURL)
      response = "invalid reply"
      let stale = try await fixture.catalog("plan-a", intent: "display")
      try expectEqual(stale.models, prior.models, "Old cache could not be decoded for display")
      try expect(stale.error != nil, "Old stale catalog lost its refresh error")
      response = planModels
      _ = try await fixture.catalog("plan-a", intent: "check")
      guard
        var cache = try JSONSerialization.jsonObject(with: Data(contentsOf: cacheURL))
          as? [String: [String: Any]],
        var entry = cache["plan:a"], var catalog = entry["catalog"] as? [String: Any]
      else { throw CheckFailure("Missing canonical plan cache") }
      catalog["fetchedAt"] = Date().timeIntervalSince1970 - 301
      entry["catalog"] = catalog
      cache["plan:a"] = entry
      try JSONSerialization.data(withJSONObject: cache).write(to: cacheURL)
      response = "invalid reply"
      let before = http.requests.count
      try await expectAsyncThrows(CredentialStorageError.self) {
        _ = try await fixture.generate("a", key: "plan-a", effort: "medium", fast: true)
      }
      try expectEqual(
        http.requests.count, before + 1, "Plan run did not refresh the expired catalog")
      response = #"{"models":[{"slug":"preferred","visibility":"list"}]}"#
      _ = try await fixture.catalog("plan-a", intent: "check")
      for option in [("medium", false), ("", true)] {
        try await expectAsyncThrows(CredentialStorageError.self) {
          _ = try await fixture.generate("a", key: "plan-a", effort: option.0, fast: option.1)
        }
      }
      response = #"{"models":[]}"#
      let empty = try await fixture.catalog("plan-a", intent: "check")
      try expect(
        empty.isFresh && empty.models.isEmpty, "Successful empty catalog was not authoritative")
      try await expectAsyncThrows(CredentialStorageError.self) {
        _ = try await fixture.generate("a", key: "plan-a")
      }
      try expect(
        http.requests.allSatisfy { $0.httpMethod == "GET" }, "An invalid run reached inference")
    },
    CheckCase("connections: cancellation and changed routes cannot publish Check evidence") {
      directory in
      let pauseHTTP = HTTPFixture { request in
        HTTPReply(request.httpMethod == "GET" ? planModels : planUsageLimit)
      }
      defer { pauseHTTP.close() }
      let pause = try PlanCatalogFixture(directory, http: pauseHTTP)
      try await expectAsyncThrows(CredentialHTTPError.self) { _ = try await pause.generate("a") }
      let cache = directory.appendingPathComponent("connection-catalogs.json")
      let prior = try Data(contentsOf: cache)

      let cancelled = HTTPFixture { _ in HTTPReply(planModels, held: true) }
      defer { cancelled.close() }
      let first = try PlanCatalogFixture(directory, http: cancelled)
      let cancelledCheck = Task { try await first.catalog("plan-a", intent: "check") }
      try await cancelled.received.wait()
      cancelledCheck.cancel()
      try await expectAsyncThrows(CancellationError.self) { _ = try await cancelledCheck.value }
      try expectEqual(
        try Data(contentsOf: cache), prior, "Cancellation published new catalog evidence")
      try await expectAsyncThrows(CredentialStorageError.self) { _ = try await first.generate("a") }

      let changed = HTTPFixture { _ in HTTPReply(planModels, held: true) }
      defer { changed.close() }
      let second = try PlanCatalogFixture(directory, http: changed)
      let changedCheck = Task { try await second.catalog("plan-a", intent: "check") }
      try await changed.received.wait()
      second.connections[0].accountId = "b"
      changed.release()
      try await expectAsyncThrows(CredentialStorageError.self) { _ = try await changedCheck.value }
      try expectEqual(try Data(contentsOf: cache), prior, "Retargeted Check published new evidence")
      try await expectAsyncThrows(CredentialStorageError.self) {
        _ = try await second.generate("a")
      }
      try expectEqual(cancelled.requests.count, 1, "Cancelled Check cleared the usage pause")
      try expectEqual(changed.requests.count, 1, "Retargeted Check cleared the usage pause")
    },
    CheckCase("connections: native Responses also requires the bound account and advertised tier") {
      directory in
      let http = HTTPFixture { request in
        HTTPReply(request.httpMethod == "GET" ? planModels : completedPlanResponse)
      }
      defer { http.close() }
      let fixture = try PlanCatalogFixture(directory, http: http)
      _ = try await fixture.catalog("plan-a", intent: "check")
      func request(key: String, tier: String) -> [String: Any] {
        [
          "action": "native-responses", "provider": "chatgpt-plan", "accountId": "a",
          "connectionKey": key,
          "body": [
            "model": "preferred", "input": [["role": "user", "content": "Fixture"]],
            "service_tier": tier, "store": false, "stream": true,
          ],
        ]
      }
      try await expectAsyncThrows(CredentialStorageError.self) {
        _ = try await fixture.run(request(key: "plan-b", tier: "priority"))
      }
      try await expectAsyncThrows(CredentialStorageError.self) {
        _ = try await fixture.run(request(key: "plan-a", tier: "flex"))
      }
      let events = try await fixture.run(request(key: "plan-a", tier: "priority"))
      try expectEqual(events.last?["type"] as? String, "complete", "Advertised native run failed")
      try expectEqual(
        http.requests.map(\.httpMethod), ["GET", "POST"], "Invalid native run reached HTTP")
    },
    CheckCase("connections: logout and entitlement are enforced even with a fresh catalog") {
      directory in
      let http = HTTPFixture { _ in HTTPReply(planModels) }
      defer { http.close() }
      let fixture = try PlanCatalogFixture(directory, http: http)
      _ = try await fixture.catalog("plan-a", intent: "check")
      _ = try await fixture.catalog("plan-b", intent: "check")
      _ = try await fixture.run(["action": "logout", "accountId": "a"])
      let cache = directory.appendingPathComponent("connection-catalogs.json")
      let keys = try JSONSerialization.jsonObject(with: Data(contentsOf: cache)) as? [String: Any]
      try expect(
        keys?["plan:a"] == nil && keys?["plan:b"] != nil, "Logout removed a different cache")
      try await expectAsyncThrows(OwnerRequestError.self) {
        _ = try await fixture.catalog("plan-a-alias", intent: "display")
      }
      var auth = try await fixture.storage.read()
      guard let b = auth.profiles.firstIndex(where: { $0.id == "b" }) else {
        throw CheckFailure("Missing account")
      }
      auth.profiles[b].credentials?.scopes = []
      try fixture.storage.write(auth)
      try await expectAsyncThrows(OwnerRequestError.self) { _ = try await fixture.generate("b") }
      try expectEqual(http.requests.count, 2, "Unavailable credential reached the provider")
    },
  ]
}
