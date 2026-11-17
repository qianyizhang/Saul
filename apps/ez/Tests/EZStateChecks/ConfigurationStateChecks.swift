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
