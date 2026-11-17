import Darwin
import Foundation

/// Commits encoded bytes through a private, synced file on the same volume.
public enum AtomicFile {
  public enum Failure: Error {
    case staging(NSError)
    case replacing(NSError)
  }

  public static func write(_ data: Data, to url: URL) throws {
    let directory = url.deletingLastPathComponent()
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let staged = directory.appendingPathComponent(".write-\(UUID()).tmp")
    let fd = Darwin.open(staged.path, O_WRONLY | O_CREAT | O_EXCL, 0o600)
    guard fd >= 0 else { throw Failure.staging(posixError()) }
    defer { try? FileManager.default.removeItem(at: staged) }
    let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    try handle.write(contentsOf: data)
    try handle.synchronize()
    try handle.close()
    guard Darwin.rename(staged.path, url.path) == 0 else { throw Failure.replacing(posixError()) }
  }

  private static func posixError() -> NSError {
    NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
  }
}
