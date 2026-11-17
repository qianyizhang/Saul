import Foundation

public struct CredentialStorageError: LocalizedError, Sendable {
  public let errorDescription: String?
  public init(_ message: String) { errorDescription = message }
}
