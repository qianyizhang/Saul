import Foundation

/// Owns admission, generation and the decision to save a terminal outcome.
@MainActor public final class AttemptExecution {
    public enum Output {
        case text(ResponseAccumulator)
        case image(Data)
    }
    public typealias Generation =
        @MainActor (
            HistoryEntry, @escaping @MainActor (ResponseAccumulator) -> Void
        ) async throws -> Output

    public struct Progress {
        public enum Phase {
            case preparing, generating, saving
        }
        public let entry: HistoryEntry
        public let phase: Phase
        public let activity: ResponseActivity
    }

    public enum Update {
        case running(Progress)
        case notSent(id: UUID, message: String)
        case saved(HistoryEntry)
        case saveFailed(HistoryEntry, message: String)
    }

    private enum Phase {
        case idle
        case preparing(HistoryEntry, Task<Void, Never>, cancelled: Outcome?)
        case generating(HistoryEntry, Task<Void, Never>)
        case saving(Task<Void, Never>)
    }

    private enum Outcome {
        case completed, stopped, interrupted
        case failed(String)

        func record(in entry: inout HistoryEntry) {
            switch self {
            case .completed: entry.status = "completed"
            case .stopped: entry.status = "cancelled"
            case .interrupted: entry.status = "interrupted"
            case .failed(let message):
                entry.status = "failed"
                entry.error = message
            }
        }
    }

    public var onChange: (@MainActor (Update) -> Void)?
    private let generate: Generation
    private let append: @MainActor (HistoryEntry) async throws -> Void
    private var phase = Phase.idle
    private var shuttingDown = false

    public init(
        generate: @escaping Generation, append: @escaping @MainActor (HistoryEntry) async throws -> Void
    ) {
        self.generate = generate
        self.append = append
    }

    public func start(_ entry: HistoryEntry) throws {
        guard !shuttingDown else { throw EZError("EZ is quitting.") }
        guard case .idle = phase else { throw EZError("An attempt is already running.") }
        guard entry.status == "pending" else {
            throw EZError("Start a new lookup to send another request.")
        }
        let task = Task { await prepare(entry) }
        phase = .preparing(entry, task, cancelled: nil)
        publish(entry, phase: .preparing)
    }

    public func stop() { cancel(.stopped) }

    public func beginShutdown() {
        shuttingDown = true
        cancel(.interrupted)
    }

    /// Waits for persistence, never for a provider that ignores cancellation.
    public func waitForSettlement() async {
        while !Task.isCancelled {
            switch phase {
            case .preparing(_, let task, _), .saving(let task): await task.value
            case .idle, .generating: return
            }
        }
    }

    private func cancel(_ outcome: Outcome) {
        switch phase {
        case .preparing(let entry, let task, nil):
            // Even if Stop arrives during the write, let the outcome of that write decide
            // whether there is a pending row to settle. The provider is never entered.
            phase = .preparing(entry, task, cancelled: outcome)
        case .generating(let entry, let task):
            task.cancel()
            save(entry, outcome: outcome)
        case .idle, .preparing, .saving:
            break
        }
    }

    private func prepare(_ entry: HistoryEntry) async {
        do {
            try await append(entry)
        } catch {
            phase = .idle
            onChange?(
                .notSent(
                    id: entry.id,
                    message: "Query not sent: history could not be saved. \(error.localizedDescription)"))
            return
        }
        guard case .preparing(_, _, let cancelled) = phase else { return }
        if let cancelled {
            save(entry, outcome: cancelled)
            return
        }
        let task = Task { await run(entry) }
        phase = .generating(entry, task)
        publish(entry, phase: .generating)
    }

    private func run(_ entry: HistoryEntry) async {
        do {
            try Task.checkCancellation()
            let result = try await generate(entry) { [weak self] response in
                self?.progress(response, for: entry.id)
            }
            guard case .generating(var current, _) = phase, current.id == entry.id else { return }
            switch result {
            case .text(let response):
                record(response, in: &current)
                // Preserve the final partial payload even when completion validation fails.
                do {
                    try response.requireCompleted(webSearchRequired: entry.usesWebSearch)
                } catch {
                    save(current, outcome: .failed(error.localizedDescription))
                    return
                }
            case .image(let data):
                current.imageData = data
            }
            save(current, outcome: .completed)
        } catch {
            guard case .generating(let current, _) = phase, current.id == entry.id else { return }
            let cancelled = error is CancellationError || (error as? URLError)?.code == .cancelled
            save(current, outcome: cancelled ? .interrupted : .failed(error.localizedDescription))
        }
    }

    private func record(_ response: ResponseAccumulator, in entry: inout HistoryEntry) {
        entry.response = response.text
        entry.citations = response.citations
        entry.webSearchCompleted = response.webSearchCompleted
        entry.metrics = response.metrics
        entry.actualServiceTier = response.actualServiceTier
    }

    private func progress(_ response: ResponseAccumulator, for id: UUID) {
        guard case .generating(var entry, let task) = phase, entry.id == id else { return }
        record(response, in: &entry)
        phase = .generating(entry, task)
        publish(entry, phase: .generating, activity: response.activity)
    }

    private func publish(
        _ entry: HistoryEntry, phase: Progress.Phase, activity: ResponseActivity = .waiting
    ) {
        onChange?(.running(Progress(entry: entry, phase: phase, activity: activity)))
    }

    private func save(_ pending: HistoryEntry, outcome: Outcome) {
        var terminal = pending
        outcome.record(in: &terminal)
        terminal.durationSeconds = Date().timeIntervalSince(terminal.createdAt)
        let task = Task { await persist(terminal) }
        phase = .saving(task)
        // Keep the provisional answer readable. Images and completed status are
        // published by the terminal update; a progress update is not saved success.
        var preview = pending
        preview.imageData = nil
        preview.inputImage?.data = nil
        publish(preview, phase: .saving)
    }

    private func persist(_ snapshot: HistoryEntry) async {
        var entry = snapshot
        let update: Update
        do {
            try await append(entry)
            entry.storedImage = entry.imageData != nil || entry.storedImage
            entry.imageData = nil
            entry.inputImage?.data = nil
            update = .saved(entry)
        } catch {
            entry.inputImage?.data = nil  // The input is already in the pending row.
            update = .saveFailed(entry, message: error.localizedDescription)
        }
        phase = .idle
        onChange?(update)
    }
}
