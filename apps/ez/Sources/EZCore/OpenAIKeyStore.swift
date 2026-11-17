import Foundation

public protocol OpenAIKeyStorage: Sendable {
    func read() async throws -> String?
    func write(_ key: String?) async throws
}

public actor TemporaryAPIKeyStore: OpenAIKeyStorage {
    private var key: String?
    public init() {}
    public func read() -> String? { key }
    public func write(_ key: String?) { self.key = key }
}
