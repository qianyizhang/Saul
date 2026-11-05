import EZCore
import Foundation
import SaulCredentialStorage

extension CredentialOwner {
    private struct CachedCatalog: Codable {
        let identity: String
        let catalog: ConnectionCatalog
    }
    private var catalogURL: URL { storage.directory.appendingPathComponent("connection-catalogs.json") }
    private func savedCatalogs() throws -> [String: CachedCatalog] {
        guard FileManager.default.fileExists(atPath: catalogURL.path) else { return [:] }
        let attributes = try FileManager.default.attributesOfItem(atPath: catalogURL.path)
        guard attributes[.type] as? FileAttributeType == .typeRegular,
            (attributes[.size] as? Int ?? Int.max) <= 8_000_000
        else {
            throw CredentialStorageError("The model cache is invalid. It was preserved.")
        }
        return try JSONDecoder().decode([String: CachedCatalog].self, from: Data(contentsOf: catalogURL))
    }
    func invalidateCatalog(_ key: String) throws {
        var cache = try savedCatalogs()
        cache.removeValue(forKey: key)
        try JSONEncoder().encode(cache).write(to: catalogURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: catalogURL.path)
    }
    func connectionCatalog(_ connection: ConnectionDefinition, force: Bool = false) async throws
        -> ConnectionCatalog
    {
        let identity =
            connection.kind == .chatGPTPlan ? (connection.accountId ?? "unbound") : connection.endpoint
        // One cross-process lease coalesces refreshes from both apps and serializes token rotation.
        let lease = try await CredentialLease.acquire(in: storage.directory)
        defer { withExtendedLifetime(lease) {} }
        var cache = try savedCatalogs()
        let previous = cache[connection.key].flatMap { $0.identity == identity ? $0.catalog : nil }
        if !force, let previous, previous.isFresh { return previous }
        do {
            let models: [ConnectionModel]
            if connection.kind == .chatGPTPlan {
                guard let id = connection.accountId else {
                    throw CredentialStorageError("Choose an account for this connection in Settings.")
                }
                let auth = ChatGPTAuth(storage: storage)
                try await auth.load()
                let token = try await auth.accessToken(accountID: id)
                let reply = try await http.json(route: .models, credential: token)
                guard let raw = reply["models"] as? [[String: Any]], raw.count <= 10_000,
                    raw.allSatisfy({ $0["visibility"] is String && $0["slug"] is String })
                else {
                    throw CredentialStorageError("The connection returned an invalid model catalog.")
                }
                models = try raw.filter { $0["visibility"] as? String == "list" }.map { raw in
                    guard let option = ModelOption(catalog: raw) else {
                        throw CredentialStorageError(
                            "The model catalog was incomplete. Previous options were kept.")
                    }
                    return ConnectionModel(
                        id: option.model, name: option.displayName, capabilities: [.write],
                        efforts: option.supportedReasoningEfforts.map(\.reasoningEffort),
                        defaultEffort: option.defaultReasoningEffort, fastTier: option.fastTier)
                }
            } else {
                let record = try storage.apiConnection(connection.key)
                guard record.endpoint == connection.endpoint else {
                    throw CredentialStorageError("This connection's endpoint changed. Add a new connection.")
                }
                let reply = try await http.json(
                    route: .models, credential: record.key, endpoint: record.endpoint)
                guard let raw = reply["data"] as? [[String: Any]], raw.count <= 10_000,
                    reply["has_more"] as? Bool != true
                else {
                    throw CredentialStorageError(
                        "A complete model catalog is unavailable from this endpoint.")
                }
                models = try raw.map { raw in
                    guard let id = raw["id"] as? String, !id.isEmpty, id.utf8.count <= 256 else {
                        throw CredentialStorageError("The connection returned an invalid model identifier.")
                    }
                    // Protocol-family support is distinct from catalog membership; no model-ID allowlist.
                    let capabilities: [ActionCapability]
                    if record.endpoint != "https://api.openai.com/v1" {
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
            let result = ConnectionCatalog(
                models: models.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending },
                fetchedAt: Date().timeIntervalSince1970)
            cache[connection.key] = CachedCatalog(identity: identity, catalog: result)
            let active = Set(try connectionDefinitions().map(\.key))
            cache = cache.filter { active.contains($0.key) }
            try JSONEncoder().encode(cache).write(to: catalogURL, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: catalogURL.path)
            return result
        } catch {
            var result = previous ?? ConnectionCatalog()
            result.error = "Couldn’t refresh models. \(error.localizedDescription)"
            cache[connection.key] = CachedCatalog(identity: identity, catalog: result)
            try JSONEncoder().encode(cache).write(to: catalogURL, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: catalogURL.path)
            return result
        }
    }
    func requireModel(_ model: String, connectionKey: String) async throws {
        let connection = try connectionDefinition(connectionKey)
        let catalog = try await connectionCatalog(connection)
        if let issue = catalog.issue(model: model) { throw CredentialStorageError(issue) }
    }
    func connectionDefinition(_ key: String) throws -> ConnectionDefinition {
        guard let definition = try connectionDefinitions().first(where: { $0.key == key }) else {
            throw CredentialStorageError("This saved connection is unavailable. Open Connections.")
        }
        return definition
    }
}
