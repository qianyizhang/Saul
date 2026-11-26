import Foundation

public struct ConnectionFence: Codable, Equatable, Sendable {
  public let connectionKey: String
  public let token: UUID
  public init(connectionKey: String, token: UUID) {
    self.connectionKey = connectionKey
    self.token = token
  }
}
