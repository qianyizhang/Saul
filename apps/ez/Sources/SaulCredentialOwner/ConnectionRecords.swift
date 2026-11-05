import EZCore
import Foundation
import SaulCredentialStorage

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
    func connectionStatus(_ id: String) throws -> [String: Any] {
        if id == "openai-api", try !records.contains(.openAI) {
            return ["connected": false]
        }
        if id != "openai-api", try connectionRecords()[id] == nil {
            return ["connected": false]
        }
        if id != "openai-api", try connectionRecords()[id]?.retired == true { return ["connected": false] }
        let record = try apiConnection(id)
        return [
            "connected": true, "endpoint": record.endpoint,
            "keySuffix": String(record.key.suffix(4)),
        ]
    }
    func saveConnectionKey(_ id: String, endpoint: String, key: String?) throws {
        guard ConnectionDefinition.validEndpoint(endpoint) else {
            throw CredentialStorageError(
                "Use HTTPS, or HTTP on localhost, without credentials or query parameters.")
        }
        if id == "openai-api" {
            guard endpoint == "https://api.openai.com/v1" else {
                throw CredentialStorageError("The built-in OpenAI connection has a fixed endpoint.")
            }
            try saveKey(key)
            return
        }
        var connections = try connectionRecords()
        if let current = connections[id], current.endpoint != endpoint {
            throw CredentialStorageError("A connection's endpoint is fixed. Add another connection.")
        }
        if let key {
            guard key.utf8.count <= 512, key.utf8.allSatisfy({ $0 > 32 && $0 < 127 }),
                !key.isEmpty
                    || ["localhost", "127.0.0.1", "::1", "[::1]"].contains(URL(string: endpoint)?.host ?? "")
            else { throw CredentialStorageError("Enter a key without spaces. Local endpoints may omit it.") }
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
