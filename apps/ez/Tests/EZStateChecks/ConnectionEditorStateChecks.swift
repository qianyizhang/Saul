import EZCore
import Foundation
import SaulNativeValues
import SaulTestSupport

@testable import EZApplication

@MainActor func connectionEditorStateChecks() -> [CheckCase] {
    [
        CheckCase("connection editor: closing during sign-in preserves the next draft") { directory in
            try ConfigurationStore(directory: directory).save(
                .starters(model: "fixture", effort: "", fast: false))
            let started = CheckSignal()
            var reply: CheckedContinuation<String?, Never>?
            let model = fixtureModel(
                directory: directory,
                client: .init(signIn: { _, _, _, _ in
                    await withCheckedContinuation { continuation in
                        reply = continuation
                        Task { await started.signal() }
                    }
                }))
            defer {
                reply?.resume(returning: nil)
                model.shutdown()
            }
            let editor = ConnectionEditor()
            editor.open(nil, using: model)
            try expect(editor.isOpen, "An untouched form did not count as open")
            editor.prepareRegistration()
            guard let registration = editor.draft?.registration,
                let signIn = editor.signIn(using: model, suggestedAppName: registration.name)
            else { throw CheckFailure("The registration did not start") }
            try await started.wait()
            try expect(editor.isSigningIn, "Sign-in progress was not shown")
            editor.close()
            try expect(!editor.isOpen && !editor.isSigningIn, "Closing did not retire the sign-in form")
            editor.open(nil, kind: .customEndpoint, using: model)
            editor.name = "Replacement"
            editor.key = "fixture-new-key"
            reply?.resume(returning: "late-account")
            reply = nil
            await signIn.value
            try expectEqual(editor.draft?.kind, .customEndpoint, "Late sign-in changed the form's kind")
            try expectEqual(editor.name, "Replacement", "Late sign-in replaced the new form")
            try expectEqual(editor.draft?.accountID, "", "Late sign-in selected an account in the new form")
            try expect(editor.error == nil, "Late sign-in showed an error in the new form")
            editor.close()
            try expectEqual(editor.key, "", "Closing retained the API key in the form")
        },
        CheckCase("connection editor: only the matching acknowledgement clears the draft key") { directory in
            let model = fixtureModel(directory: directory)
            defer { model.shutdown() }
            let editor = ConnectionEditor()
            editor.open(nil, kind: .openAIAPI, using: model)
            editor.key = "fixture-key"
            guard let draft = editor.draft else { throw CheckFailure("The API form did not open") }
            let definition = try draft.definition(profile: nil, defaultPlanName: "")
            let other = ConnectionSetup(
                id: UUID(), phase: .settings,
                definition: ConnectionDefinition(
                    key: "other", name: "Other", kind: .openAIAPI), previous: nil, confirmedName: nil)
            var matching = ConnectionSetup(
                id: UUID(), phase: .credential, definition: definition, previous: nil, confirmedName: nil)
            editor.setupsChanged(from: [matching], to: [matching, other])
            try expectEqual(editor.key, "fixture-key", "Another connection's acknowledgement cleared the key")
            let before = matching
            matching.phase = .settings
            editor.setupsChanged(from: [before, other], to: [matching, other])
            try expectEqual(editor.key, "", "An acknowledged key stayed in the form")
            try expect(editor.isOpen, "Acknowledgement closed the form before settings finished")
        },
        CheckCase("connection editor: a failed save selects recovery without carrying over the key") {
            directory in
            let store = ConfigurationStore(directory: directory)
            try store.save(.starters(model: "fixture", effort: "", fast: false))
            var keyWrites: [String] = []
            var available = false
            let model = fixtureModel(
                directory: directory,
                client: .init(
                    saveKey: { _, key, _ in keyWrites.append(key) },
                    keyStatus: { definition in
                        ConnectionStatus(connected: available, endpoint: definition.endpoint)
                    }))
            defer { model.shutdown() }
            let editor = ConnectionEditor()
            editor.open(nil, kind: .customEndpoint, using: model)
            editor.name = "Local fixture"
            editor.endpoint = "http://localhost:8080/v1/"
            editor.key = "fixture-key"
            await editor.save(using: model)
            guard let pending = editor.recovery(in: model.session.pendingSetups) else {
                throw CheckFailure("The editor did not expose the setup to recover")
            }
            try expectEqual(pending.phase, .settings, "Recovery lost the credential acknowledgement")
            try expectEqual(pending.definition.endpoint, "http://localhost:8080/v1", "Endpoint changed")
            try expect(!editor.isOpen && editor.error != nil, "Failure did not move the form to recovery")
            try expectEqual(editor.key, "", "The old form still held the credential")
            try expectEqual(editor.recoveryKey, "", "Recovery inherited the old credential")

            available = true
            let continuation = editor.continueSetup(pending, requiresKey: false, repair: nil, using: model)
            await continuation?.value
            try expect(model.session.pendingSetups.isEmpty, "Successful recovery left a pending setup")
            try expect(model.configuration.connections.contains(pending.definition), "Recovery did not save")
            try expectEqual(keyWrites, ["fixture-key"], "Recovery replayed the credential write")
            try expect(editor.error == nil, "Successful recovery left the failure visible")
        },
    ]
}
