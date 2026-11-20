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
  public var suggestedAppName: String?
  public var label: String {
    "\(email ?? "Pending sign-in") · \(suggestedAppName ?? String(clientID.suffix(6)))"
  }
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
