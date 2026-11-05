import Foundation

public struct ConnectionStatus: Codable, Equatable, Sendable {
    public var connected: Bool
    public var identity: String?
    public var endpoint: String?
    public var keySuffix: String?
    public var signedIn: Bool?
    public init(
        connected: Bool, identity: String? = nil, endpoint: String? = nil,
        keySuffix: String? = nil, signedIn: Bool? = nil
    ) {
        self.connected = connected
        self.identity = identity
        self.endpoint = endpoint
        self.keySuffix = keySuffix
        self.signedIn = signedIn
    }
}

public struct ConnectionModel: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var capabilities: [ActionCapability]
    public var efforts: [String]
    public var defaultEffort: String
    public var fastTier: String?
    public init(
        id: String, name: String? = nil, capabilities: [ActionCapability] = [],
        efforts: [String] = [], defaultEffort: String = "", fastTier: String? = nil
    ) {
        self.id = id
        self.name = name ?? id
        self.capabilities = capabilities
        self.efforts = efforts
        self.defaultEffort = defaultEffort
        self.fastTier = fastTier
    }
}

public struct ConnectionCatalog: Codable, Equatable, Sendable {
    public var models: [ConnectionModel]
    public var fetchedAt: Double
    public var error: String?
    public init(models: [ConnectionModel] = [], fetchedAt: Double = 0, error: String? = nil) {
        self.models = models
        self.fetchedAt = fetchedAt
        self.error = error
    }
    public var isFresh: Bool {
        error == nil && fetchedAt > 0 && Date().timeIntervalSince1970 >= fetchedAt
            && Date().timeIntervalSince1970 - fetchedAt < 300
    }
    public func issue(model: String) -> String? {
        guard !model.isEmpty else { return "Choose a model in Presets." }
        guard fetchedAt > 0 else { return error ?? "Loading the connection's models…" }
        guard models.contains(where: { $0.id == model }) else {
            return "Model ‘\(model)’ is no longer available. Update this preset in Settings."
        }
        return nil
    }
    public func options(for capability: ActionCapability) -> [ConnectionModel] {
        models.filter { $0.capabilities.isEmpty || $0.capabilities.contains(capability) }
    }
}
