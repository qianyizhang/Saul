import EZCore
import Foundation
import SaulNativeValues
import SaulTestSupport

@testable import EZApplication

@MainActor func recipeStateChecks() -> [CheckCase] {
    [
        stateCase("preset override preserves draft during unrelated configuration edit") { f in
            f.model.lookup.chooseAction(f.single.id)
            f.model.lookup.query = "word"
            f.model.lookup.chooseLookupPreset(f.alternate.id)
            try expect(
                f.model.lookup.currentPreset == f.alternate && f.model.lookup.query == "word",
                "Override lost input")
            var edited = f.configuration
            let index = edited.actions.firstIndex { $0.legacyMode == .spelling }!
            edited.actions[index].name = "Proofread"
            try f.model.saveConfiguration(edited)
            try expect(
                f.model.lookup.currentPreset == f.alternate && f.model.lookup.query == "word",
                "Configuration edit reset override/draft")
        },
        stateCase("new lookup clears override and uses action default") { f in
            f.model.lookup.chooseAction(f.single.id)
            f.model.lookup.query = "word"
            f.model.lookup.chooseLookupPreset(f.alternate.id)
            f.model.lookup.newQuery()
            let original = f.configuration.presets.first { $0.id == f.single.presetID }
            try expect(
                f.model.lookup.overridePresetID == nil && f.model.lookup.currentPreset == original,
                "Override persisted into new lookup")
            try expect(f.model.lookup.inputValues.isEmpty, "New lookup retained draft inputs")
        },
        stateCase("multi-field launcher fills first field and waits for completion") { f in
            f.model.lookup.chooseAction(f.multi.id)
            try expect(
                f.model.lookup.currentPreset == f.alternate
                    && f.model.lookup.inputFields == ["fuzzy term", "fuzzy context"],
                "Action defaults/fields wrong")
            try f.model.lookup.submitLauncher("ellicitate", after: Task {})
            try expect(
                !f.model.lookup.launcherPending && f.model.lookup.inputValues == ["fuzzy term": "ellicitate"],
                "Launcher sent incomplete action")
            f.model.lookup.setInput("draw out", for: "fuzzy context")
            let snapshot = try f.multi.prepare(
                values: f.model.lookup.inputValues, preset: f.alternate,
                models: f.model.modelsForPreset(f.alternate),
                provider: .chatGPTPlan)
            try expect(snapshot.inputValues == f.model.lookup.inputValues, "Completed launcher inputs lost")
        },
        stateCase("deleting configuration clears selected action without restoring starters") { f in
            try f.model.saveConfiguration(Configuration())
            try expect(f.model.lookup.currentAction == nil, "Removed action stayed active")
            f.model.lookup.newQuery()
            try expect(
                f.model.lookup.currentAction == nil && f.model.lookup.overridePresetID == nil,
                "New lookup resurrected removed action")
        },
        stateCase("history reuse restores removed action preset and inputs") { f in
            let snapshot = try f.savedAnswer()
            try f.model.saveConfiguration(Configuration())
            f.model.lookup.reuse(snapshot)
            try expect(
                f.model.lookup.currentAction == snapshot.actionSnapshot
                    && f.model.lookup.currentPreset == f.alternate,
                "Removed action/preset could not be reused")
            try expect(f.model.lookup.inputValues == snapshot.inputValues, "Historical inputs lost")
            f.model.lookup.newQuery()
            try expect(
                f.model.lookup.currentAction == nil && f.model.lookup.overridePresetID == nil,
                "New lookup resurrected removed configuration")
        },
        stateCase("configuration edit preserves history replay until new lookup") { f in
            let snapshot = try f.savedAnswer()
            f.model.lookup.reuse(snapshot)
            var edited = f.configuration
            let index = edited.actions.firstIndex { $0.id == f.multi.id }!
            edited.actions[index].template = "Rewrite {{text}}"
            try f.model.saveConfiguration(edited)
            try expect(
                f.model.lookup.currentAction == snapshot.actionSnapshot
                    && f.model.lookup.currentPreset == f.alternate
                    && f.model.lookup.inputValues == snapshot.inputValues,
                "Editing replaced historical action/preset/inputs")
            f.model.lookup.newQuery()
            try expect(
                f.model.lookup.currentAction?.id == f.configuration.actions.first?.id,
                "New lookup did not select a remaining action")
        },
        stateCase("history selection keeps an independent draft until explicit Reuse") { f in
            let answer = try f.savedAnswer()
            try f.history.append(answer)
            f.model.showHistory([answer])
            f.model.lookup.selection = answer.id
            try expect(!f.model.lookup.hasRetainedDraft, "History selection was mistaken for a draft")

            f.model.lookup.query = "Unrelated draft"
            f.model.lookup.showsMainComposer = true
            f.model.lookup.showsMainComposer = false
            try expect(
                f.model.lookup.hasRetainedDraft && f.model.lookup.query == "Unrelated draft",
                "Edit/Hide lost the draft")
            try expectEqual(f.model.lookup.selection, answer.id, "Edit/Hide replaced the viewed answer")

            for status in ["pending", "unsaved"] {
                var unavailable = answer
                unavailable.status = status
                f.model.lookup.reuse(unavailable)
                try expectEqual(
                    f.model.lookup.query, "Unrelated draft", "Reuse accepted an unavailable request")
            }
            var foreign = answer
            foreign.sourceID = "saul-fixture"
            f.model.lookup.reuse(foreign)
            try expectEqual(
                f.model.lookup.query, "Unrelated draft", "Reuse replaced the draft with a Saul request")

            f.model.lookup.reuse(answer)
            try expectEqual(
                f.model.lookup.inputValues, answer.inputValues!, "Reuse did not restore the saved inputs")
            try expectEqual(
                f.model.lookup.currentPreset, answer.presetSnapshot, "Reuse lost the saved preset")
            try expect(
                f.model.lookup.selection == nil && !f.model.lookup.busy,
                "Reuse did not open the draft without sending")
            try expectEqual(try f.history.load().count, 1, "Reuse wrote another history record")
        },
        stateCase("preset choices surface unavailable models without substituting a route") { f in
            f.model.lookup.chooseAction(f.single.id)
            let selected = f.model.lookup.currentPreset
            try expect(
                f.model.lookup.lookupPresetChoiceIssue(f.alternate) == nil, "A valid override was disabled")
            var retired = f.alternate
            retired.id = UUID()
            retired.name = "Retired model"
            retired.model = "retired-fixture-model"
            var configuration = f.configuration
            configuration.presets.append(retired)
            try f.model.saveConfiguration(configuration)
            try expect(
                f.model.lookup.lookupPresetChoiceIssue(retired) != nil, "A removed model was available")
            var incompatible = f.alternate
            incompatible.capability = .speak
            try expect(
                f.model.lookup.lookupPresetChoiceIssue(incompatible) != nil,
                "A Speak preview was available for Write")
            f.model.lookup.chooseLookupPreset(retired.id)
            try expectEqual(
                f.model.lookup.currentPreset, selected, "A removed model replaced the selected route")
            f.model.lookup.chooseLookupPreset(f.alternate.id)
            try expectEqual(
                f.model.lookup.currentPreset, f.alternate, "A supported preset could not be selected")
        },
        CheckCase("state: a preset stays selectable while its catalog is loading") { directory in
            var config = Configuration.starters(model: "fixture", effort: "low", fast: false)
            config.bindFixtureAccount()
            try ConfigurationStore(directory: directory).save(config)
            let requested = CheckSignal()
            let release = CheckSignal()
            let fixtures = FixtureConnections()
            let checks = ConnectionChecks(
                status: { fixtures.status($0) },
                catalog: { connection, _ in
                    await requested.signal()
                    try await release.wait()
                    return fixtures.catalog(connection)
                })
            let model = fixtureModel(directory: directory, connectionChecks: checks)
            defer {
                model.shutdown()
                Task { await release.signal() }
            }
            let action = config.actions[0]
            model.lookup.chooseAction(action.id)
            guard let preset = model.lookup.currentPreset, let connection = model.lookup.currentConnection
            else {
                throw CheckFailure("Fixture preset is not bound")
            }
            let refresh = Task { await model.refreshConnection(connection, intent: .check) }
            try await requested.wait()
            try expect(model.lookup.lookupPresetChoiceIssue(preset) == nil, "Loading preset was disabled")
            try expect(
                model.presetIssue(preset)?.contains("Loading models") == true,
                "Loading preset was marked ready")
            try expect(model.modelsForPreset(preset).isEmpty, "Missing catalog synthesized a model")
            await release.signal()
            await refresh.value
            try expect(model.presetIssue(preset) == nil, "Loaded preset remained unavailable")
            try expectEqual(
                model.modelsForPreset(preset).map(\.id), ["fixture"], "Ready catalog model changed")
        },
        stateCase("offline model refuses sending despite ready account and valid draft") { f in
            f.model.lookup.chooseAction(f.single.id)
            f.model.lookup.query = "synthetic"
            try expect(!f.model.lookup.canSend, "Offline fixture allowed live request")
            f.model.lookup.send()
            try expect(!f.model.lookup.busy && f.model.entries.isEmpty, "Offline send started work")
        },
    ]
}
