import Darwin
import Foundation
import Security

package enum NativeSigning {
  package static func signingTeam() throws -> String {
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
  package static func accepts(_ code: SecCode, _ expression: String) -> Bool {
    var requirement: SecRequirement?
    guard SecRequirementCreateWithString(expression as CFString, [], &requirement) == errSecSuccess,
      let requirement
    else { return false }
    return SecCodeCheckValidity(code, [], requirement) == errSecSuccess
  }
}
