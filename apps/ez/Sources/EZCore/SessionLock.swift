import Darwin
import Foundation

/// One EZ process owns native draft/runtime coordination. The Saul owner separately serializes credentials.
public final class SessionLock {
    private var fd: Int32 = -1
    public init(directory: URL) throws {
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        fd = Darwin.open(directory.appendingPathComponent("session.lock").path, O_CREAT | O_RDWR, 0o600)
        guard fd >= 0 else { throw EZError("Cannot open EZ's session lock.") }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else {
            Darwin.close(fd)
            fd = -1
            throw EZError(
                "Another EZ instance is running. Use that window, or quit it before opening this one.")
        }
    }
    deinit {
        if fd >= 0 {
            flock(fd, LOCK_UN)
            Darwin.close(fd)
        }
    }
}
