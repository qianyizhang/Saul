import EZCore
import Foundation

/// Owns each connection's current check and the evidence it is allowed to publish.
@MainActor final class ConnectionChecks {
    struct Report {
        let status: ConnectionStatus?
        let catalog: ConnectionCatalog?
        let error: String?
    }

    private enum Check {
        case checking(UUID, ConnectionDefinition, previous: Report?)
        case checked(ConnectionDefinition, Report)

        var connection: ConnectionDefinition {
            switch self {
            case .checking(_, let value, _), .checked(let value, _): value
            }
        }
        var report: Report? {
            switch self {
            case .checking(_, _, let previous): previous
            case .checked(_, let report): report
            }
        }
    }

    private var checks: [String: Check] = [:]
    private var focusedCheck: Task<Void, Never>?
    private let status: @MainActor (ConnectionDefinition) async throws -> ConnectionStatus
    private let catalog: @MainActor (ConnectionDefinition, Bool) async throws -> ConnectionCatalog
    var onChange: (@MainActor () -> Void)?

    init(
        status: @escaping @MainActor (ConnectionDefinition) async throws -> ConnectionStatus,
        catalog: @escaping @MainActor (ConnectionDefinition, Bool) async throws -> ConnectionCatalog
    ) {
        self.status = status
        self.catalog = catalog
    }

    var checkingKeys: Set<String> {
        Set(
            checks.compactMap { key, check in
                if case .checking = check { return key }
                return nil
            })
    }

    func report(_ key: String) -> Report? { checks[key]?.report }

    func focus(_ connection: ConnectionDefinition?, onChecked: @escaping @MainActor () -> Void) {
        let previous = focusedCheck
        previous?.cancel()
        focusedCheck = nil
        guard let connection, report(connection.key)?.catalog?.isFresh != true else { return }
        focusedCheck = Task { [weak self] in
            await previous?.value
            guard !Task.isCancelled, let self else { return }
            await refresh(connection)
            if !Task.isCancelled { onChecked() }
        }
    }

    func reconcile(_ connections: [ConnectionDefinition]) {
        let keys = checks.keys.filter { key in
            guard let check = checks[key] else { return false }
            return !connections.contains { $0.matchesRoute(check.connection) }
        }
        if !keys.isEmpty {
            for key in keys { checks[key] = nil }
            onChange?()
        }
    }

    func invalidate(_ key: String) {
        checks[key] = nil
        onChange?()
    }

    func reset() {
        focusedCheck?.cancel()
        focusedCheck = nil
        checks.removeAll()
        onChange?()
    }

    func refresh(_ connection: ConnectionDefinition, force: Bool = false) async {
        let key = connection.key
        if case .checking(_, let checked, _) = checks[key], checked.matchesRoute(connection) { return }
        let previous = checks[key].flatMap { $0.connection.matchesRoute(connection) ? $0.report : nil }
        let ticket = UUID()
        checks[key] = .checking(ticket, connection, previous: previous)
        onChange?()
        var latestStatus: ConnectionStatus?
        do {
            let status = try await self.status(connection)
            guard isCurrent(ticket, key) else { return }
            try Task.checkCancellation()
            latestStatus = status
            let catalog = status.connected ? try await self.catalog(connection, force) : nil
            try Task.checkCancellation()
            settle(ticket, key, with: Report(status: status, catalog: catalog, error: catalog?.error))
        } catch {
            let fallback =
                Task.isCancelled
                ? previous
                : Report(status: latestStatus, catalog: previous?.catalog, error: error.localizedDescription)
            settle(ticket, key, with: fallback)
        }
    }

    private func isCurrent(_ ticket: UUID, _ key: String) -> Bool {
        guard case .checking(let current, _, _) = checks[key] else { return false }
        return ticket == current
    }

    private func settle(_ ticket: UUID, _ key: String, with report: Report?) {
        guard isCurrent(ticket, key), let connection = checks[key]?.connection else { return }
        checks[key] = report.map { .checked(connection, $0) }
        onChange?()
    }
}
