import EZCore
import Foundation
import SaulCredentialClient
import SaulNativeValues

@MainActor struct ConnectionSetupCoordinator {
    let store: ConnectionSetupStore
    let client: ConnectionSession.Client
    let checks: ConnectionChecks
    let protection: ConnectionProtection?
    let available: () -> Bool
    let accountChanged: (String) -> Void

    func save(
        _ command: ConnectionSession.SetupCommand, key: String?, directory: URL,
        readLatest: () throws -> Configuration, commit: (Configuration, ConnectionFence?) throws -> Void
    ) async throws {
        var setup: ConnectionSetup
        let repair: ConnectionSession.SetupRepairChoice?
        switch command {
        case .start(let definition, let previous, let confirmedName):
            try store.load(in: directory)
            guard !store.records.contains(where: { $0.definition.key == definition.key }) else {
                throw EZError("Finish or discard the previous setup for this connection first.")
            }
            setup = .init(
                id: UUID(), phase: .credential, definition: definition, previous: previous,
                confirmedName: confirmedName)
            repair = nil
        case .resume(let id, let phase):
            setup = try store.require(id, phase: phase, in: directory)
            repair = nil
        case .repair(let id, let choice):
            setup = try store.require(id, phase: .settings, in: directory)
            guard store.repairs[id] == choice else {
                throw EZError("Check the saved credential before repairing this setup.")
            }
            repair = choice
        }

        try requireAvailable()
        let definition = setup.definition
        let baseline = try readLatest()
        let reviewed = try setup.applying(to: baseline, allowApplied: setup.phase == .settings)
        if setup.phase == .credential && definition.kind == .openAIAPI && key == nil {
            throw EZError("Enter the API key to submit the credential change again.")
        }
        if setup.phase == .settings && repair == nil && reviewed.connections == baseline.connections {
            try await verifyCredential(setup)
            // The writer may have committed even if its acknowledgement was lost.
            if let protection, let reservation = try await protection.reservation(for: setup) {
                try await protection.release(reservation.fence)
            }
            try store.remove(setup, in: directory)
            await checks.refresh(definition, intent: .setup)
            return
        }

        let resume = setup.protectionVersion == 1
        let prior = store.records.first { $0.id == setup.id }
        if let protection {
            try await protection.requireSupport()
            setup.protectionVersion = 1
        }
        try store.remember(setup, in: directory)
        let held: (ConnectionSetupHold, ConnectionFence)?
        do {
            held = try await protection?.hold(setup, resume: resume)
        } catch let error as CredentialStorageError
            where !resume && (error.reason == "connection_busy" || error.reason == "connection_reserved")
        {
            if let prior {
                try store.remember(prior, in: directory)
            } else {
                try store.remove(setup, in: directory)
            }
            throw error
        }
        do {
            try requireAvailable()
            try held?.0.check()
            _ = try setup.applying(to: readLatest(), allowApplied: setup.phase == .settings)
            if setup.phase == .credential {
                if definition.kind == .openAIAPI, let key {
                    try await client.saveKey(definition, key, held?.1.token)
                } else if let name = setup.confirmedName, let account = definition.accountId {
                    try await client.confirmAppName(account, name, held?.1.token)
                }
                _ = try store.require(setup.id, phase: setup.phase, in: directory)
                setup.phase = .settings
                try store.remember(setup, in: directory)
                checks.invalidate(definition.key)
            } else if let repair {
                try await repairCredential(
                    setup, choice: repair, key: key, fence: held?.1, directory: directory,
                    readLatest: readLatest)
            }
            try await verifyCredential(setup)
            try requireAvailable()
            try held?.0.check()
            _ = try store.require(setup.id, phase: setup.phase, in: directory)
            let latest = try readLatest()
            let updated = try setup.applying(to: latest, allowApplied: true)
            do {
                if updated.connections != latest.connections { try commit(updated, held?.1) }
            } catch {
                throw EZError(
                    "Credential setup finished. Review saved settings to finish this connection. \(error.localizedDescription)"
                )
            }
        } catch {
            await held?.0.close()
            throw error
        }
        await held?.0.close()
        if let fence = held?.1 { try await protection?.release(fence) }
        try store.remove(setup, in: directory)
        await checks.refresh(definition, intent: .setup)
    }

    private func requireAvailable() throws {
        try Task.checkCancellation()
        guard available() else { throw EZError("Reopen Connections to finish setup.") }
    }

    private func verifyCredential(_ setup: ConnectionSetup) async throws {
        try requireAvailable()
        let repair = try await credentialRepair(setup.definition)
        try requireAvailable()
        store.setRepair(repair, for: setup.id)
        guard repair == nil else {
            throw EZError(
                "The saved credential is unavailable. Repair it for this connection or discard setup.")
        }
    }

    private func credentialRepair(_ definition: ConnectionDefinition) async throws
        -> ConnectionSession.SetupRepairChoice?
    {
        if definition.kind == .openAIAPI {
            let status = try await client.keyStatus(definition)
            guard status.endpoint == definition.endpoint else {
                throw EZError("The helper did not confirm credential status for this endpoint.")
            }
            return status.connected ? nil : .replaceKey
        }
        guard let account = definition.accountId else { throw EZError("This connection has no account.") }
        let profile = try await client.accounts().first { $0.id == account }
        guard profile?.signedIn == true else { return .signIn }
        return profile?.planEnabled == true ? nil : .enablePlan
    }

    private func repairCredential(
        _ setup: ConnectionSetup, choice: ConnectionSession.SetupRepairChoice, key: String?,
        fence: ConnectionFence?, directory: URL, readLatest: () throws -> Configuration
    ) async throws {
        let definition = setup.definition
        let currentChoice = try await credentialRepair(definition)
        try requireAvailable()
        _ = try store.require(setup.id, phase: setup.phase, in: directory)
        _ = try setup.applying(to: readLatest(), allowApplied: true)
        guard currentChoice == choice else {
            store.setRepair(currentChoice, for: setup.id)
            throw EZError("Credential status changed. Review the available setup action.")
        }
        switch choice {
        case .replaceKey:
            guard let key else { throw EZError("Enter the API key for this endpoint.") }
            try await client.saveKey(definition, key, fence?.token)
        case .signIn, .enablePlan:
            guard let account = definition.accountId else { throw EZError("This connection has no account.") }
            let result = try await client.signIn(account, nil, choice == .enablePlan, fence?.token)
            guard result == account else { throw EZError("The helper did not confirm the saved account.") }
            accountChanged(account)
        }
        checks.invalidate(definition.key)
    }
}
