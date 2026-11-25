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
        var signIn: @MainActor (String, String?, Bool) async throws -> String? = { _, _, _ in
            throw EZError("Sign-in is unavailable.")
        }
        var confirmAppName: @MainActor (String, String) async throws -> Void = { _, _ in
            throw EZError("App name confirmation is unavailable.")
        }
        var saveKey: @MainActor (ConnectionDefinition, String) async throws -> Void = { _, _ in
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
    private(set) var pendingSetup: ConnectionSetup?
    private(set) var setupRepairChoice: SetupRepairChoice?
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
        let account = try await client.signIn(account, suggestedAppName, consent)
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
}

extension ConnectionSession {
    func loadSetup(in directory: URL) throws {
        let url = setupURL(in: directory)
        guard FileManager.default.fileExists(atPath: url.path) else {
            setSetup(nil)
            return
        }
        let setup = try JSONDecoder().decode(ConnectionSetup.self, from: Data(contentsOf: url))
        try ConnectionDefinition.validate([setup.definition])
        setSetup(setup)
    }

    private func setupURL(in directory: URL) -> URL {
        directory.appendingPathComponent("connection-setup.json")
    }

    private func setSetup(_ setup: ConnectionSetup?) {
        guard pendingSetup != setup else { return }
        if setup?.id != pendingSetup?.id { setupRepairChoice = nil }
        pendingSetup = setup
        onChange?()
    }

    private func remember(_ setup: ConnectionSetup, in directory: URL) throws {
        try AtomicFile.write(JSONEncoder().encode(setup), to: setupURL(in: directory))
        setSetup(setup)
    }

    private func requireSetup(
        _ id: UUID, phase: ConnectionSetup.Phase, in directory: URL
    ) throws -> ConnectionSetup {
        try loadSetup(in: directory)
        guard let pendingSetup, pendingSetup.id == id, pendingSetup.phase == phase else {
            throw EZError("This setup has changed or finished. Reopen Connections to review it.")
        }
        return pendingSetup
    }

    func discardSetup(_ id: UUID, phase: ConnectionSetup.Phase, in directory: URL) throws {
        _ = try requireSetup(id, phase: phase, in: directory)
        try FileManager.default.removeItem(at: setupURL(in: directory))
        setSetup(nil)
    }

    func save(
        _ command: SetupCommand, key: String?, directory: URL, blocked: Bool,
        readLatest: () throws -> Configuration, commit: (Configuration) throws -> Void
    ) async throws {
        try begin(.save, blocked: blocked)
        defer { endOperation() }

        var setup: ConnectionSetup
        let repair: SetupRepairChoice?
        let starting: Bool
        switch command {
        case .start(let definition, let previous, let confirmedName):
            try loadSetup(in: directory)
            guard pendingSetup == nil else {
                throw EZError("Finish or discard the previous connection setup first.")
            }
            setup = ConnectionSetup(
                id: UUID(), phase: .credential, definition: definition, previous: previous,
                confirmedName: confirmedName)
            starting = true
            repair = nil
        case .resume(let id, let phase):
            setup = try requireSetup(id, phase: phase, in: directory)
            starting = false
            repair = nil
        case .repair(let id, let choice):
            setup = try requireSetup(id, phase: .settings, in: directory)
            guard setupRepairChoice == choice else {
                throw EZError("Check the saved credential before repairing this setup.")
            }
            starting = false
            repair = choice
        }

        try Task.checkCancellation()
        let definition = setup.definition
        _ = try setup.applying(to: readLatest(), allowApplied: setup.phase == .settings)
        if starting {
            if definition.kind == .openAIAPI && key == nil { throw EZError("Enter the API key.") }
            try remember(setup, in: directory)
        }
        if setup.phase == .credential {
            if definition.kind == .openAIAPI {
                guard let key else {
                    throw EZError("Enter the API key to submit the credential change again.")
                }
                try await client.saveKey(definition, key)
            } else if let name = setup.confirmedName, let account = definition.accountId {
                try await client.confirmAppName(account, name)
            }
            _ = try requireSetup(setup.id, phase: setup.phase, in: directory)
            setup.phase = .settings
            try remember(setup, in: directory)
            checks.invalidate(definition.key)
        } else if let repair {
            try await repairSetupCredential(
                setup, choice: repair, key: key, directory: directory, readLatest: readLatest)
        }

        try Task.checkCancellation()
        guard connected, !closed else { throw EZError("Reopen Connections to finish setup.") }
        let neededRepair = try await setupCredentialRepair(definition)
        try Task.checkCancellation()
        guard connected, !closed else { throw EZError("Reopen Connections to finish setup.") }
        _ = try requireSetup(setup.id, phase: setup.phase, in: directory)
        guard neededRepair == nil else {
            setupRepairChoice = neededRepair
            onChange?()
            throw EZError(
                "The saved credential is unavailable. Repair it for this connection or discard setup.")
        }
        setupRepairChoice = nil
        let baseline = try readLatest()
        let updated = try setup.applying(to: baseline, allowApplied: true)
        do {
            if updated.connections != baseline.connections { try commit(updated) }
        } catch {
            throw EZError(
                "Credential setup finished. Review saved settings to finish this connection. \(error.localizedDescription)"
            )
        }
        try discardSetup(setup.id, phase: setup.phase, in: directory)
        await checks.refresh(definition, intent: .setup)
    }

    private func setupCredentialRepair(_ definition: ConnectionDefinition) async throws -> SetupRepairChoice?
    {
        if definition.kind == .openAIAPI {
            let status = try await client.keyStatus(definition)
            guard status.endpoint == definition.endpoint else {
                throw EZError("The helper did not confirm credential status for this endpoint.")
            }
            return status.connected ? nil : .replaceKey
        }
        let profile = try await setupProfile(definition)
        guard profile?.signedIn == true else { return .signIn }
        return profile?.planEnabled == true ? nil : .enablePlan
    }

    private func setupProfile(_ definition: ConnectionDefinition) async throws -> SaulAccount? {
        guard let account = definition.accountId else { throw EZError("This connection has no account.") }
        return try await client.accounts().first { $0.id == account }
    }

    private func repairSetupCredential(
        _ setup: ConnectionSetup, choice: SetupRepairChoice, key: String?,
        directory: URL, readLatest: () throws -> Configuration
    ) async throws {
        let definition = setup.definition
        let currentChoice = try await setupCredentialRepair(definition)
        try authorizeRepair(setup, directory: directory, readLatest: readLatest)
        guard currentChoice == choice else {
            setupRepairChoice = currentChoice
            onChange?()
            throw EZError("Credential status changed. Review the available setup action.")
        }
        switch choice {
        case .replaceKey:
            guard let key else { throw EZError("Enter the API key for this endpoint.") }
            try await client.saveKey(definition, key)
        case .signIn, .enablePlan:
            guard let account = definition.accountId else { throw EZError("This connection has no account.") }
            let result = try await client.signIn(account, nil, choice == .enablePlan)
            guard result == account else { throw EZError("The helper did not confirm the saved account.") }
            accountRevision += 1
            checks.clearLogoutWarning(accountID: account)
        }
        checks.invalidate(definition.key)
    }

    private func authorizeRepair(
        _ setup: ConnectionSetup, directory: URL, readLatest: () throws -> Configuration
    ) throws {
        try Task.checkCancellation()
        guard connected, !closed else { throw EZError("Reopen Connections to repair setup.") }
        _ = try requireSetup(setup.id, phase: setup.phase, in: directory)
        _ = try setup.applying(to: readLatest(), allowApplied: true)
    }
}
