import Foundation

/// One explicit attempt owns generation and the durable terminal outcome together.
@MainActor public final class AttemptExecution {
    public typealias Stream =
        @MainActor (
            HistoryEntry, String, @escaping @MainActor (ResponseAccumulator) -> Void
        ) async throws -> ResponseAccumulator

    public struct Update {
        public let entry: HistoryEntry
        public let activity: ResponseActivity
        public let isActive: Bool
    }

    public var onChange: (@MainActor (Update) -> Void)?
    public private(set) var activeID: UUID?
    private let accessToken: @MainActor () async throws -> String
    private let stream: Stream
    private let append: @MainActor (HistoryEntry) throws -> Void
    private var active: HistoryEntry?
    private var task: Task<Void, Never>?
    private struct Unsaved {
        let terminal: HistoryEntry
        var error: String
    }
    private var unsaved: [UUID: Unsaved] = [:]

    public init(
        accessToken: @escaping @MainActor () async throws -> String,
        stream: @escaping Stream,
        append: @escaping @MainActor (HistoryEntry) throws -> Void
    ) {
        self.accessToken = accessToken
        self.stream = stream
        self.append = append
    }

    public func saveError(for id: UUID) -> String? { unsaved[id]?.error }

    public func start(_ entry: HistoryEntry) throws {
        guard activeID == nil else { throw EZError("An attempt is already running.") }
        guard entry.status == "pending", unsaved[entry.id] == nil else {
            throw EZError("Start a new lookup to send another request.")
        }
        do { try append(entry) } catch {
            throw EZError("Query not sent: history could not be saved. \(error.localizedDescription)")
        }
        active = entry
        activeID = entry.id
        publish(entry, activity: .waiting, isActive: true)
        task = Task {
            do {
                try Task.checkCancellation()
                let token = try await accessToken()
                try Task.checkCancellation()
                let result = try await stream(entry, token) { [weak self] progress in
                    self?.progress(progress, for: entry.id)
                }
                try Task.checkCancellation()
                progress(result, for: entry.id)
                try result.requireCompleted()
                finish(entry.id, status: "completed")
            } catch is CancellationError {
                finish(entry.id, status: "interrupted")
            } catch {
                let cancelled = (error as? URLError)?.code == .cancelled
                finish(
                    entry.id, status: cancelled ? "interrupted" : "failed",
                    error: cancelled ? nil : error.localizedDescription)
            }
        }
    }

    public func stop() {
        guard let id = activeID else { return }
        task?.cancel()
        finish(id, status: "interrupted")
    }

    /// Repeats only the append of the frozen terminal snapshot; never generates again.
    public func saveAgain(_ id: UUID) {
        guard activeID == nil, var pending = unsaved[id] else { return }
        do {
            try append(pending.terminal)
            unsaved.removeValue(forKey: id)
            publish(pending.terminal, activity: .finished, isActive: false)
        } catch {
            pending.error = error.localizedDescription
            unsaved[id] = pending
            publish(unsavedProjection(pending.terminal), activity: .finished, isActive: false)
        }
    }

    /// Call only after the owning history deletion succeeds.
    public func forget(_ id: UUID) { unsaved.removeValue(forKey: id) }

    private func progress(_ result: ResponseAccumulator, for id: UUID) {
        guard var entry = active, activeID == id else { return }
        entry.response = result.text
        entry.metrics = result.metrics
        entry.actualServiceTier = result.actualServiceTier
        active = entry
        publish(entry, activity: result.activity, isActive: true)
    }

    private func finish(_ id: UUID, status: String, error message: String? = nil) {
        guard var entry = active, activeID == id else { return }
        entry.status = status
        entry.error = message
        entry.durationSeconds = Date().timeIntervalSince(entry.createdAt)
        var visible = entry
        do {
            try append(entry)
        } catch {
            unsaved[id] = Unsaved(terminal: entry, error: error.localizedDescription)
            visible = unsavedProjection(entry)
        }
        active = nil
        activeID = nil
        task = nil
        publish(visible, activity: .finished, isActive: false)
    }

    private func unsavedProjection(_ entry: HistoryEntry) -> HistoryEntry {
        var visible = entry
        visible.status = "unsaved"
        return visible
    }

    private func publish(_ entry: HistoryEntry, activity: ResponseActivity, isActive: Bool) {
        onChange?(Update(entry: entry, activity: activity, isActive: isActive))
    }
}
