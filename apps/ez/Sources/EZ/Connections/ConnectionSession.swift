import EZCore
import Foundation
import SaulCredentialClient
import SaulNativeValues

/// The app's connection lifecycle. Per-route status and catalog evidence stay with ConnectionChecks.
@MainActor final class ConnectionSession {
    enum Operation { case signIn, save, disconnect }

    enum SetupCommand {
        case start(ConnectionDefinition, previous: ConnectionDefinition?, confirmedName: String?)
        case resume(UUID, phase: ConnectionSetup.Phase)
        case repair(UUID, choice: SetupRepairChoice)
    }

    enum SetupRepairChoice {
        case replaceKey, signIn, enablePlan

        var title: String {
            switch self {
            case .replaceKey: "Repair key"
            case .signIn: "Sign in again"
            case .enablePlan: "Enable plan use"
            }
        }
    }

    struct Client {
        var accounts: @MainActor () async throws -> [SaulAccount] = { [] }
        var signIn: @MainActor (String, String?, Bool, UUID?) async throws -> String? = { _, _, _, _ in
            throw EZError("Sign-in is unavailable.")
        }
        var confirmAppName: @MainActor (String, String, UUID?) async throws -> Void = { _, _, _ in
            throw EZError("App name confirmation is unavailable.")
        }
        var saveKey: @MainActor (ConnectionDefinition, String, UUID?) async throws -> Void = { _, _, _ in
            throw EZError("Credential storage is unavailable.")
        }
        var keyStatus: @MainActor (ConnectionDefinition) async throws -> ConnectionStatus = { _ in
            throw EZError("Credential status is unavailable.")
        }
        var removeKey: @MainActor (ConnectionDefinition) async throws -> Void = { _ in
            throw EZError("Credential storage is unavailable.")
        }
        var signOut: @MainActor (String) async throws -> ConnectionChecks.LogoutOutcome = { _ in
            throw EZError("Sign-out is unavailable.")
        }
    }

    let checks: ConnectionChecks
    private let client: Client
    private(set) var connected: Bool
    private(set) var connecting = false
    private(set) var operation: Operation?
    private(set) var profiles: [SaulAccount] = []
    private var accountRevision = 0
    private var closed = false
    private let setupStore = ConnectionSetupStore()
    private let protection: ConnectionProtection?
    var pendingSetups: [ConnectionSetup] { setupStore.records }
    func repairChoice(for id: UUID) -> SetupRepairChoice? { setupStore.repairs[id] }
    private let setPreference: @MainActor (Bool) -> Void
    var onChange: (@MainActor () -> Void)?

    init(
        checks: ConnectionChecks, client: Client = Client(), connected: Bool = true,
        protection: ConnectionProtection? = nil,
        setPreference: @escaping @MainActor (Bool) -> Void = { _ in }
    ) {
        self.checks = checks
        self.client = client
        self.protection = protection
        self.connected = connected
        self.setPreference = setPreference
        setupStore.onChange = { [weak self] in self?.onChange?() }
    }

    func setConnected(_ connected: Bool) {
        guard !closed else { return }
        self.connected = connected
        setPreference(connected)
        if !connected {
            accountRevision += 1
            checks.reset()
            profiles = []
        }
        onChange?()
    }

    func connect(_ work: @MainActor () async -> Void) async {
        guard connected, !closed, !connecting, operation == nil else { return }
        connecting = true
        onChange?()
        defer {
            connecting = false
            onChange?()
        }
        await work()
    }

    private func begin(_ operation: Operation, blocked: Bool) throws {
        guard connected, !closed else { throw EZError("Connect to Saul before changing credentials.") }
        guard !blocked, !connecting, self.operation == nil else {
            throw EZError("Wait for the current operation before changing connections.")
        }
        self.operation = operation
        onChange?()
    }

    private func endOperation() {
        operation = nil
        onChange?()
    }

    func loadAccounts() async throws {
        guard connected, !closed else { return }
        let revision = accountRevision
        let profiles = try await client.accounts()
        try Task.checkCancellation()
        guard connected, !closed, accountRevision == revision else { return }
        self.profiles = profiles
        onChange?()
    }

    func signIn(
        _ account: String, suggestedAppName: String?, consent: Bool, connections: [ConnectionDefinition],
        blocked: Bool
    ) async throws -> String? {
        try begin(.signIn, blocked: blocked)
        defer { endOperation() }
        try await protection?.requireSupport()
        let account = try await client.signIn(account, suggestedAppName, consent, nil)
        accountRevision += 1
        guard !closed else { return nil }
        if let account {
            checks.clearLogoutWarning(accountID: account)
            for connection in connections where connection.accountId == account {
                checks.invalidate(connection.key)
            }
        }
        try Task.checkCancellation()
        try await loadAccounts()
        return account
    }

    func removeCredential(_ connection: ConnectionDefinition, blocked: Bool) async throws {
        try begin(.disconnect, blocked: blocked)
        defer { endOperation() }
        try await protection?.requireSupport()
        if connection.kind == .chatGPTPlan {
            guard let account = connection.accountId else { throw EZError("This connection has no account.") }
            let outcome = try await client.signOut(account)
            guard !closed else { return }
            try checks.didSignOut(outcome, from: connection)
            accountRevision += 1
            if let index = profiles.firstIndex(where: { $0.id == account }) {
                profiles[index] = outcome.account
            }
            onChange?()
        } else {
            try await client.removeKey(connection)
            if !closed { checks.invalidate(connection.key) }
        }
        if !closed { await checks.refresh(connection) }
    }

    func close() {
        closed = true
        checks.reset()
    }
    func loadSetup(in directory: URL) throws { try setupStore.load(in: directory) }

    func discardSetup(_ id: UUID, phase: ConnectionSetup.Phase, in directory: URL) async throws {
        try begin(.save, blocked: false)
        defer { endOperation() }
        let setup = try setupStore.require(id, phase: phase, in: directory)
        if let protection, let reservation = try await protection.reservation(for: setup) {
            try await protection.release(reservation.fence)
        }
        try setupStore.remove(setup, in: directory)
    }

    func sharedSetups() async throws -> [SharedConnectionSetup] {
        try await protection?.reservations() ?? []
    }

    func releaseSharedSetup(_ setup: SharedConnectionSetup) async throws {
        try begin(.save, blocked: false)
        defer { endOperation() }
        try await protection?.release(setup.fence)
    }

    func save(
        _ command: SetupCommand, key: String?, directory: URL, blocked: Bool,
        readLatest: () throws -> Configuration, commit: (Configuration, ConnectionFence?) throws -> Void
    ) async throws {
        try begin(.save, blocked: blocked)
        defer { endOperation() }
        let setup = ConnectionSetupCoordinator(
            store: setupStore, client: client, checks: checks, protection: protection,
            available: { self.connected && !self.closed },
            accountChanged: { account in
                self.accountRevision += 1
                self.checks.clearLogoutWarning(accountID: account)
            })
        try await setup.save(command, key: key, directory: directory, readLatest: readLatest, commit: commit)
    }
}
