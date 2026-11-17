import Darwin
import Foundation
import SaulCredentialClient
import Security

public enum NativeCaller {
  public static func authorize(arguments: [String], extensionIDs: [String]) throws
    -> CredentialCaller
  {
    let caller: CredentialCaller
    let requirement: String
    if arguments == ["--ez"] {
      let team = try NativeSigning.signingTeam()
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
      let parent, NativeSigning.accepts(parent, requirement)
    else {
      throw CredentialStorageError(
        "Saul credentials require the signed app or its registered Chrome connection.")
    }
    return caller
  }
}
