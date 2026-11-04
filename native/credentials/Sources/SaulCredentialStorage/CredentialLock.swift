import Darwin
import Foundation

/// A kernel lease serializes refresh/write effects across all on-demand owner processes.
/// An exited or killed process releases its lease without a stale PID-file recovery algorithm.
public final class CredentialLease: Sendable {
  private let descriptor: Int32
  private init(_ descriptor: Int32) { self.descriptor = descriptor }
  deinit {
    _ = flock(descriptor, LOCK_UN)
    _ = close(descriptor)
  }

  public static func acquire(in directory: URL, timeout: Duration = .seconds(30)) async throws
    -> CredentialLease
  {
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let attributes = try FileManager.default.attributesOfItem(atPath: directory.path)
    guard attributes[.type] as? FileAttributeType == .typeDirectory,
      attributes[.ownerAccountID] as? UInt32 == getuid(),
      (attributes[.posixPermissions] as? Int ?? 0o777) & 0o077 == 0,
      directory.standardizedFileURL.resolvingSymlinksInPath() == directory.standardizedFileURL
    else {
      throw CredentialStorageError(
        "Saul's credential directory must be private and must not be a symlink.")
    }
    let descriptor = open(
      directory.appendingPathComponent("credentials.lock").path,
      O_CREAT | O_RDWR | O_NOFOLLOW | O_CLOEXEC, 0o600)
    guard descriptor >= 0 else {
      throw CredentialStorageError("Cannot open Saul's credential lock.")
    }
    var info = stat()
    guard fstat(descriptor, &info) == 0, info.st_uid == getuid(),
      info.st_mode & S_IFMT == S_IFREG, info.st_mode & 0o077 == 0
    else {
      close(descriptor)
      throw CredentialStorageError("Saul's credential lock must be an owner-only regular file.")
    }
    let deadline = ContinuousClock.now.advanced(by: timeout)
    do {
      while flock(descriptor, LOCK_EX | LOCK_NB) != 0 {
        guard errno == EWOULDBLOCK || errno == EAGAIN else {
          throw CredentialStorageError("Cannot acquire Saul's credential lock.")
        }
        try Task.checkCancellation()
        guard ContinuousClock.now < deadline else {
          throw CredentialStorageError("Saul credentials are busy. Try again shortly.")
        }
        try await Task.sleep(for: .milliseconds(25))
      }
      try Task.checkCancellation()
      return CredentialLease(descriptor)
    } catch {
      close(descriptor)
      throw error
    }
  }
}
