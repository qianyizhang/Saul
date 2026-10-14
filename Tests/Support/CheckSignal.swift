import Foundation

/// A sticky signal: notifications sent before waiting are retained. No timing sleeps in cases.
public actor CheckSignal {
    private var signaled = false
    private var waiters: [UUID: CheckedContinuation<Void, Error>] = [:]
    public init() {}
    public func signal() {
        signaled = true
        let waiting = waiters.values
        waiters.removeAll()
        for waiter in waiting { waiter.resume() }
    }
    public func wait(file: StaticString = #filePath, line: UInt = #line) async throws {
        try Task.checkCancellation()
        if signaled { return }
        let id = UUID()
        let timer = Task {
            do { try await Task.sleep(nanoseconds: 3_000_000_000) } catch { return }
            expire(id, file: file, line: line)
        }
        defer { timer.cancel() }
        try await withTaskCancellationHandler {
            try Task.checkCancellation()
            try await withCheckedThrowingContinuation { waiters[id] = $0 }
        } onCancel: {
            Task { await self.cancel(id) }
        }
    }
    private func cancel(_ id: UUID) {
        waiters.removeValue(forKey: id)?.resume(throwing: CancellationError())
    }
    private func expire(_ id: UUID, file: StaticString, line: UInt) {
        waiters.removeValue(forKey: id)?.resume(
            throwing: CheckFailure("Timed out waiting for fixture signal", file: file, line: line))
    }
}
