import Foundation

public struct CredentialStorageError: LocalizedError, Sendable {
  public let errorDescription: String?
  public let reason: String?
  public init(_ message: String, reason: String? = nil) {
    errorDescription = message
    self.reason = reason
  }
}
