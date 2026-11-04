import Darwin
import Foundation
import Security

/// A native app launches the same independently installed signed owner used by Chrome.
public enum SaulNativePipe {
  public static var executable: URL {
    FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent(
        "Library/Application Support/Little Clarity/Credentials/Saul.app/Contents/MacOS/Saul")
  }
  public static func verifyOwner(at executable: URL) throws {
    let team = try NativeCaller.signingTeam()
    var code: SecStaticCode?
    var requirement: SecRequirement?
    let expression =
      "anchor apple generic and identifier \"local.saul.credentials\" and certificate leaf[subject.OU] = \"\(team)\""
    guard SecStaticCodeCreateWithPath(executable as CFURL, [], &code) == errSecSuccess,
      let code,
      SecRequirementCreateWithString(expression as CFString, [], &requirement) == errSecSuccess,
      let requirement, SecStaticCodeCheckValidity(code, [], requirement) == errSecSuccess
    else {
      throw CredentialStorageError(
        "Install or update the signed Saul credential helper before connecting.")
    }
  }
  public static func events(for data: Data) throws -> NativeCredentialReplies {
    try verifyOwner(at: executable)
    guard data.count <= NativeFrames.maximumInputBytes else {
      throw CredentialStorageError("Credential request is too large.")
    }
    let child = NativeCredentialChild(executable: executable)
    let stream = AsyncThrowingStream<Data, Error> { continuation in
      continuation.onTermination = { _ in child.stop() }
      Task.detached(priority: .userInitiated) {
        do {
          try child.start(data)
          var frames = NativeFrames()
          while let data = try NativeFrames.readChunk(
            from: child.output.fileHandleForReading.fileDescriptor)
          {
            for frame in try frames.append(data) { continuation.yield(frame) }
          }
          try frames.requireComplete()
          child.process.waitUntilExit()
          guard child.process.terminationStatus == 0 else {
            throw CredentialStorageError("Saul credential helper stopped. Retry explicitly.")
          }
          continuation.finish()
        } catch { continuation.finish(throwing: error) }
      }
    }
    return NativeCredentialReplies(stream: stream, close: { child.stop() })
  }
}

public struct NativeCredentialReplies: Sendable {
  public let stream: AsyncThrowingStream<Data, Error>
  public let close: @Sendable () -> Void
  public init(stream: AsyncThrowingStream<Data, Error>, close: @escaping @Sendable () -> Void) {
    self.stream = stream
    self.close = close
  }
}

private final class NativeCredentialChild: @unchecked Sendable {
  let process = Process()
  let output = Pipe()
  private let input = Pipe()
  private let lock = NSLock()
  private var stopped = false
  init(executable: URL) {
    process.executableURL = executable
    process.arguments = ["--ez"]
    process.standardInput = input
    process.standardOutput = output
    // Protocol errors are typed replies. Never inherit a caller's diagnostic logger.
    process.standardError = FileHandle.nullDevice
  }
  func start(_ data: Data) throws {
    lock.lock()
    defer { lock.unlock() }
    guard !stopped else { throw CancellationError() }
    try process.run()
    _ = fcntl(input.fileHandleForWriting.fileDescriptor, F_SETNOSIGPIPE, 1)
    try input.fileHandleForWriting.write(contentsOf: data)
  }
  func stop() {
    lock.lock()
    defer { lock.unlock() }
    guard !stopped else { return }
    stopped = true
    try? input.fileHandleForWriting.close()
    if process.isRunning { process.terminate() }
  }
}
