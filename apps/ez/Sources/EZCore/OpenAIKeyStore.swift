import Foundation

public func validatedOpenAIKey(_ value: String) throws -> String {
    let key = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !key.isEmpty, key.utf8.count <= 512,
        key.utf8.allSatisfy({ $0 > 32 && $0 < 127 })
    else { throw EZError("Enter a valid OpenAI API key without spaces.") }
    return key
}

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
