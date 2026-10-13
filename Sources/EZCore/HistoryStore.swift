import Darwin
import Foundation

/// Append-only snapshots, keyed by id. The latest valid snapshot wins on reload.
/// flock protects concurrent app instances; a damaged tail is preserved and skipped.
public final class HistoryStore {
    public let url: URL
    public init(directory: URL) throws {
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        url = directory.appendingPathComponent("history.jsonl")
    }
    public func append(_ entry: HistoryEntry) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        var data = try encoder.encode(entry)
        data.append(0x0A)
        let fd = Darwin.open(url.path, O_CREAT | O_RDWR | O_APPEND, 0o600)
        guard fd >= 0 else { throw EZError("Cannot open local history: \(String(cString: strerror(errno)))") }
        defer { Darwin.close(fd) }
        guard flock(fd, LOCK_EX) == 0 else { throw EZError("Cannot lock local history.") }
        defer { flock(fd, LOCK_UN) }
        let end = lseek(fd, 0, SEEK_END)
        if end > 0 {
            var last: UInt8 = 0
            guard pread(fd, &last, 1, end - 1) == 1 else { throw EZError("Cannot read history tail.") }
            if last != 0x0A { data.insert(0x0A, at: 0) }
        }
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
    public func load() throws -> (entries: [HistoryEntry], damagedLines: Int) {
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
