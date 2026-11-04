import Darwin
import Foundation
import Security

public enum CredentialCaller: String, Sendable { case saul, ez }

public enum NativeCaller {
  public static func authorize(arguments: [String], extensionIDs: [String]) throws
    -> CredentialCaller
  {
    let caller: CredentialCaller
    let requirement: String
    if arguments == ["--ez"] {
      let team = try signingTeam()
      requirement =
        "anchor apple generic and identifier \"local.ez.app\" and certificate leaf[subject.OU] = \"\(team)\""
      caller = .ez
    } else if arguments.count == 1,
      extensionIDs.contains(where: { arguments[0] == "chrome-extension://\($0)/" })
    {
      requirement =
        "anchor apple generic and certificate leaf[subject.OU] = \"EQHXZ8M8AV\" and (identifier \"com.google.Chrome\" or identifier \"com.google.Chrome.for.testing\")"
      caller = .saul
    } else {
      throw CredentialStorageError("Unrecognized Saul credential caller.")
    }
    var parent: SecCode?
    let attributes = [kSecGuestAttributePid as String: getppid()] as CFDictionary
    guard SecCodeCopyGuestWithAttributes(nil, attributes, [], &parent) == errSecSuccess,
      let parent, accepts(parent, requirement)
    else {
      throw CredentialStorageError(
        "Saul credentials require the signed app or its registered Chrome connection.")
    }
    return caller
  }

  public static func signingTeam() throws -> String {
    var code: SecCode?
    var staticCode: SecStaticCode?
    var info: CFDictionary?
    guard SecCodeCopySelf([], &code) == errSecSuccess, let code,
      SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode,
      SecCodeCopySigningInformation(
        staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info)
        == errSecSuccess,
      let dictionary = info as? [String: Any],
      let team = dictionary[kSecCodeInfoTeamIdentifier as String] as? String,
      team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil,
      accepts(code, "anchor apple generic")
    else { throw CredentialStorageError("Saul credentials require valid Apple-issued signing.") }
    return team
  }
  private static func accepts(_ code: SecCode, _ expression: String) -> Bool {
    var requirement: SecRequirement?
    guard SecRequirementCreateWithString(expression as CFString, [], &requirement) == errSecSuccess,
      let requirement
    else { return false }
    return SecCodeCheckValidity(code, [], requirement) == errSecSuccess
  }
}
