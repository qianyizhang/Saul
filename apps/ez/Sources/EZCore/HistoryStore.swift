import Darwin
import Foundation

/// Snapshots keyed by id; the latest valid snapshot wins on reload.
/// A stable sidecar lock serializes reads, appends, and atomic deletion rewrites.
public final class HistoryStore {
    public let url: URL
    private let lockURL: URL
    public init(directory: URL) throws {
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        url = directory.appendingPathComponent("history.jsonl")
        lockURL = directory.appendingPathComponent("history.lock")
    }
    public func append(_ entry: HistoryEntry) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        var data = try encoder.encode(entry)
        data.append(0x0A)
        try withLock {
            let fd = Darwin.open(url.path, O_CREAT | O_RDWR | O_APPEND, 0o600)
            guard fd >= 0 else {
                throw EZError("Cannot open local history: \(String(cString: strerror(errno)))")
            }
            defer { Darwin.close(fd) }
            let end = lseek(fd, 0, SEEK_END)
            if end > 0 {
                var last: UInt8 = 0
                guard pread(fd, &last, 1, end - 1) == 1 else { throw EZError("Cannot read history tail.") }
                if last != 0x0A { data.insert(0x0A, at: 0) }
            }
            try write(data, to: fd)
        }
    }
    /// Remove all snapshots with this identity, preserving unrelated bytes verbatim.
    public func delete(id: UUID) throws {
        try withLock {
            guard FileManager.default.fileExists(atPath: url.path) else { return }
            let original = try Data(contentsOf: url)
            var retained = Data()
            var start = original.startIndex
            let decoder = JSONDecoder()
            struct Identity: Decodable { let id: UUID }
            while start < original.endIndex {
                let newline = original[start...].firstIndex(of: 0x0A)
                let end = newline ?? original.endIndex
                let identity = try? decoder.decode(Identity.self, from: Data(original[start..<end]))
                let next = newline.map { original.index(after: $0) } ?? original.endIndex
                if identity?.id != id { retained.append(contentsOf: original[start..<next]) }
                start = next
            }
            guard retained != original else { return }
            // Write and flush an owner-only sibling before replacing the original.
            // Keeping the lock on a separate inode protects writers across rename.
            var template = Array(
                url.deletingLastPathComponent().appendingPathComponent(".history-XXXXXX").path.utf8CString)
            let fd = mkstemp(&template)
            guard fd >= 0 else { throw EZError("Cannot create replacement history.") }
            let temporaryPath = template.withUnsafeBufferPointer { String(cString: $0.baseAddress!) }
            defer {
                Darwin.close(fd)
                unlink(temporaryPath)
            }
            try write(retained, to: fd)
            guard rename(temporaryPath, url.path) == 0 else {
                throw EZError("Cannot replace local history: \(String(cString: strerror(errno)))")
            }
        }
    }
    public func load() throws -> (entries: [HistoryEntry], damagedLines: Int) {
        try withLock {
            guard FileManager.default.fileExists(atPath: url.path) else { return ([], 0) }
            let data = try Data(contentsOf: url)
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            var latest: [UUID: HistoryEntry] = [:]
            var damaged = 0
            for line in data.split(separator: 0x0A) {
                do {
                    var entry = try decoder.decode(HistoryEntry.self, from: Data(line))
                    if entry.status == "pending" { entry.status = "interrupted" }
                    latest[entry.id] = entry
                } catch { damaged += 1 }
            }
            return (latest.values.sorted { $0.createdAt > $1.createdAt }, damaged)
        }
    }
    private func withLock<T>(_ operation: () throws -> T) throws -> T {
        let fd = Darwin.open(lockURL.path, O_CREAT | O_RDWR, 0o600)
        guard fd >= 0 else { throw EZError("Cannot open history lock.") }
        defer { Darwin.close(fd) }
        guard flock(fd, LOCK_EX) == 0 else { throw EZError("Cannot lock local history.") }
        defer { flock(fd, LOCK_UN) }
        return try operation()
    }
    private func write(_ data: Data, to fd: Int32) throws {
        try data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let count = Darwin.write(fd, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else {
                    throw EZError("Cannot save local history: \(String(cString: strerror(errno)))")
                }
                offset += count
            }
        }
        guard fsync(fd) == 0 else { throw EZError("Cannot flush local history to disk.") }
    }
}
