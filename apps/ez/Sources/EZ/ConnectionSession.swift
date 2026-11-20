import EZCore
import Foundation
import SaulCredentialClient
import SaulNativeValues

/// The app's connection lifecycle. Per-route status and catalog evidence stay with ConnectionChecks.
@MainActor final class ConnectionSession {
    enum Operation { case signIn, save, disconnect }

    struct Client {
        var accounts: @MainActor () async throws -> [SaulAccount] = { [] }
        var signIn: @MainActor (String, String?) async throws -> String? = { _, _ in
            throw EZError("Sign-in is unavailable.")
        }
        var saveKey: @MainActor (ConnectionDefinition, String) async throws -> Void = { _, _ in
            throw EZError("Credential storage is unavailable.")
        }
        var removeKey: @MainActor (ConnectionDefinition) async throws -> Void = { _ in
            throw EZError("Credential storage is unavailable.")
        }
        var signOut: @MainActor (String) async throws -> ConnectionChecks.LogoutOutcome = { _ in
            throw EZError("Sign-out is unavailable.")
        }
    }

    let checks: ConnectionChecks
    let client: Client
    private(set) var connected: Bool
    private(set) var connecting = false
    private(set) var operation: Operation?
    private(set) var profiles: [SaulAccount] = []
    private var accountRevision = 0
    private var closed = false
    private let setPreference: @MainActor (Bool) -> Void
    var onChange: (@MainActor () -> Void)?

    init(
        checks: ConnectionChecks, client: Client = Client(), connected: Bool = true,
        setPreference: @escaping @MainActor (Bool) -> Void = { _ in }
    ) {
        self.checks = checks
        self.client = client
        self.connected = connected
        self.setPreference = setPreference
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

    func begin(_ operation: Operation, blocked: Bool) throws {
        guard connected, !closed else { throw EZError("Connect to Saul before changing credentials.") }
        guard !blocked, !connecting, self.operation == nil else {
            throw EZError("Wait for the current operation before changing connections.")
        }
        self.operation = operation
        onChange?()
    }

    func endOperation() {
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
        _ account: String, suggestedAppName: String?, connections: [ConnectionDefinition]
    ) async throws -> String? {
        let account = try await client.signIn(account, suggestedAppName)
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

    func removeCredential(_ connection: ConnectionDefinition) async throws {
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
    }

    func close() {
        closed = true
        checks.reset()
    }
}
