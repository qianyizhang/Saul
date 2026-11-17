import Foundation

/// Serializes EZ's SQLite mutations away from the UI actor. No mutation is retried.
public actor HistoryWriter {
    private let directory: URL
    private var store: HistoryStore?

    public init(directory: URL) { self.directory = directory }

    public func prepare(migrating legacyDirectory: URL?) throws {
        let prepared = try HistoryStore(directory: directory, migrating: legacyDirectory)
        try prepared.recoverInterrupted()
        store = prepared
    }

    public func append(_ entry: HistoryEntry) throws { try connection().append(entry) }
    public func delete(_ id: HistoryStore.RecordID) throws { try connection().delete(id) }

    private func connection() throws -> HistoryStore {
        if let store { return store }
        let store = try HistoryStore(writing: directory)
        self.store = store
        return store
    }
}
