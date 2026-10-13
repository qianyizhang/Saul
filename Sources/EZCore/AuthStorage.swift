import Darwin
import Foundation
import Security

public struct Credentials: Codable {
    public var accessToken: String
    public var refreshToken: String?
    public var idToken: String
    public var expiresAt: Date
    public var scopes: [String]
    public var canUsePlan: Bool { scopes.contains("chatgpt.tokens.use.direct") }
}
public struct AccountProfile: Codable, Identifiable {
    public var id: String { clientID }
    public var clientID: String
    public var subject: String?
    public var email: String?
    public var credentials: Credentials?
    public var label: String { "\(email ?? "Pending sign-in") · \(clientID.suffix(6))" }
}
public struct AuthState: Codable {
    public var hostID = "urn:uuid:" + UUID().uuidString.lowercased()
    public var profiles: [AccountProfile] = []
    public var selectedID: String?
    public init() {}
    public var selected: AccountProfile? { profiles.first { $0.id == selectedID } }
}

public protocol CredentialStore {
    func read() throws -> AuthState
    func write(_ state: AuthState) throws
}

public struct KeychainStore: CredentialStore {
    private let service = "local.ez.app.chatgpt"
    public init() {}
    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
            kSecAttrAccount as String: "accounts",
        ]
    }
    public func read() throws -> AuthState {
        var query = query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return AuthState() }
        guard status == errSecSuccess, let data = result as? Data else { throw keychainError(status) }
        return try JSONDecoder().decode(AuthState.self, from: data)
    }
    public func write(_ state: AuthState) throws {
        let data = try JSONEncoder().encode(state)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let added = SecItemAdd(add as CFDictionary, nil)
            guard added == errSecSuccess else { throw keychainError(added) }
        } else if status != errSecSuccess {
            throw keychainError(status)
        }
    }
    private func keychainError(_ status: OSStatus) -> EZError {
        EZError("Keychain: \(SecCopyErrorMessageString(status, nil) as String? ?? String(status))")
    }
}

/// One runtime owns rotating refresh tokens; a second EZ process fails before reading credentials.
public final class SessionLock {
    private var fd: Int32 = -1
    public init(directory: URL) throws {
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        fd = Darwin.open(directory.appendingPathComponent("session.lock").path, O_CREAT | O_RDWR, 0o600)
        guard fd >= 0 else { throw EZError("Cannot open EZ's session lock.") }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else {
            Darwin.close(fd)
            fd = -1
            throw EZError(
                "Another EZ instance is running. Use that window, or quit it before opening this one.")
        }
    }
    deinit {
        if fd >= 0 {
            flock(fd, LOCK_UN)
            Darwin.close(fd)
        }
    }
}
