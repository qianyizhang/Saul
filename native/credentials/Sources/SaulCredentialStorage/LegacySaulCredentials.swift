import Foundation

/// One-time schema conversion. The original registration, identity and complete token set stay together.
/// Returned JSON uses the existing native AuthState representation (dates since Apple's reference date).
public enum LegacySaulCredentials {
  public static func converted(_ data: Data, selectedID: String? = nil) throws -> Data {
    guard data.count <= 2_000_000,
      let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      root["version"] as? Int == 1, let host = root["hostId"] as? String,
      !host.isEmpty, host.utf8.count <= 512,
      let accounts = root["accounts"] as? [[String: Any]], accounts.count <= 100
    else { throw invalid() }
    var seen = Set<String>()
    let profiles: [[String: Any]] = try accounts.map { account in
      guard let id = account["clientId"] as? String, !id.isEmpty, id.utf8.count <= 256,
        seen.insert(id).inserted
      else { throw invalid() }
      var profile: [String: Any] = ["clientID": id]
      if let subject = account["subject"] {
        guard let subject = subject as? String, !subject.isEmpty else { throw invalid() }
        profile["subject"] = subject
      }
      if let email = account["email"] {
        guard let email = email as? String else { throw invalid() }
        profile["email"] = email
      }
      if let tokens = account["tokens"] {
        guard account["subject"] != nil, let tokens = tokens as? [String: Any],
          let expiry = tokens["expiresAt"] as? Double, expiry.isFinite,
          let scopes = tokens["scopes"] as? [String], scopes.allSatisfy({ !$0.isEmpty }),
          ["accessToken", "refreshToken", "idToken"].allSatisfy({ key in
            tokens[key] == nil || (tokens[key] as? String).map { !$0.isEmpty } == true
          })
        else { throw invalid() }
        // A registration without usable access/identity tokens still supports an explicit re-sign-in.
        if let access = tokens["accessToken"] as? String,
          let identity = tokens["idToken"] as? String
        {
          var credentials: [String: Any] = [
            "accessToken": access, "idToken": identity, "scopes": scopes,
            "expiresAt": Date(timeIntervalSince1970: expiry / 1000).timeIntervalSinceReferenceDate,
          ]
          if let refresh = tokens["refreshToken"] { credentials["refreshToken"] = refresh }
          profile["credentials"] = credentials
        }
      }
      return profile
    }
    var state: [String: Any] = ["hostID": host, "profiles": profiles]
    if let selectedID {
      guard seen.contains(selectedID) else {
        throw CredentialStorageError("Select an existing Saul registration before migration.")
      }
      state["selectedID"] = selectedID
    } else if profiles.count == 1 {
      state["selectedID"] = profiles[0]["clientID"]
    }
    return try JSONSerialization.data(withJSONObject: state, options: [.sortedKeys])
  }
  private static func invalid() -> CredentialStorageError {
    CredentialStorageError(
      "Saul's saved sign-in cannot be imported. The source was preserved; sign in again explicitly."
    )
  }
}
