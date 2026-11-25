import Foundation
import SaulCredentialClient
import SaulNativeValues

extension SharedAuthStorage {
  struct APIConnection: Codable {
    let endpoint: String
    let key: String
    var retired: Bool? = nil
  }
  private func connectionRecords() throws -> [String: APIConnection] {
    guard let data = try records.read(.connections) else { return [:] }
    return try JSONDecoder().decode([String: APIConnection].self, from: data)
  }
  func apiConnection(_ id: String) throws -> APIConnection {
    if id == "openai-api" {
      return APIConnection(endpoint: "https://api.openai.com/v1", key: try apiKey())
    }
    guard let record = try connectionRecords()[id] else {
      throw CredentialStorageError("Set up this connection in Settings → Connections.")
    }
    guard record.retired != true else {
      throw CredentialStorageError("This connection needs a new key. Open Connections.")
    }
    guard ConnectionDefinition.validEndpoint(record.endpoint) else {
      throw CredentialStorageError("The saved connection endpoint is invalid. It was preserved.")
    }
    return record
  }
  func connectionStatus(_ id: String, endpoint: String? = nil) throws -> [String: Any] {
    var disconnected: [String: Any] = ["connected": false]
    if let endpoint {
      try validateEndpoint(id, endpoint: endpoint)
      disconnected["endpoint"] = endpoint
    }
    let record: APIConnection
    if id == "openai-api" {
      guard try records.contains(.openAI) else { return disconnected }
      record = try apiConnection(id)
    } else {
      guard let saved = try connectionRecords()[id] else { return disconnected }
      if let endpoint { try requireMatchingEndpoint(saved, endpoint: endpoint) }
      guard saved.retired != true else { return disconnected }
      guard ConnectionDefinition.validEndpoint(saved.endpoint) else {
        throw CredentialStorageError("The saved connection endpoint is invalid. It was preserved.")
      }
      record = saved
    }
    var status: [String: Any] = ["connected": true, "endpoint": record.endpoint]
    if endpoint == nil { status["keySuffix"] = String(record.key.suffix(4)) }
    return status
  }
  private func validateEndpoint(_ id: String, endpoint: String) throws {
    guard ConnectionDefinition.validEndpoint(endpoint) else {
      throw CredentialStorageError(
        "Use HTTPS, or HTTP on localhost, without credentials or query parameters.")
    }
    if id == "openai-api", endpoint != "https://api.openai.com/v1" {
      throw CredentialStorageError("The built-in OpenAI connection has a fixed endpoint.")
    }
  }
  private func requireMatchingEndpoint(_ record: APIConnection, endpoint: String) throws {
    guard record.endpoint == endpoint else {
      throw CredentialStorageError("A connection's endpoint is fixed. Add another connection.")
    }
  }
  func saveConnectionKey(_ id: String, endpoint: String, key: String?) throws {
    try validateEndpoint(id, endpoint: endpoint)
    if id == "openai-api" {
      try saveKey(key)
      return
    }
    var connections = try connectionRecords()
    if let current = connections[id] { try requireMatchingEndpoint(current, endpoint: endpoint) }
    if let key {
      guard key.utf8.count <= 512, key.utf8.allSatisfy({ $0 > 32 && $0 < 127 }),
        !key.isEmpty
          || ["localhost", "127.0.0.1", "::1", "[::1]"].contains(URL(string: endpoint)?.host ?? "")
      else {
        throw CredentialStorageError("Enter a key without spaces. Local endpoints may omit it.")
      }
      guard connections[id] != nil || connections.count < 32 else {
        throw CredentialStorageError("Keep at most 32 API connections.")
      }
      connections[id] = APIConnection(endpoint: endpoint, key: key)
    } else {
      connections[id] = APIConnection(endpoint: endpoint, key: "", retired: true)
    }
    try records.write(JSONEncoder().encode(connections), to: .connections)
  }
}
