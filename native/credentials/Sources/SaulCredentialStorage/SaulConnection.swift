import Foundation

public struct SaulAccount: Codable, Equatable, Sendable, Identifiable {
  public let id: String
  public let label: String
  public let signedIn: Bool
  public let planEnabled: Bool
}

@MainActor public final class SaulConnection {
  public private(set) var accounts: [SaulAccount] = []
  public private(set) var selectedID: String?
  public private(set) var apiConnected = false
  public var selected: SaulAccount? { accounts.first { $0.id == selectedID } }
  private let transport: @MainActor (Data) throws -> NativeCredentialReplies
  public init(
    transport: @escaping @MainActor (Data) throws -> NativeCredentialReplies = SaulNativePipe.events
  ) {
    self.transport = transport
  }

  public func load() async throws {
    let result = try await call(["action": "status"])
    guard let accounts = result["accounts"] as? [[String: Any]],
      let connected = result["apiConnected"] as? Bool
    else {
      throw CredentialStorageError("Saul returned an invalid connection status.")
    }
    let data = try JSONSerialization.data(withJSONObject: accounts)
    let profiles = try JSONDecoder().decode([SaulAccount].self, from: data)
    let selected = result["selectedAccountId"] as? String
    guard selected == nil || profiles.contains(where: { $0.id == selected }) else {
      throw CredentialStorageError("Saul returned an unknown selected account.")
    }
    self.accounts = profiles
    selectedID = selected
    apiConnected = connected
  }
  public func select(_ id: String) async throws {
    _ = try await call(["action": "select", "accountId": id])
    try await load()
  }
  public func signIn(
    newAccount: Bool = false, enablePlan: Bool = false,
    openBrowser: @escaping @MainActor (URL) -> Bool
  ) async throws {
    var request: [String: Any] = ["action": "login", "consent": enablePlan]
    if !newAccount, let selectedID { request["accountId"] = selectedID }
    _ = try await call(request, authorize: openBrowser)
    try await load()
  }
  public func signOut() async throws -> String? {
    guard let selectedID else { return nil }
    let result = try await call(["action": "logout", "accountId": selectedID])
    try await load()
    return result["warning"] as? String
  }
  public func keyStatus() async throws -> Bool {
    let result = try await call(["action": "api-key-status"])
    guard let connected = result["apiConnected"] as? Bool else {
      throw CredentialStorageError("Saul returned an invalid API connection status.")
    }
    apiConnected = connected
    return connected
  }
  public func saveKey(_ key: String?) async throws {
    var request: [String: Any] = ["action": key == nil ? "api-key-remove" : "api-key-save"]
    if let key { request["key"] = key }
    _ = try await call(request)
    _ = try await keyStatus()
  }
  public func call(
    _ request: [String: Any],
    authorize: (@MainActor (URL) -> Bool)? = nil,
    onEvent: (@MainActor ([String: Any]) throws -> Void)? = nil
  ) async throws -> [String: Any] {
    let id = UUID().uuidString
    let frame = try NativeFrames.encode(["version": 1, "id": id, "request": request])
    let replies = try transport(frame)
    defer { replies.close() }
    for try await data in replies.stream {
      try Task.checkCancellation()
      guard let reply = try JSONSerialization.jsonObject(with: data) as? [String: Any],
        reply["id"] as? String == id,
        let event = reply["event"] as? [String: Any], let type = event["type"] as? String
      else { throw CredentialStorageError("Saul returned an invalid native reply.") }
      if type == "authorize" {
        guard let raw = event["url"] as? String, let url = URL(string: raw), url.scheme == "https",
          url.host == "auth.openai.com", url.path == "/api/accounts/authorize", url.user == nil,
          url.password == nil, url.port == nil, let authorize, authorize(url)
        else { throw CredentialStorageError("Could not open Saul's official sign-in destination.") }
      } else if type == "error" {
        throw CredentialStorageError(
          event["message"] as? String ?? "Saul could not complete the request.")
      } else if type == "result" || type == "complete" {
        return event
      } else {
        try onEvent?(event)
      }
    }
    try Task.checkCancellation()
    throw CredentialStorageError(
      "Saul disconnected before completing the operation. Retry explicitly.")
  }
}
