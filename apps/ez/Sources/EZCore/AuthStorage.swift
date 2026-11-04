import Darwin
import Foundation

public struct Credentials: Codable, Sendable {
    public var accessToken: String
    public var refreshToken: String?
    public var idToken: String
    public var expiresAt: Date
    public var scopes: [String]
    public var canUsePlan: Bool { scopes.contains("chatgpt.tokens.use.direct") }
}
public struct AccountProfile: Codable, Identifiable, Sendable {
    public var id: String { clientID }
    public var clientID: String
    public var subject: String?
    public var email: String?
    public var credentials: Credentials?
    public var label: String { "\(email ?? "Pending sign-in") · \(clientID.suffix(6))" }
}
public struct AuthState: Codable, Sendable {
    public var hostID = "urn:uuid:" + UUID().uuidString.lowercased()
    public var profiles: [AccountProfile] = []
    public var selectedID: String?
    public init() {}
    public var selected: AccountProfile? { profiles.first { $0.id == selectedID } }
}

public protocol CredentialStore {
    @MainActor func read() async throws -> AuthState
    func write(_ state: AuthState) throws
}

/// One EZ process owns native draft/runtime coordination. The Saul owner separately serializes credentials.
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
