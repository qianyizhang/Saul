import Darwin
import Foundation

/// Native Messaging framing is also used by the native EZ pipe.
public struct NativeFrames {
  public static let maximumInputBytes = 48 * 1024 * 1024
  private var pending = Data()
  public init() {}
  /// FileHandle.read(upToCount:) may wait to fill its buffer on a live pipe.
  /// POSIX read returns the available bytes without requiring writer EOF.
  public static func readChunk(from descriptor: Int32) throws -> Data? {
    var buffer = [UInt8](repeating: 0, count: 65_536)
    while true {
      let count = Darwin.read(descriptor, &buffer, buffer.count)
      if count > 0 { return Data(buffer.prefix(count)) }
      if count == 0 { return nil }
      if errno == EINTR { continue }
      throw CredentialStorageError("Saul native pipe could not be read.")
    }
  }
  public mutating func append(_ data: Data) throws -> [Data] {
    pending.append(data)
    var result: [Data] = []
    while pending.count >= 4 {
      let size = pending.prefix(4).enumerated().reduce(0) {
        $0 | (Int($1.element) << ($1.offset * 8))
      }
      guard size > 0, size <= Self.maximumInputBytes else {
        throw CredentialStorageError("Invalid native credential frame size.")
      }
      guard pending.count >= size + 4 else { break }
      result.append(pending.subdata(in: 4..<(4 + size)))
      pending = Data(pending.dropFirst(4 + size))
    }
    guard pending.count <= Self.maximumInputBytes + 4 else {
      throw CredentialStorageError("Native credential frame exceeded its size limit.")
    }
    return result
  }
  public func requireComplete() throws {
    guard pending.isEmpty else {
      throw CredentialStorageError("Native credential frame was interrupted.")
    }
  }
  public static func encode(_ value: Any) throws -> Data {
    let body = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    guard body.count > 0, body.count <= maximumInputBytes else {
      throw CredentialStorageError("Native credential reply exceeded its size limit.")
    }
    var size = UInt32(body.count).littleEndian
    var output = withUnsafeBytes(of: &size) { Data($0) }
    output.append(body)
    return output
  }
}
