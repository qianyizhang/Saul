import Foundation
import Security

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

/// Separate from ChatGPT credentials and shared configuration. No startup access.
public actor OpenAIKeyStore: OpenAIKeyStorage {
    public init() {}
    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "local.ez.app.openai",
            kSecAttrAccount as String: "api-key",
        ]
    }
    public func read() throws -> String? {
        var query = query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data,
            let key = String(data: data, encoding: .utf8)
        else { throw keychainError(status) }
        return try validatedOpenAIKey(key)
    }
    public func write(_ key: String?) throws {
        guard let key else {
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else {
                throw keychainError(status)
            }
            return
        }
        let data = Data(try validatedOpenAIKey(key).utf8)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let added = SecItemAdd(item as CFDictionary, nil)
            guard added == errSecSuccess else { throw keychainError(added) }
        } else if status != errSecSuccess {
            throw keychainError(status)
        }
    }
    private func keychainError(_ status: OSStatus) -> EZError {
        EZError("Cannot access the OpenAI API key in Keychain (\(status)). Your connection has not changed.")
    }
}
