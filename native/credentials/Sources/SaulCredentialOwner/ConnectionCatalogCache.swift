import Foundation
import SaulCredentialClient
import SaulNativeValues

/// Disposable discovery data. Every operation runs under the credential owner's lease.
struct ConnectionCatalogCache {
  struct Entry: Codable {
    let identity: String
    let catalog: ConnectionCatalog
  }

  private static let maxBytes = 8_000_000
  private static let maxEntries = 64
  private let url: URL

  init(directory: URL) {
    self.url = directory.appendingPathComponent("connection-catalogs.json")
  }

  func load() throws -> [String: Entry] {
    let data: Data
    do {
      guard let bytes = try AtomicFile.readPrivatePrefix(at: url, count: Self.maxBytes + 1) else {
        return [:]
      }
      data = bytes
    } catch {
      throw CredentialStorageError("Couldn’t read the model cache. Check its file permissions.")
    }

    // Decode each slot independently. A bad slot cannot hide a different connection's last good catalog.
    guard data.count <= Self.maxBytes,
      let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else {
      try save([:])
      return [:]
    }
    var repaired: [String: Entry] = [:]
    let decoder = JSONDecoder()
    for (key, value) in object {
      guard
        let bytes = try? JSONSerialization.data(
          withJSONObject: value, options: [.fragmentsAllowed]),
        let entry = try? decoder.decode(Entry.self, from: bytes),
        !entry.identity.isEmpty, entry.catalog.fetchedAt >= 0,
        entry.catalog.models.count <= 10_000,
        entry.catalog.models.allSatisfy({ !$0.id.isEmpty }),
        Set(entry.catalog.models.map(\.id)).count == entry.catalog.models.count
      else { continue }
      repaired[key] = entry
    }
    if repaired.count != object.count || repaired.count > Self.maxEntries {
      return try save(repaired)
    }
    return repaired
  }

  private func oldestKeys(_ cache: [String: Entry], keeping slot: String?) -> [String] {
    cache.keys.filter { $0 != slot }.sorted {
      let lhs = cache[$0]?.catalog.fetchedAt ?? 0
      let rhs = cache[$1]?.catalog.fetchedAt ?? 0
      return lhs == rhs ? $1 < $0 : lhs > rhs
    }
  }

  @discardableResult func save(_ snapshot: [String: Entry], keeping slot: String? = nil) throws
    -> [String: Entry]
  {
    var cache = snapshot
    var oldest = oldestKeys(cache, keeping: slot)
    while cache.count > Self.maxEntries, let key = oldest.popLast() {
      cache.removeValue(forKey: key)
    }
    while true {
      let data = try JSONEncoder().encode(cache)
      if data.count <= Self.maxBytes {
        do {
          try AtomicFile.write(data, to: url)
        } catch {
          throw CredentialStorageError(
            "Couldn’t write the model cache. Check its file permissions.")
        }
        return cache
      }
      guard let key = oldest.popLast() else {
        throw CredentialStorageError("The connection returned an oversized model catalog.")
      }
      cache.removeValue(forKey: key)
    }
  }
}
