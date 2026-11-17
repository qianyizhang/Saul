import CoreFoundation
import Foundation
import SaulCredentialClient
import SaulNativeValues

extension CredentialOwner {
  private enum CatalogRoute {
    case plan(String)
    case api(String, endpoint: String)

    var slot: String {
      switch self {
      case .plan(let id): "plan:\(id)"
      case .api(let key, _): "api:\(key)"
      }
    }
    var identity: String {
      switch self {
      case .plan(let id): id
      case .api(_, let endpoint): endpoint
      }
    }
  }

  private var catalogCache: ConnectionCatalogCache {
    ConnectionCatalogCache(directory: storage.directory)
  }

  // Credential mutations already hold the lease. Remove alias entries written by old owners too.
  func invalidatePlanCatalog(_ id: String) throws {
    let cache = try catalogCache.load()
    let remaining = cache.filter { key, item in
      key != CatalogRoute.plan(id).slot && (key.contains(":") || item.identity != id)
    }
    if remaining.count != cache.count { try catalogCache.save(remaining) }
  }

  func invalidateAPICatalog(_ key: String) throws {
    var cache = try catalogCache.load()
    let count = cache.count
    cache.removeValue(forKey: "api:\(key)")
    cache.removeValue(forKey: key)
    if cache.count != count { try catalogCache.save(cache) }
  }

  func connectionDefinition(_ key: String) throws -> ConnectionDefinition {
    guard let definition = try connectionDefinitions().first(where: { $0.key == key }) else {
      throw CredentialStorageError("This saved connection is unavailable. Open Connections.")
    }
    return definition
  }

  private func checkedRoute(_ definition: ConnectionDefinition?) throws {
    guard let definition else { return }
    guard let current = try? connectionDefinition(definition.key), current.matchesRoute(definition)
    else {
      throw CredentialStorageError(
        "The saved connection changed. Reopen Connections and try again.")
    }
  }

  private func planDefinition(_ key: String?, accountID: String) throws -> ConnectionDefinition? {
    guard let key else { return nil }
    let definition = try connectionDefinition(key)
    guard definition.kind == .chatGPTPlan, definition.accountId == accountID else {
      throw CredentialStorageError("This connection no longer uses the selected ChatGPT account.")
    }
    return definition
  }

  private func modelCatalog(
    _ route: CatalogRoute, definition: ConnectionDefinition?, credential: String,
    intent: CredentialCatalogIntent
  ) async throws -> ConnectionCatalog {
    try Task.checkCancellation()
    try checkedRoute(definition)
    var cache = try catalogCache.load()
    let current = cache[route.slot].flatMap { $0.identity == route.identity ? $0.catalog : nil }
    let legacy = definition.flatMap { cache[$0.key] }.flatMap {
      $0.identity == route.identity ? $0.catalog : nil
    }
    let previous = current ?? legacy
    // A plan snapshot written before signed admission used weaker validation. Keep it for display
    // on failure and replace it on the first successful refresh before using it for a run.
    if intent == .display, let current, current.isFresh { return current }
    let models: [ConnectionModel]
    do {
      models = try await fetchModels(route, credential: credential)
    } catch {
      try Task.checkCancellation()
      try checkedRoute(definition)
      var result = previous ?? ConnectionCatalog()
      result.error = "Couldn’t refresh models. \(error.localizedDescription)"
      // A failed legacy refresh is evidence for display only; error keeps it out of plan admission.
      cache[route.slot] = ConnectionCatalogCache.Entry(identity: route.identity, catalog: result)
      try catalogCache.save(cache, keeping: route.slot)
      return result
    }
    try Task.checkCancellation()
    try checkedRoute(definition)
    let result = ConnectionCatalog(
      models: models.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending },
      fetchedAt: Date().timeIntervalSince1970)
    cache[route.slot] = ConnectionCatalogCache.Entry(identity: route.identity, catalog: result)
    if let definition { cache.removeValue(forKey: definition.key) }
    try catalogCache.save(cache, keeping: route.slot)

    if case .plan(let id) = route, intent == .check {
      // Persist evidence before clearing the pause; neither a fallback nor a failed write recovers it.
      try Task.checkCancellation()
      try checkedRoute(definition)
      if try storage.isPaused(id) { try storage.pause(id, value: false) }
    }
    return result
  }

  func connectionCatalog(_ key: String, intent: CredentialCatalogIntent) async throws
    -> ConnectionCatalog
  {
    try await withLease {
      let definition = try connectionDefinition(key)
      if definition.kind == .chatGPTPlan {
        guard let id = definition.accountId else {
          throw CredentialStorageError("Choose an account for this connection in Settings.")
        }
        let credential = try await planCredential(id)
        return try await modelCatalog(
          .plan(id), definition: definition, credential: credential, intent: intent)
      }
      let record = try boundAPIRecord(definition)
      return try await modelCatalog(
        .api(key, endpoint: record.endpoint), definition: definition, credential: record.key,
        intent: intent)
    }
  }

  private func planCredential(_ accountID: String) async throws -> String {
    let auth = ChatGPTAuth(storage: storage)
    try await auth.load()
    return try await auth.accessToken(accountID: accountID)
  }

  func planCatalog(
    accountID: String, connectionKey: String? = nil, intent: CredentialCatalogIntent = .display
  ) async throws -> ConnectionCatalog {
    try await withLease {
      let definition = try planDefinition(connectionKey, accountID: accountID)
      let credential = try await planCredential(accountID)
      return try await modelCatalog(
        .plan(accountID), definition: definition, credential: credential, intent: intent)
    }
  }

  func planAdmission(
    accountID: String, connectionKey: String?, model: String, effort: String?,
    fast: Bool, requestedTier: String? = nil
  ) async throws -> (token: String, tier: String) {
    try await withLease {
      let definition = try planDefinition(connectionKey, accountID: accountID)
      guard try !storage.isPaused(accountID) else {
        throw CredentialStorageError(
          "ChatGPT plan requests are paused after a usage limit. Run Check in Connections before retrying."
        )
      }
      let token = try await planCredential(accountID)
      let catalog = try await modelCatalog(
        .plan(accountID), definition: definition, credential: token, intent: .display)
      guard catalog.isFresh else {
        throw CredentialStorageError(
          catalog.error ?? "Check this connection’s models before retrying.")
      }
      guard let option = catalog.models.first(where: { $0.id == model }) else {
        throw CredentialStorageError(
          "The chosen ChatGPT model is unavailable. Update its preset in Settings.")
      }
      if let effort, !effort.isEmpty, !option.efforts.contains(effort) {
        throw CredentialStorageError("The chosen reasoning effort is unavailable. Check models.")
      }
      guard !fast || option.fastTier != nil else {
        throw CredentialStorageError("Fast is unavailable for this ChatGPT model.")
      }
      let advertised = fast ? (option.fastTier ?? "default") : "default"
      let tier = advertised == "fast" ? "priority" : advertised
      if let requestedTier, requestedTier != tier {
        throw CredentialStorageError(
          "The requested ChatGPT service tier is unavailable. Check models.")
      }
      return (token, tier)
    }
  }

  private func boundAPIRecord(_ definition: ConnectionDefinition) throws
    -> SharedAuthStorage.APIConnection
  {
    guard definition.kind == .openAIAPI else {
      throw CredentialStorageError("Choose an API connection for this request.")
    }
    let record = try storage.apiConnection(definition.key)
    guard record.endpoint == definition.endpoint else {
      throw CredentialStorageError("This connection's endpoint changed. Add a new connection.")
    }
    return record
  }

  func apiAdmission(
    connectionKey: String?, model: String, capability: ActionCapability
  ) async throws -> SharedAuthStorage.APIConnection {
    try await withLease {
      let record: SharedAuthStorage.APIConnection
      if let connectionKey {
        let definition = try connectionDefinition(connectionKey)
        record = try boundAPIRecord(definition)
        let catalog = try await modelCatalog(
          .api(connectionKey, endpoint: record.endpoint), definition: definition,
          credential: record.key, intent: .display)
        // API connections retain the existing last-good model membership policy.
        if let issue = catalog.issue(model: model, capability: capability) {
          throw CredentialStorageError(issue)
        }
      } else {
        record = try storage.apiConnection("openai-api")
      }
      if capability != .write, record.endpoint != "https://api.openai.com/v1" {
        throw CredentialStorageError("This capability requires an official OpenAI connection.")
      }
      return record
    }
  }

  private func fetchModels(_ route: CatalogRoute, credential: String) async throws
    -> [ConnectionModel]
  {
    let models: [ConnectionModel]
    switch route {
    case .plan:
      let reply = try await http.json(route: .models, credential: credential)
      guard let raw = reply["models"] as? [[String: Any]], raw.count <= 10_000,
        raw.allSatisfy({ $0["visibility"] is String && $0["slug"] is String })
      else { throw CredentialStorageError("The connection returned an invalid model catalog.") }
      models = try raw.filter { $0["visibility"] as? String == "list" }.map { raw in
        guard let model = PlanModelCatalog.model(raw) else {
          throw CredentialStorageError(
            "The model catalog was incomplete. Previous options were kept.")
        }
        return model
      }
    case .api(_, let endpoint):
      let reply = try await http.json(route: .models, credential: credential, endpoint: endpoint)
      guard let raw = reply["data"] as? [[String: Any]], raw.count <= 10_000,
        reply["has_more"] as? Bool != true
      else {
        throw CredentialStorageError("A complete model catalog is unavailable from this endpoint.")
      }
      models = try raw.map { raw in
        guard let id = raw["id"] as? String, !id.isEmpty, id.utf8.count <= 256 else {
          throw CredentialStorageError("The connection returned an invalid model identifier.")
        }
        // Protocol-family support is distinct from catalog membership; no model-ID allowlist.
        let capabilities: [ActionCapability]
        if endpoint != "https://api.openai.com/v1" {
          capabilities = [.write]
        } else if id.hasPrefix("gpt-image-") {
          capabilities = [.draw]
        } else if id.hasPrefix("gpt-realtime") {
          capabilities = [.speak]
        } else if id.hasPrefix("gpt-")
          || id.range(of: "^o[0-9]", options: .regularExpression) != nil
        {
          capabilities = [.write]
        } else {
          capabilities = []
        }
        return ConnectionModel(id: id, capabilities: capabilities)
      }
    }
    guard Set(models.map(\.id)).count == models.count else {
      throw CredentialStorageError(
        "The model catalog contains duplicate IDs. Previous options were kept.")
    }
    return models
  }
}
