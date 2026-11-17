import EZCore
import Foundation
import SaulCredentialStorage

/// Owns each connection's current check and the evidence it is allowed to publish.
@MainActor final class ConnectionChecks {
    enum Intent: String {
        case passive = "display"
        case setup = "refresh"
        case check

        fileprivate func supersedes(_ active: Self) -> Bool {
            switch (self, active) {
            case (.check, .passive), (.check, .setup), (.setup, .passive): true
            default: false
            }
        }
    }

    struct LogoutOutcome: Decodable {
        let account: SaulAccount
        let warning: String?
    }

    struct Report {
        let status: ConnectionStatus?
        let catalog: ConnectionCatalog?
        let error: String?
    }

    private enum Check {
        case checking(UUID, ConnectionDefinition, intent: Intent, previous: Report?)
        case checked(ConnectionDefinition, Report)

        var connection: ConnectionDefinition {
            switch self {
            case .checking(_, let value, _, _), .checked(let value, _): value
            }
        }
        var report: Report? {
            switch self {
            case .checking(_, _, _, let previous): previous
            case .checked(_, let report): report
            }
        }
    }

    private var checks: [String: Check] = [:]
    private var logoutWarnings: [String: String] = [:]
    private var focusedCheck: Task<Void, Never>?
    private let status: @MainActor (ConnectionDefinition) async throws -> ConnectionStatus
    private let catalog: @MainActor (ConnectionDefinition, Intent) async throws -> ConnectionCatalog
    var onChange: (@MainActor () -> Void)?

    init(
        status: @escaping @MainActor (ConnectionDefinition) async throws -> ConnectionStatus,
        catalog: @escaping @MainActor (ConnectionDefinition, Intent) async throws -> ConnectionCatalog
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

    func isCheckingExplicitly(_ key: String) -> Bool {
        if case .checking(_, _, .check, _) = checks[key] { return true }
        return false
    }

    func logoutWarning(for connection: ConnectionDefinition) -> String? {
        connection.accountId.flatMap { logoutWarnings[$0] }
    }

    func clearLogoutWarning(accountID: String) {
        if logoutWarnings.removeValue(forKey: accountID) != nil { onChange?() }
    }

    func didSignOut(_ outcome: LogoutOutcome, from connection: ConnectionDefinition) throws {
        guard let accountID = connection.accountId,
            outcome.account.id == accountID, !outcome.account.signedIn
        else { throw EZError("Saul returned an invalid sign-out result.") }
        logoutWarnings[accountID] = outcome.warning
        let report = Report(
            status: ConnectionStatus(connected: false, identity: outcome.account.label, signedIn: false),
            catalog: nil, error: nil)
        let aliases = checks.values.map(\.connection).filter {
            $0.kind == .chatGPTPlan && $0.accountId == accountID
        }
        for alias in aliases + [connection] { checks[alias.key] = .checked(alias, report) }
        onChange?()
    }

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

    func refresh(_ connection: ConnectionDefinition, intent: Intent = .passive) async {
        let key = connection.key
        if case .checking(_, let checked, let active, _) = checks[key], checked.matchesRoute(connection),
            !intent.supersedes(active)
        {
            return
        }
        let previous = checks[key].flatMap { $0.connection.matchesRoute(connection) ? $0.report : nil }
        let ticket = UUID()
        checks[key] = .checking(ticket, connection, intent: intent, previous: previous)
        onChange?()
        var latestStatus: ConnectionStatus?
        do {
            let status = try await self.status(connection)
            guard isCurrent(ticket, key) else { return }
            try Task.checkCancellation()
            latestStatus = status
            let catalog = status.connected ? try await self.catalog(connection, intent) : nil
            try Task.checkCancellation()
            settle(ticket, key, with: Report(status: status, catalog: catalog, error: catalog?.error))
        } catch {
            let signedOut = previous?.status.flatMap { $0.signedIn == false ? $0 : nil }
            let fallback =
                Task.isCancelled
                ? previous
                : Report(
                    status: latestStatus ?? signedOut,
                    catalog: previous?.catalog, error: error.localizedDescription)
            settle(ticket, key, with: fallback)
        }
    }

    private func isCurrent(_ ticket: UUID, _ key: String) -> Bool {
        guard case .checking(let current, _, _, _) = checks[key] else { return false }
        return ticket == current
    }

    private func settle(_ ticket: UUID, _ key: String, with report: Report?) {
        guard isCurrent(ticket, key), let connection = checks[key]?.connection else { return }
        checks[key] = report.map { .checked(connection, $0) }
        onChange?()
    }
}
