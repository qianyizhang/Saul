import Foundation

/// Internal provider/authentication context. Only the signed host's safe message projection leaves the owner.
package struct OwnerRequestError: LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  package var errorDescription: String? { message }
}
