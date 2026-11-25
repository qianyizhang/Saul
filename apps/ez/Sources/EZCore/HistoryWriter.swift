import Foundation

/// Serializes EZ's SQLite mutations away from the UI actor. No mutation is retried.
public actor HistoryWriter {
    private let directory: URL
    private var store: HistoryStore?

    public init(directory: URL) { self.directory = directory }

    public func prepare() throws {
        let prepared = try HistoryStore(directory: directory)
        try prepared.recoverInterrupted()
        store = prepared
    }

    public func append(_ entry: HistoryEntry) throws { try connection().append(entry) }
    public func delete(
        _ id: HistoryStore.RecordID, settledPending: Bool = false, expectedRevision: Int64? = nil
    ) throws {
        try connection().delete(id, settledPending: settledPending, expectedRevision: expectedRevision)
    }

    public func discard(_ id: HistoryStore.RecordID) throws { try connection().discardPending(id) }
    public func commit(_ id: HistoryStore.RecordID, snapshot: HistoryEntry, write: HistoryWrite) throws
        -> HistoryAcknowledgement
    {
        try connection().commit(id, snapshot: snapshot, write: write)
    }
    public func mask(_ target: HistoryTarget, write: HistoryWrite) throws -> HistoryAcknowledgement {
        try connection().mask(target, write: write)
    }
    public func restore(_ target: HistoryTarget, write: HistoryWrite) throws -> HistoryAcknowledgement {
        try connection().restore(target, write: write)
    }
    public func purge(_ target: HistoryTarget, write: HistoryWrite) throws -> HistoryAcknowledgement {
        try connection().purge(target, write: write)
    }
    public func clear(_ scope: HistoryCollectionScope, write: HistoryWrite) throws -> HistoryAcknowledgement {
        try connection().clear(scope, write: write)
    }
    public func pruneExpired() throws { try connection().expireMasks() }
    public func receipt(_ operationID: String) throws -> HistoryAcknowledgement? {
        try connection().receipt(operationID)
    }

    private func connection() throws -> HistoryStore {
        if let store { return store }
        let store = try HistoryStore(writing: directory)
        self.store = store
        return store
    }
}
