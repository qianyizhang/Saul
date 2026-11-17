import Foundation

/// Runs one frozen request and reports whether its terminal snapshot reached history.
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
        public let entry: HistoryEntry
        public let activity: ResponseActivity
    }

    public enum Update {
        case running(Progress)
        case saved(HistoryEntry)
        case saveFailed(HistoryEntry, message: String)
    }

    private struct Running {
        var entry: HistoryEntry
        let task: Task<Void, Never>
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
    private let append: @MainActor (HistoryEntry) throws -> Void
    private var running: Running?

    public init(
        generate: @escaping Generation, append: @escaping @MainActor (HistoryEntry) throws -> Void
    ) {
        self.generate = generate
        self.append = append
    }

    public func start(_ entry: HistoryEntry) throws {
        guard running == nil else { throw EZError("An attempt is already running.") }
        guard entry.status == "pending" else {
            throw EZError("Start a new lookup to send another request.")
        }
        do { try append(entry) } catch {
            throw EZError("Query not sent: history could not be saved. \(error.localizedDescription)")
        }
        let task = Task { [self] in await run(entry) }
        running = Running(entry: entry, task: task)
        onChange?(.running(Progress(entry: entry, activity: .waiting)))
    }

    public func stop() { cancel(.stopped) }
    public func interrupt() { cancel(.interrupted) }

    private func cancel(_ outcome: Outcome) {
        guard let running else { return }
        running.task.cancel()
        finish(running.entry.id, outcome: outcome)
    }

    private func run(_ entry: HistoryEntry) async {
        do {
            try Task.checkCancellation()
            let result = try await generate(entry) { [weak self] response in
                self?.progress(response, for: entry.id)
            }
            try Task.checkCancellation()
            switch result {
            case .text(let response):
                progress(response, for: entry.id)
                try response.requireCompleted(webSearchRequired: entry.usesWebSearch)
            case .image(let data):
                guard running?.entry.id == entry.id else { return }
                running?.entry.imageData = data
            }
            finish(entry.id, outcome: .completed)
        } catch is CancellationError {
            finish(entry.id, outcome: .interrupted)
        } catch {
            let cancelled = (error as? URLError)?.code == .cancelled
            finish(entry.id, outcome: cancelled ? .interrupted : .failed(error.localizedDescription))
        }
    }

    private func progress(_ response: ResponseAccumulator, for id: UUID) {
        guard var entry = running?.entry, entry.id == id else { return }
        entry.response = response.text
        entry.citations = response.citations
        entry.webSearchCompleted = response.webSearchCompleted
        entry.metrics = response.metrics
        entry.actualServiceTier = response.actualServiceTier
        running?.entry = entry
        onChange?(.running(Progress(entry: entry, activity: response.activity)))
    }

    private func finish(_ id: UUID, outcome: Outcome) {
        guard var entry = running?.entry, entry.id == id else { return }
        outcome.record(in: &entry)
        entry.durationSeconds = Date().timeIntervalSince(entry.createdAt)
        let update: Update
        do {
            try append(entry)
            entry.storedImage = entry.imageData != nil || entry.storedImage
            entry.imageData = nil
            entry.inputImage?.data = nil
            update = .saved(entry)
        } catch {
            entry.inputImage?.data = nil  // The input is already in the pending row.
            update = .saveFailed(entry, message: error.localizedDescription)
        }
        running = nil
        onChange?(update)
    }
}
