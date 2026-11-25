import EZCore
import Foundation
import SaulNativeValues

/// Owns list paging, selected detail, and reconciliation with writes during reads.
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
    private let read: @MainActor (String, HistoryCursor?) async throws -> HistoryPage
    private let count: @MainActor (String, [HistoryStore.RecordID]) async throws -> Int
    private let readEntry: @MainActor (HistoryStore.RecordID) async throws -> HistoryEntry?
    let image: LookupImageLoader
    private let delete: @MainActor (HistoryStore.RecordID, Bool, Int64?) async throws -> Void
    private var opening: Task<Void, Never>?
    private(set) var ready = false
    var settling: Bool { opening != nil || deleting != nil }
    private var reading: Task<Void, Never>?
    private var detailRead: Task<Void, Never>?
    private var active: HistoryEntry?
    private var failedSelection: HistoryEntry?
    private var changes: [HistoryStore.RecordID: Change] = [:]
    private var details: [UUID: HistoryEntry] = [:]
    private var detailOrder: [UUID] = []
    private var mutationVersion = 0
    private var selectedID: UUID?
    private var selectedIdentity: HistoryStore.RecordID?
    private var query = ""
    private var next: HistoryCursor?
    private var generation = 0
    private var detailGeneration = 0
    private(set) var deleting: Task<Void, Never>?
    private(set) var entries: [HistoryRow] = []
    private(set) var total = 0
    private(set) var loading = false
    private(set) var detailLoading = false
    private(set) var detailError: String?
    var hasMore: Bool { next != nil }
    var selected: HistoryEntry? { selectedID.flatMap(knownDetail) }
    func knownDetail(_ id: UUID) -> HistoryEntry? {
        if failedSelection?.id == id { return failedSelection }
        return details[id]
    }
    func isTransientFailure(_ id: HistoryStore.RecordID) -> Bool { failedSelection?.recordID == id }
    private func remember(_ entry: HistoryEntry) {
        details[entry.id] = entry
        detailOrder.removeAll { $0 == entry.id }
        detailOrder.append(entry.id)
        let keep = Set(detailOrder.suffix(20))
        details = details.filter {
            keep.contains($0.key) || $0.key == selectedID || $0.key == active?.id
                || $0.value.status == "unsaved"
        }
        detailOrder.removeAll { details[$0] == nil }
    }
    var onChange: (@MainActor () -> Void)?
    var onMissingSelection: (@MainActor () -> Void)?

    init(
        read: @escaping @MainActor (String, HistoryCursor?) async throws -> HistoryPage,
        count: @escaping @MainActor (String, [HistoryStore.RecordID]) async throws -> Int,
        entry: @escaping @MainActor (HistoryStore.RecordID) async throws -> HistoryEntry?,
        readImage: @escaping @MainActor (HistoryEntry) async throws -> Data?,
        delete: @escaping @MainActor (HistoryStore.RecordID, Bool, Int64?) async throws -> Void
    ) {
        self.read = read
        self.count = count
        self.readEntry = entry
        self.delete = delete
        image = LookupImageLoader(read: readImage)
        image.onChange = { [weak self] in self?.onChange?() }
    }

    private func notifyChange() {
        image.select(selected)
        onChange?()
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
                notifyChange()
            }
        }
    }
    func waitForPreparation() async { await opening?.value }
    func waitForSettlement() async {
        await waitForPreparation()
        await deleting?.value
    }
    func waitForSelection() async { await detailRead?.value }

    func show(_ values: [HistoryEntry]) {
        entries = values.map(HistoryRow.init)
        failedSelection = nil
        details = [:]
        detailOrder = []
        for entry in values { remember(entry) }
        total = entries.count
        next = nil
        notifyChange()
    }

    @discardableResult func select(_ id: UUID?, force: Bool = false) -> Task<Void, Never>? {
        detailRead?.cancel()
        detailRead = nil
        detailGeneration += 1
        let identity = id.map { id in
            entries.first { $0.id == id }?.recordID ?? details[id]?.recordID
                ?? (selectedID == id ? selectedIdentity : nil) ?? .native(id)
        }
        selectedID = id
        if failedSelection?.id != id { failedSelection = nil }
        selectedIdentity = identity
        detailError = nil
        detailLoading = false
        guard let id else {
            notifyChange()
            return nil
        }
        if failedSelection != nil || (!force && details[id] != nil) {
            notifyChange()
            return nil
        }
        if let active, active.id == id {
            remember(active)
            notifyChange()
            return nil
        }
        if details[id]?.status == "unsaved", !force {
            notifyChange()
            return nil
        }
        guard let identity else { return nil }
        let token = detailGeneration
        detailLoading = true
        let task = Task {
            do {
                let entry = try await readEntry(identity)
                guard !Task.isCancelled, token == detailGeneration, selectedID == id else { return }
                if let active, active.id == id {
                    remember(active)
                } else if let entry {
                    remember(entry)
                    if force { image.select(entry, retryUnavailable: true) }
                } else {
                    details[id] = nil
                    detailError = "This saved lookup is unavailable."
                    if force { onMissingSelection?() }
                }
            } catch {
                if !Task.isCancelled, token == detailGeneration { detailError = error.localizedDescription }
            }
            if token == detailGeneration {
                detailLoading = false
                detailRead = nil
                notifyChange()
            }
        }
        detailRead = task
        notifyChange()
        return task
    }

    func record(_ entry: HistoryEntry, active isActive: Bool) {
        if isActive && active?.id != entry.id { mutationVersion += 1 }
        active = isActive ? entry : nil
        remember(entry)
        if !isActive {
            mutationVersion += 1
            if reading != nil { changes[entry.recordID] = .upsert(entry) }
        }
        if selectedID == entry.id {
            detailRead?.cancel()
            detailRead = nil
            detailGeneration += 1
            detailLoading = false
        }
        let row = HistoryRow(entry)
        if let index = entries.firstIndex(where: { $0.recordID == entry.recordID }) {
            entries[index] = row
        } else if matches(entry) {
            entries.insert(row, at: 0)
            total += 1
        }
        notifyChange()
    }

    func discardFailed(_ entry: HistoryEntry) {
        active = nil
        forget(entry.recordID)
        if selectedID == entry.id {
            failedSelection = entry
            select(entry.id)
        } else {
            notifyChange()
        }
    }

    private func forget(_ id: HistoryStore.RecordID) {
        mutationVersion += 1
        if reading != nil { changes[id] = .delete }
        let matchesQuery = details.values.contains { $0.recordID == id && matches($0) }
        let previousCount = entries.count
        entries.removeAll { $0.recordID == id }
        details = details.filter { $0.value.recordID != id }
        detailOrder.removeAll { details[$0] == nil }
        if entries.count != previousCount || matchesQuery { total = max(0, total - 1) }
    }
    private func matches(_ entry: HistoryEntry) -> Bool {
        query.isEmpty || entry.query.localizedCaseInsensitiveContains(query)
            || entry.response.localizedCaseInsensitiveContains(query)
    }

    func remove(
        _ id: HistoryStore.RecordID, settledPending: Bool, expectedRevision: Int64?,
        settled: @escaping @MainActor (Result<Void, Error>) -> Void
    )
        -> Task<Void, Never>?
    {
        guard deleting == nil else { return nil }
        let task = Task {
            let outcome: Result<Void, Error>
            do {
                try await delete(id, settledPending, expectedRevision)
                forget(id)
                outcome = .success(())
            } catch { outcome = .failure(error) }
            deleting = nil
            settled(outcome)
            notifyChange()
        }
        deleting = task
        notifyChange()
        return task
    }

    func cancelRead() {
        generation += 1
        reading?.cancel()
        reading = nil
        loading = false
        changes.removeAll()
        detailGeneration += 1
        detailRead?.cancel()
        detailRead = nil
        detailLoading = false
    }

    func refresh(search: String, _ settled: @escaping @MainActor (Result<Void, Error>) -> Void)
        -> Task<Void, Never>?
    {
        guard ready || opening != nil else { return nil }
        cancelRead()
        query = search
        return load(after: nil, replacing: true, settled)
    }

    func more(_ settled: @escaping @MainActor (Result<Void, Error>) -> Void) -> Task<Void, Never>? {
        guard reading == nil, let next else { return nil }
        return load(after: next, replacing: false, settled)
    }

    private func load(
        after cursor: HistoryCursor?, replacing: Bool,
        _ settled: @escaping @MainActor (Result<Void, Error>) -> Void
    ) -> Task<Void, Never> {
        let token = generation
        let search = query
        loading = true
        let task = Task {
            defer {
                if token == generation {
                    reading = nil
                    loading = false
                    changes.removeAll()
                    notifyChange()
                }
            }
            await waitForPreparation()
            guard ready, !Task.isCancelled, token == generation else { return }
            do {
                let page = try await read(search, cursor)
                try Task.checkCancellation()
                guard token == generation else { return }
                var updates: [HistoryStore.RecordID: Change] = [:]
                var currentTotal = page.total
                repeat {
                    let version = mutationVersion
                    updates = changes
                    if let active { updates[active.recordID] = .upsert(active) }
                    var local = updates.values.compactMap { change -> HistoryEntry? in
                        if case .upsert(let entry) = change { return entry }
                        return nil
                    }
                    if !updates.isEmpty {
                        currentTotal = try await count(search, Array(updates.keys))
                        try Task.checkCancellation()
                        guard token == generation else { return }
                        if version != mutationVersion { continue }
                        if let active { updates[active.recordID] = .upsert(active) }
                        local = updates.values.compactMap {
                            if case .upsert(let entry) = $0 { return entry }
                            return nil
                        }
                        currentTotal += local.filter(matches).count
                    }
                    break
                } while true
                var rows = replacing ? page.rows : entries + page.rows
                for (id, change) in updates {
                    rows.removeAll { $0.recordID == id }
                    if case .upsert(let entry) = change, matches(entry) { rows.append(HistoryRow(entry)) }
                }
                var seen = Set<HistoryStore.RecordID>()
                entries = rows.filter { seen.insert($0.recordID).inserted }.sorted {
                    $0.createdAt == $1.createdAt
                        ? $0.id.uuidString > $1.id.uuidString : $0.createdAt > $1.createdAt
                }
                next = page.next
                total = currentTotal
                if replacing {
                    details = details.filter { $0.key == selectedID || $0.key == active?.id }
                    // A newly completed or unsaved result wins over this read's older snapshot.
                    if let id = selectedID,
                        let change = updates.values.first(where: {
                            if case .upsert(let entry) = $0 { return entry.id == id }
                            return false
                        }), case .upsert(let entry) = change
                    {
                        remember(entry)
                    } else {
                        await select(selectedID, force: true)?.value
                    }
                }
                try Task.checkCancellation()
                guard token == generation else { return }
                settled(.success(()))
            } catch { if !Task.isCancelled, token == generation { settled(.failure(error)) } }
        }
        reading = task
        notifyChange()
        return task
    }
}
