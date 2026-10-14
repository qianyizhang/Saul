import Foundation

public struct CheckFailure: Error, CustomStringConvertible {
    public let description: String
    public init(_ message: String, file: StaticString = #filePath, line: UInt = #line) {
        description = "\(file):\(line): \(message)"
    }
}

public func expect(
    _ condition: @autoclosure () throws -> Bool, _ message: String,
    file: StaticString = #filePath, line: UInt = #line
) throws {
    if try !condition() { throw CheckFailure(message, file: file, line: line) }
}

public func expectEqual<T: Equatable>(
    _ actual: T, _ expected: T, _ message: String,
    file: StaticString = #filePath, line: UInt = #line
) throws {
    if actual != expected {
        throw CheckFailure(
            "\(message); expected \(String(reflecting: expected)), got \(String(reflecting: actual))",
            file: file, line: line)
    }
}

@discardableResult public func expectThrows<E: Error>(
    _ type: E.Type, matching: (E) -> Bool = { _ in true },
    file: StaticString = #filePath, line: UInt = #line, _ body: () throws -> Void
) throws -> E {
    do {
        try body()
    } catch {
        guard let expected = error as? E, matching(expected) else {
            throw CheckFailure("Expected matching \(type), got \(error)", file: file, line: line)
        }
        return expected
    }
    throw CheckFailure("Expected \(type), but operation succeeded", file: file, line: line)
}

@MainActor @discardableResult public func expectAsyncThrows<E: Error>(
    _ type: E.Type, matching: (E) -> Bool = { _ in true },
    file: StaticString = #filePath, line: UInt = #line, _ body: () async throws -> Void
) async throws -> E {
    do {
        try await body()
    } catch {
        guard let expected = error as? E, matching(expected) else {
            throw CheckFailure("Expected matching \(type), got \(error)", file: file, line: line)
        }
        return expected
    }
    throw CheckFailure("Expected \(type), but operation succeeded", file: file, line: line)
}

/// Filesystem errors must come from Foundation or POSIX, not an assertion or unrelated domain.
public func isFileError(_ error: NSError) -> Bool {
    error.domain == NSCocoaErrorDomain || error.domain == NSPOSIXErrorDomain
}
