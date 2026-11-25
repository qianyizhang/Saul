import EZCore
import Foundation
import SaulCredentialClient
import SaulNativeValues
import SaulTestSupport

@testable import EZApplication

@MainActor func connectionSetupStateChecks() -> [CheckCase] {
    [
        CheckCase("connection setup: restart finishes settings once and preserves independent edits") {
            directory in
            for acknowledgedWriteWasLost in [false, true] {
                let scenario = directory.appendingPathComponent(
                    acknowledgedWriteWasLost ? "lost-ack" : "failed-write")
                let fixture = try ConnectionSetupFixture(directory: scenario)
                let connection = fixture.connection

                let first = fixture.session()
                try await expectAsyncThrows(EZError.self) {
                    try await first.save(
                        .start(connection, previous: nil, confirmedName: nil), key: fixture.secret,
                        directory: scenario, blocked: false, readLatest: fixture.latest,
                        commit: { updated in
                            if acknowledgedWriteWasLost { try fixture.store.save(updated) }
                            throw EZError("Synthetic settings failure")
                        })
                }
                first.close()
                try expectEqual(fixture.keyWrites, 1, "First attempt did not write the credential once")
                let receipt = try Data(contentsOf: fixture.receipt)
                try expect(
                    !String(decoding: receipt, as: UTF8.self).contains(fixture.secret),
                    "Recovery file stored the credential")

                var independentlyEdited = try fixture.latest()
                independentlyEdited.presets[0].name = "Independent preset edit"
                independentlyEdited = try fixture.store.save(independentlyEdited)
                let resumed = fixture.session()
                try resumed.loadSetup(in: scenario)
                try expectEqual(
                    resumed.pendingSetup?.phase, .settings, "Restart lost the completed credential stage")
                guard let pending = resumed.pendingSetup else { throw CheckFailure("Missing pending setup") }
                let expectedCommitCount = acknowledgedWriteWasLost ? 0 : 1
                var commits = 0
                try await resumed.save(
                    .resume(pending.id, phase: .settings), key: nil,
                    directory: scenario, blocked: false, readLatest: fixture.latest,
                    commit: { updated in
                        commits += 1
                        try fixture.store.save(updated)
                    })
                let latest = try fixture.latest()
                try expectEqual(commits, expectedCommitCount, "Settings commit was lost or repeated")
                try expectEqual(
                    latest.presets, independentlyEdited.presets, "Recovery overwrote independent settings")
                try expect(
                    latest.connections.contains(connection), "Recovery did not finish the target settings")
                try expectEqual(fixture.keyWrites, 1, "Recovery rewrote the credential")
                try expect(resumed.pendingSetup == nil, "Finished setup remained pending")
                try expect(
                    !FileManager.default.fileExists(atPath: fixture.receipt.path), "Finished receipt remained"
                )
            }
        },
        CheckCase("connection setup: stale target blocks continuation until explicit discard") { directory in
            let fixture = try ConnectionSetupFixture(directory: directory)
            let connection = fixture.connection
            let first = fixture.session()
            try await expectAsyncThrows(EZError.self) {
                try await first.save(
                    .start(connection, previous: nil, confirmedName: nil), key: fixture.secret,
                    directory: directory, blocked: false, readLatest: fixture.latest,
                    commit: { _ in throw EZError("Synthetic settings write failure") })
            }
            first.close()

            var other = try fixture.latest()
            var differentTarget = connection
            differentTarget.name = "Independent connection edit"
            other.connections.append(differentTarget)
            _ = try fixture.store.save(other)

            let resumed = fixture.session()
            try resumed.loadSetup(in: directory)
            guard let pending = resumed.pendingSetup else { throw CheckFailure("Missing pending setup") }
            var attemptedCommit = false
            let error = try await expectAsyncThrows(EZError.self) {
                try await resumed.save(
                    .resume(pending.id, phase: .settings), key: nil,
                    directory: directory, blocked: false, readLatest: fixture.latest,
                    commit: { _ in attemptedCommit = true })
            }
            try expect(
                error.localizedDescription.contains("changed"), "Stale target did not report a conflict")
            try expect(!attemptedCommit && fixture.keyWrites == 1, "Conflict repeated a side effect")
            try expectEqual(
                resumed.pendingSetup?.definition, connection, "Conflict forgot the pending target")
            try expectEqual(
                try fixture.latest().connections, other.connections, "Conflict replaced newer settings")

            try resumed.discardSetup(pending.id, phase: .settings, in: directory)
            let reopened = fixture.session()
            try reopened.loadSetup(in: directory)
            try expect(reopened.pendingSetup == nil, "Discard did not clear durable recovery")
            try expectEqual(fixture.keyWrites, 1, "Discard changed the credential")
            try expectEqual(try fixture.latest().connections, other.connections, "Discard changed settings")
        },
        CheckCase("connection setup: stale form blocks credential writes after rename or deletion") {
            directory in
            let fixture = try ConnectionSetupFixture(directory: directory)
            let session = fixture.session()
            let original = fixture.connection
            for rename in [false, true] {
                var config = try fixture.latest()
                config.connections.removeAll { $0.key == original.key }
                if rename {
                    var renamed = original
                    renamed.name = "Renamed elsewhere"
                    config.connections.append(renamed)
                }
                try fixture.store.save(config)
                try await expectAsyncThrows(EZError.self) {
                    try await fixture.save(
                        .start(original, previous: original, confirmedName: nil), on: session)
                }
            }
            var config = try fixture.latest()
            config.connections.removeAll { $0.key == original.key }
            config.connections.append(original)
            try fixture.store.save(config)
            try await expectAsyncThrows(EZError.self) {
                try await fixture.save(.start(original, previous: nil, confirmedName: nil), on: session)
            }
            try expectEqual(fixture.keyWrites, 0, "A stale form changed a credential")
            try expect(session.pendingSetup == nil, "Stale form created a pending setup")
        },
        CheckCase("connection setup: discarded replaced and completed IDs cannot act") { directory in
            let fixture = try ConnectionSetupFixture(directory: directory)
            let session = fixture.session()
            let old = try await fixture.interruptSetup(on: session)
            try session.discardSetup(old, phase: .settings, in: directory)
            try await expectAsyncThrows(EZError.self) {
                try await fixture.save(.resume(old, phase: .settings), on: session)
            }
            let replacement = try await fixture.interruptSetup(on: session)
            try expect(old != replacement, "Replacement reused the previous setup ID")
            try await expectAsyncThrows(EZError.self) {
                try await fixture.save(.resume(old, phase: .settings), on: session)
            }
            try expectThrows(EZError.self) { try session.discardSetup(old, phase: .settings, in: directory) }
            try expectEqual(session.pendingSetup?.id, replacement, "Stale discard changed the active setup")
            try await expectAsyncThrows(EZError.self) {
                try await fixture.save(.resume(replacement, phase: .credential), on: session)
            }
            try await fixture.save(.resume(replacement, phase: .settings), on: session)
            try await expectAsyncThrows(EZError.self) {
                try await expectAsyncThrows(EZError.self) {
                    try await fixture.save(.resume(replacement, phase: .credential), on: session)
                }
                try await fixture.save(.resume(replacement, phase: .settings), on: session)
            }
            try expectEqual(fixture.keyWrites, 2, "Stale continuation repeated a credential effect")
            try expectEqual(fixture.statusChecks, 3, "Stale continuation read credential status")
        },
        CheckCase("connection setup: acked custom key requires exact endpoint and explicit repair") {
            directory in
            let fixture = try ConnectionSetupFixture(directory: directory)
            let first = fixture.session()
            let id = try await fixture.interruptSetup(on: first)
            let fresh = fixture.session()
            fixture.statusEndpoint = "https://different.example/v1"
            fixture.credentialPresent = false
            try await expectAsyncThrows(EZError.self) {
                try await fixture.save(.resume(id, phase: .settings), on: fresh)
            }
            try expect(fresh.setupRepairChoice == nil, "Mismatched endpoint was reported as missing")
            try expectEqual(fixture.keyWrites, 1, "Credential status replayed the key change")
            try expect(
                !(try fixture.latest().connections.contains(fixture.connection)),
                "Setup committed without a key")
            fixture.statusEndpoint = nil
            try await expectAsyncThrows(EZError.self) {
                try await fixture.save(.resume(id, phase: .settings), on: fresh)
            }
            try expectEqual(
                fresh.setupRepairChoice, .replaceKey, "Missing key did not offer repair of this setup")
            try expectEqual(fixture.keyWrites, 1, "Finish setup rewrote the acknowledged credential")
            try await fixture.save(.repair(id, choice: .replaceKey), on: fresh)
            try expectEqual(fixture.keyWrites, 2, "Repair did not submit exactly one explicit key change")
            try expect(
                try fixture.latest().connections.contains(fixture.connection), "Repair did not finish setup")
        },
        CheckCase("connection setup: plan repair binds the displayed intent to exact account auth") {
            directory in
            for expected in [ConnectionSession.SetupRepairChoice.signIn, .enablePlan] {
                let scenario = directory.appendingPathComponent(expected == .signIn ? "sign-in" : "enable")
                let fixture = try ConnectionSetupFixture(directory: scenario)
                let definition = ConnectionDefinition(
                    key: "fixture-plan", name: "Plan fixture", kind: .chatGPTPlan, accountId: "exact-account")
                let decoder = JSONDecoder()
                let exact = try decoder.decode(
                    SaulAccount.self,
                    from: Data(
                        #"{"id":"exact-account","label":"Exact","signedIn":true,"planEnabled":true}"#.utf8))
                let noGrant = try decoder.decode(
                    SaulAccount.self,
                    from: Data(
                        #"{"id":"exact-account","label":"Exact","signedIn":true,"planEnabled":false}"#.utf8))
                let other = try decoder.decode(
                    SaulAccount.self,
                    from: Data(
                        #"{"id":"other-account","label":"Other","signedIn":true,"planEnabled":true}"#.utf8))
                var profiles = [exact, other]
                var signedIn: [String] = []
                var consentRequests: [Bool] = []
                var confirmations = 0
                let session = ConnectionSession(
                    checks: FixtureConnections().checks(),
                    client: .init(
                        accounts: { profiles },
                        signIn: { account, _, consent in
                            signedIn.append(account)
                            consentRequests.append(consent)
                            profiles = [exact, other]
                            return account
                        },
                        confirmAppName: { _, _ in confirmations += 1 }))
                try await expectAsyncThrows(EZError.self) {
                    try await session.save(
                        .start(definition, previous: nil, confirmedName: "Fixture app"),
                        key: nil, directory: scenario, blocked: false, readLatest: fixture.latest,
                        commit: { _ in throw EZError("Synthetic settings write failure") })
                }
                guard let setup = session.pendingSetup else { throw CheckFailure("Missing setup") }
                let stale: ConnectionSession.SetupRepairChoice = expected == .signIn ? .enablePlan : .signIn
                profiles = stale == .signIn ? [other] : [noGrant, other]
                try await expectAsyncThrows(EZError.self) {
                    try await fixture.save(.resume(setup.id, phase: .settings), on: session)
                }
                try expectEqual(signedIn, [], "Resume signed in automatically")
                try expectEqual(confirmations, 1, "Resume repeated app-name confirmation")
                try expectEqual(
                    session.setupRepairChoice, stale, "Initial repair choice ignored account status")
                profiles = expected == .signIn ? [other] : [noGrant, other]
                try await expectAsyncThrows(EZError.self) {
                    try await fixture.save(.repair(setup.id, choice: stale), on: session)
                }
                try expectEqual(signedIn, [], "Stale repair command authorized the changed action")
                try expectEqual(
                    session.setupRepairChoice, expected, "Fresh account status did not update choice")
                try expectEqual(
                    session.setupRepairChoice?.title,
                    expected == .signIn ? "Sign in again" : "Enable plan use",
                    "Displayed label did not match authorization intent")
                try await fixture.save(.repair(setup.id, choice: expected), on: session)
                try expectEqual(signedIn, ["exact-account"], "Repair selected another account")
                try expectEqual(
                    consentRequests, [expected == .enablePlan], "Repair requested the wrong consent")
                try expectEqual(confirmations, 1, "Repair repeated app-name confirmation")
                try expect(
                    try fixture.latest().connections.contains(definition), "Repair did not finish plan setup")
            }
        },
    ]
}

@MainActor private final class ConnectionSetupFixture {
    let directory: URL
    let store: ConfigurationStore
    let receipt: URL
    let secret = "sk-synthetic-continuation-check"
    let connection = ConnectionDefinition(
        key: "fixture-recovery", name: "Recovery fixture", kind: .openAIAPI,
        baseUrl: "https://fixture.example/v1")
    private(set) var keyWrites = 0
    private(set) var statusChecks = 0
    var credentialPresent = false
    var statusEndpoint: String?

    init(directory: URL) throws {
        self.directory = directory
        store = ConfigurationStore(directory: directory)
        receipt = directory.appendingPathComponent("connection-setup.json")
        _ = try store.save(Configuration.starters(model: "fixture", effort: "low", fast: false))
    }

    func latest() throws -> Configuration {
        guard let saved = try store.load() else { throw CheckFailure("Missing fixture settings") }
        return saved
    }

    func save(_ command: ConnectionSession.SetupCommand, on session: ConnectionSession) async throws {
        try await session.save(
            command, key: secret, directory: directory, blocked: false,
            readLatest: latest, commit: { try self.store.save($0) })
    }

    func interruptSetup(on session: ConnectionSession) async throws -> UUID {
        try await expectAsyncThrows(EZError.self) {
            try await session.save(
                .start(connection, previous: nil, confirmedName: nil), key: secret, directory: directory,
                blocked: false, readLatest: latest,
                commit: { _ in throw EZError("Synthetic settings write failure") })
        }
        guard let pending = session.pendingSetup, pending.phase == .settings else {
            throw CheckFailure("Settings failure did not leave the acknowledged stage")
        }
        return pending.id
    }

    func session() -> ConnectionSession {
        ConnectionSession(
            checks: FixtureConnections().checks(),
            client: .init(
                saveKey: { [self] _, _ in
                    keyWrites += 1
                    credentialPresent = true
                },
                keyStatus: { [self] definition in
                    statusChecks += 1
                    return ConnectionStatus(
                        connected: credentialPresent, endpoint: statusEndpoint ?? definition.endpoint)
                }))
    }
}
