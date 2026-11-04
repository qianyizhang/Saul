import Foundation
import LocalAuthentication
import Security

public struct CredentialStorageError: LocalizedError, Sendable {
  public let errorDescription: String?
  public init(_ message: String) { errorDescription = message }
}

public enum CredentialRecord: String, Sendable {
  case chatGPT = "com.saul.credentials.chatgpt"
  case openAI = "com.saul.credentials.openai"
  public var account: String { self == .chatGPT ? "accounts" : "api-key" }
}

public protocol CredentialRecords: Sendable {
  func read(_ record: CredentialRecord) throws -> Data?
  func contains(_ record: CredentialRecord) throws -> Bool
  func write(_ data: Data?, to record: CredentialRecord) throws
}

/// Only the signed Saul owner uses this implementation. Clients exchange operations, not records.
public struct KeychainRecords: CredentialRecords {
  private let interactionAllowed: Bool
  public init(interactionAllowed: Bool = true) { self.interactionAllowed = interactionAllowed }

  private func query(_ record: CredentialRecord) -> [String: Any] {
    let context = LAContext()
    context.interactionNotAllowed = !interactionAllowed
    return [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: record.rawValue,
      kSecAttrAccount as String: record.account,
      kSecUseAuthenticationContext as String: context,
    ]
  }
  public func read(_ record: CredentialRecord) throws -> Data? {
    var query = query(record)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else { throw failure(status) }
    return data
  }
  /// Availability does not decrypt an unused provider's secret.
  public func contains(_ record: CredentialRecord) throws -> Bool {
    var query = query(record)
    query[kSecReturnAttributes as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    let status = SecItemCopyMatching(query as CFDictionary, nil)
    if status == errSecItemNotFound { return false }
    guard status == errSecSuccess else { throw failure(status) }
    return true
  }
  public func write(_ data: Data?, to record: CredentialRecord) throws {
    guard let data else {
      let status = SecItemDelete(query(record) as CFDictionary)
      guard status == errSecSuccess || status == errSecItemNotFound else { throw failure(status) }
      return
    }
    guard data.count <= 2_000_000 else {
      throw CredentialStorageError("Credential record is too large.")
    }
    let status = SecItemUpdate(
      query(record) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecItemNotFound {
      var item = query(record)
      item[kSecValueData as String] = data
      let added = SecItemAdd(item as CFDictionary, nil)
      guard added == errSecSuccess else { throw failure(added) }
    } else if status != errSecSuccess {
      throw failure(status)
    }
  }
  private func failure(_ status: OSStatus) -> CredentialStorageError {
    CredentialStorageError(
      "Saul cannot access Keychain (\(status)). Saved connections were not replaced.")
  }
}

public struct VerifiedCredentialRecords: Sendable {
  private let records: any CredentialRecords
  public init(_ records: any CredentialRecords) { self.records = records }
  public func read(_ record: CredentialRecord) throws -> Data? { try records.read(record) }
  public func contains(_ record: CredentialRecord) throws -> Bool { try records.contains(record) }
  public func write(_ data: Data?, to record: CredentialRecord) throws {
    try records.write(data, to: record)
    guard try records.read(record) == data else {
      throw CredentialStorageError(
        "Saul could not verify its Keychain write. Migration sources were not retired; retry or sign in again."
      )
    }
  }
}
