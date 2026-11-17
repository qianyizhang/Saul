import EZCore
import Foundation
import SaulNativeValues

/// Owns local history mutations and merges any newer attempt/delete into a read already in flight.
@MainActor final class HistoryCollection {
    enum Preparation {
        case ready
        case unavailable(String)
        case open(@MainActor () async throws -> Void)
    }

    private enum Change {
        case upsert(HistoryEntry)
        case delete
    }

    private let read: @MainActor () async throws -> [HistoryEntry]
    private let delete: @MainActor (HistoryStore.RecordID) async throws -> Void
    private var opening: Task<Void, Never>?
    private(set) var ready = false
    var settling: Bool { opening != nil || deleting != nil }
    private var reading: Task<Void, Never>?
    private var active: HistoryEntry?
    private var changes: [HistoryStore.RecordID: Change] = [:]
    private(set) var deleting: Task<Void, Never>?
    private(set) var entries: [HistoryEntry] = []
    var onChange: (@MainActor () -> Void)?

    init(
        read: @escaping @MainActor () async throws -> [HistoryEntry],
        delete: @escaping @MainActor (HistoryStore.RecordID) async throws -> Void
    ) {
        self.read = read
        self.delete = delete
    }

    func prepare(_ preparation: Preparation, failed: @escaping @MainActor (String) -> Void) {
        switch preparation {
        case .ready: ready = true
        case .unavailable(let message): failed(message)
        case .open(let open):
            opening = Task {
                do {
                    try await open()
                    ready = true
                } catch { failed(error.localizedDescription) }
                opening = nil
                onChange?()
            }
        }
    }

    func waitForPreparation() async { await opening?.value }

    func waitForSettlement() async {
        await waitForPreparation()
        await deleting?.value
    }

    func show(_ entries: [HistoryEntry]) {
        self.entries = entries
        onChange?()
    }

    func record(_ entry: HistoryEntry, active isActive: Bool) {
        active = isActive ? entry : nil
        if !isActive && reading != nil { changes[entry.recordID] = .upsert(entry) }
        if let index = entries.firstIndex(where: { $0.recordID == entry.recordID }) {
            entries[index] = entry
        } else {
            entries.insert(entry, at: 0)
        }
        onChange?()
    }

    func remove(_ id: HistoryStore.RecordID, settled: @escaping @MainActor (Result<Void, Error>) -> Void)
        -> Task<Void, Never>?
    {
        guard deleting == nil else { return nil }
        let task = Task {
            let outcome: Result<Void, Error>
            do {
                try await delete(id)
                if reading != nil { changes[id] = .delete }
                entries.removeAll { $0.recordID == id }
                outcome = .success(())
            } catch { outcome = .failure(error) }
            deleting = nil
            settled(outcome)
            onChange?()
        }
        deleting = task
        onChange?()
        return task
    }

    func cancelRead() {
        reading?.cancel()
        reading = nil
        changes.removeAll()
    }

    func refresh(_ settled: @escaping @MainActor (Result<Void, Error>) -> Void) -> Task<Void, Never>? {
        guard ready || opening != nil else { return nil }
        cancelRead()
        let task = Task { [self] in
            await waitForPreparation()
            guard ready, !Task.isCancelled else {
                if !Task.isCancelled { reading = nil }
                return
            }
            do {
                var saved = try await read()
                try Task.checkCancellation()
                var updates = changes
                if let active { updates[active.recordID] = .upsert(active) }
                if !updates.isEmpty {
                    saved.removeAll { updates[$0.recordID] != nil }
                    for case .upsert(let entry) in updates.values { saved.append(entry) }
                    saved.sort {
                        $0.createdAt == $1.createdAt
                            ? $0.id.uuidString > $1.id.uuidString : $0.createdAt > $1.createdAt
                    }
                }
                show(saved)
                settled(.success(()))
            } catch {
                if !Task.isCancelled { settled(.failure(error)) }
            }
            if !Task.isCancelled {
                reading = nil
                changes.removeAll()
            }
        }
        reading = task
        return task
    }
}
