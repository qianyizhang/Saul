import EZCheckSupport
import EZCore
import Foundation

@MainActor func configurationStateChecks() -> [CheckCase] {
    [
        CheckCase("state: corrupt configuration blocks sending and preserves original bytes") { directory in
            let configURL = directory.appendingPathComponent("configuration.json")
            let bytes = Data("{broken".utf8)
            try bytes.write(to: configURL)
            let model = AppModel(directory: directory, offline: true)
            defer { model.shutdown() }
            try expect(model.configurationError != nil && !model.canSend, "Corruption silently reset")
            let revision = model.draftRevision
            try expectThrows(EZError.self, matching: { $0.message == model.configurationError }) {
                try model.prepareSelectedText("synthetic selection")
            }
            try expect(
                model.inputValues.isEmpty && model.draftRevision == revision && !model.launcherPending,
                "Rejected selection changed the workspace")
            try expectThrows(
                EZError.self, matching: { $0.message.contains("Configuration cannot be changed") }
            ) {
                try model.saveConfiguration(
                    Configuration.starters(model: "fixture", effort: "low", fast: false))
            }
            try expect(try Data(contentsOf: configURL) == bytes, "Corrupt file overwritten")
        },
        CheckCase("connection: disconnect and rebinding discard an older status check") { _ in
            let started = CheckSignal()
            let gate = CheckSignal()
            let original = ConnectionDefinition(
                key: "plan-fixture", name: "Plan", kind: .chatGPTPlan, accountId: "old")
            var replacement = original
            replacement.accountId = "new"
            var catalogAccounts: [String?] = []
            let checks = ConnectionChecks(
                status: { connection in
                    if connection.accountId == "old" {
                        await started.signal()
                        try await gate.wait()
                    }
                    return ConnectionStatus(connected: true, identity: connection.accountId)
                },
                catalog: { connection, _ in
                    catalogAccounts.append(connection.accountId)
                    return ConnectionCatalog(
                        models: [ConnectionModel(id: connection.accountId ?? "none")], fetchedAt: 1)
                })
            let inFlight = Task { await checks.refresh(original) }
            defer { Task { await gate.signal() } }
            try await started.wait()
            try expect(checks.checkingKeys.contains(original.key), "Checking state was not published")
            checks.reset()
            try expect(
                checks.report(original.key) == nil && checks.checkingKeys.isEmpty,
                "Disconnect retained evidence")
            await checks.refresh(replacement)
            await gate.signal()
            await inFlight.value
            try expectEqual(
                checks.report(original.key)?.status?.identity, "new", "Old status overwrote new connection")
            try expectEqual(
                checks.report(original.key)?.catalog?.models.first?.id, "new",
                "Old catalog overwrote new models")
            try expectEqual(catalogAccounts, ["new"], "Invalidated status started another catalog request")
        },
        CheckCase("connection: explicit Check supersedes a pending passive catalog") { _ in
            let started = CheckSignal()
            let gate = CheckSignal()
            let first = ConnectionDefinition(
                key: "plan-first", name: "First", kind: .chatGPTPlan, accountId: "first")
            let second = ConnectionDefinition(
                key: "plan-second", name: "Second", kind: .chatGPTPlan, accountId: "second")
            let checks = ConnectionChecks(
                status: { ConnectionStatus(connected: true, identity: $0.accountId) },
                catalog: { connection, intent in
                    if connection.key == first.key, intent == .passive {
                        await started.signal()
                        try await gate.wait()
                    }
                    return ConnectionCatalog(
                        models: [ConnectionModel(id: "\(connection.key)-\(intent.rawValue)")],
                        fetchedAt: Date().timeIntervalSince1970)
                })
            let pending = Task { await checks.refresh(first) }
            defer { pending.cancel() }
            try await started.wait()
            try expect(!checks.isCheckingExplicitly(first.key), "Passive fetch disabled Check")
            await checks.refresh(second, intent: .setup)
            await checks.refresh(first, intent: .check)
            await gate.signal()
            await pending.value
            try expectEqual(
                checks.report(first.key)?.catalog?.models.first?.id, "plan-first-check",
                "Passive result replaced or swallowed explicit Check")
            try expectEqual(
                checks.report(second.key)?.catalog?.models.first?.id, "plan-second-refresh",
                "Check changed another connection or treated setup as Check")
        },
        CheckCase("connection: logout warning survives failed and successful status refresh") { _ in
            let first = ConnectionDefinition(
                key: "plan-first", name: "First", kind: .chatGPTPlan, accountId: "first")
            let alias = ConnectionDefinition(
                key: "plan-alias", name: "Alias", kind: .chatGPTPlan, accountId: "first")
            let second = ConnectionDefinition(
                key: "plan-second", name: "Second", kind: .chatGPTPlan, accountId: "second")
            let started = CheckSignal()
            let gate = CheckSignal()
            var signedOut = false
            var failStatus = false
            let checks = ConnectionChecks(
                status: { connection in
                    if failStatus && connection.key == first.key {
                        throw EZError("Status refresh failed.")
                    }
                    let connected = connection.key != first.key || !signedOut
                    return ConnectionStatus(connected: connected, signedIn: connected)
                },
                catalog: { connection, intent in
                    if connection.key == alias.key, intent == .check {
                        await started.signal()
                        try await gate.wait()
                    }
                    return ConnectionCatalog(models: [ConnectionModel(id: "previous")])
                })
            await checks.refresh(first)
            await checks.refresh(alias)
            await checks.refresh(second)
            let pending = Task { await checks.refresh(alias, intent: .check) }
            defer { pending.cancel() }
            try await started.wait()
            let reply = Data(
                #"{"account":{"id":"first","label":"First","signedIn":false,"planEnabled":false},"warning":"Remote sign-out could not be confirmed."}"#
                    .utf8)
            let outcome = try JSONDecoder().decode(ConnectionChecks.LogoutOutcome.self, from: reply)
            signedOut = true
            try checks.didSignOut(outcome, from: first)
            await gate.signal()
            await pending.value
            try expect(checks.report(first.key)?.catalog == nil, "Logout retained the old catalog")
            try expectEqual(checks.report(alias.key)?.status?.signedIn, false, "Alias still showed signed in")
            try expect(checks.report(alias.key)?.catalog == nil, "Late Check overwrote sign-out for an alias")
            failStatus = true
            await checks.refresh(first)
            try expectEqual(checks.report(first.key)?.status?.signedIn, false, "Failed refresh hid sign-out")
            try expectEqual(checks.report(first.key)?.error, "Status refresh failed.", "Failure was hidden")
            failStatus = false
            await checks.refresh(first)
            try expectEqual(checks.report(first.key)?.status?.signedIn, false, "Sign-out was lost")
            try expectEqual(
                checks.logoutWarning(for: first), outcome.warning, "Refresh hid revocation warning")
            try expect(
                checks.logoutWarning(for: second) == nil
                    && checks.report(second.key)?.status?.connected == true,
                "Logout affected another account")
        },
        CheckCase("connection: provider default seeds only the unassigned starter") { directory in
            var config = Configuration.starters(model: "", effort: "low", fast: false)
            let saved = ModelPreset(name: "Saved", model: "first", effort: "medium", fast: true)
            config.presets.append(saved)
            try ConfigurationStore(directory: directory).save(config)
            let model = AppModel(directory: directory, offline: true)
            defer { model.shutdown() }
            model.models = [
                ConnectionModel(id: "first", efforts: ["low", "medium"]),
                ConnectionModel(id: "z-default", efforts: ["low", "medium"], isDefault: true),
            ].map(ModelOption.init(connectionModel:))
            model.initializeStarterPreset()
            try expectEqual(model.configuration.presets.first?.model, "z-default", "Default marker was lost")
            try expectEqual(model.configuration.presets.last, saved, "Saved preset was normalized")
            try expect(model.configuration.unassignedStarterID == nil, "Starter remained unassigned")
        },
        stateCase("settings keeps the edited item through failed Save and confirms discard before switching")
        { f in
            var editor = ConfigurationEditor()
            editor.open(f.model.configuration)
            let original = editor.preset!
            editor.preset?.name = "Keep this edit"
            let destination = ConfigurationEditor.Destination.preset(f.alternate)
            editor.request(destination, model: f.model)
            try expect(
                editor.needsDiscard && editor.preset?.name == "Keep this edit", "Switch lost the draft")
            editor.keepEditing()
            var config = f.model.configuration
            config.presets[0].name = "Changed elsewhere"
            try f.model.saveConfiguration(config)
            editor.savePreset(model: f.model)
            try expect(
                editor.presetIsDirty && editor.preset?.name == "Keep this edit", "Failed save cleared edits")
            try expect(editor.presetMessage?.contains("changed") == true, "Stale save was not explained")
            try expectEqual(
                f.model.configuration.presets[0].name, "Changed elsewhere",
                "Stale draft replaced saved preset")
            editor.request(destination, model: f.model)
            editor.discardAndContinue(model: f.model)
            try expectEqual(editor.preset, f.alternate, "Discard did not complete the requested switch")
            try expect(
                !editor.hasUnsavedChanges && original.id != editor.preset?.id, "Discard left stale state")
            editor.preset?.name = "New saved name"
            editor.savePreset(model: f.model)
            try expect(!editor.presetIsDirty, "Acknowledged save left the draft dirty")
            try expectEqual(
                try ConfigurationStore(directory: f.directory).load()?.presets.last?.name,
                "New saved name", "Editor did not persist the acknowledged choice")
        },
        stateCase("configuration write failure leaves in-memory state intact") { f in
            let url = f.directory.appendingPathComponent("configuration.json")
            try FileManager.default.removeItem(at: url)
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
            try expectThrows(EZError.self, matching: { $0.message.contains("Cannot replace configuration") })
            {
                try f.model.saveConfiguration(Configuration())
            }
            try expect(
                f.model.configuration == f.configuration, "Failed save changed in-memory configuration")
        },
    ]
}
