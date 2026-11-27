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

  /// Reads a bounded prefix from an owner-only regular file. A missing file returns nil.
  public static func readPrivatePrefix(at url: URL, count: Int) throws -> Data? {
    let descriptor = Darwin.open(url.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
    if descriptor < 0 && errno == ENOENT { return nil }
    guard descriptor >= 0 else { throw posixError() }
    let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
    defer { try? handle.close() }
    var info = stat()
    guard fstat(descriptor, &info) == 0 else { throw posixError() }
    guard info.st_uid == getuid(), info.st_mode & S_IFMT == S_IFREG,
      info.st_mode & 0o077 == 0
    else { throw POSIXError(.EACCES) }
    return try handle.read(upToCount: count) ?? Data()
  }

  private static func posixError() -> NSError {
    NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
  }
}
