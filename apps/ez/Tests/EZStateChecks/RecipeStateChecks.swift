import EZCheckSupport
import EZCore
import Foundation

@MainActor func recipeStateChecks() -> [CheckCase] {
    [
        stateCase("preset override preserves draft during unrelated configuration edit") { f in
            f.model.chooseAction(f.single.id)
            f.model.query = "word"
            f.model.choosePreset(f.alternate.id)
            try expect(f.model.currentPreset == f.alternate && f.model.query == "word", "Override lost input")
            var edited = f.configuration
            let index = edited.actions.firstIndex { $0.legacyMode == .spelling }!
            edited.actions[index].name = "Proofread"
            try f.model.saveConfiguration(edited)
            try expect(
                f.model.currentPreset == f.alternate && f.model.query == "word",
                "Configuration edit reset override/draft")
        },
        stateCase("new lookup clears override and uses action default") { f in
            f.model.chooseAction(f.single.id)
            f.model.query = "word"
            f.model.choosePreset(f.alternate.id)
            f.model.newQuery()
            let original = f.configuration.presets.first { $0.id == f.single.presetID }
            try expect(
                f.model.overridePresetID == nil && f.model.currentPreset == original,
                "Override persisted into new lookup")
            try expect(f.model.inputValues.isEmpty, "New lookup retained draft inputs")
        },
        stateCase("multi-field launcher fills first field and waits for completion") { f in
            f.model.chooseAction(f.multi.id)
            try expect(
                f.model.currentPreset == f.alternate
                    && f.model.inputFields == ["fuzzy term", "fuzzy context"], "Action defaults/fields wrong")
            let submits = try f.model.prepareLauncher("ellicitate")
            try expect(
                !submits && f.model.inputValues == ["fuzzy term": "ellicitate"],
                "Launcher sent incomplete action")
            f.model.inputValues["fuzzy context"] = "draw out"
            let snapshot = try f.multi.prepare(
                values: f.model.inputValues, preset: f.alternate, models: f.model.models,
                provider: .chatGPTPlan)
            try expect(snapshot.inputValues == f.model.inputValues, "Completed launcher inputs lost")
        },
        stateCase("busy guards preserve action and reject configuration saves") { f in
            f.model.chooseAction(f.multi.id)
            f.model.busy = true
            f.model.chooseAction(f.single.id)
            try expect(f.model.currentAction?.id == f.multi.id, "Busy action changed")
            try expectThrows(
                EZError.self, matching: { $0.message.contains("Configuration cannot be changed") }
            ) {
                try f.model.saveConfiguration(Configuration())
            }
            try expect(f.model.configuration == f.configuration, "Rejected save changed configuration")
        },
        stateCase("deleting configuration clears selected action without restoring starters") { f in
            try f.model.saveConfiguration(Configuration())
            try expect(f.model.currentAction == nil, "Removed action stayed active")
            f.model.newQuery()
            try expect(
                f.model.currentAction == nil && f.model.overridePresetID == nil,
                "New lookup resurrected removed action")
        },
        stateCase("history reuse restores removed action preset and inputs") { f in
            let snapshot = try f.savedAnswer()
            try f.model.saveConfiguration(Configuration())
            f.model.reuse(snapshot)
            try expect(
                f.model.currentAction == snapshot.actionSnapshot && f.model.currentPreset == f.alternate,
                "Removed action/preset could not be reused")
            try expect(f.model.inputValues == snapshot.inputValues, "Historical inputs lost")
            f.model.newQuery()
            try expect(
                f.model.currentAction == nil && f.model.overridePresetID == nil,
                "New lookup resurrected removed configuration")
        },
        stateCase("configuration edit preserves history replay until new lookup") { f in
            let snapshot = try f.savedAnswer()
            f.model.reuse(snapshot)
            var edited = f.configuration
            let index = edited.actions.firstIndex { $0.id == f.multi.id }!
            edited.actions[index].template = "Rewrite {{text}}"
            try f.model.saveConfiguration(edited)
            try expect(
                f.model.currentAction == snapshot.actionSnapshot && f.model.currentPreset == f.alternate
                    && f.model.inputValues == snapshot.inputValues,
                "Editing replaced historical action/preset/inputs")
            f.model.newQuery()
            try expect(
                f.model.currentAction?.id == f.configuration.actions.first?.id,
                "New lookup did not select a remaining action")
        },
        stateCase("history selection keeps an independent draft until explicit Reuse") { f in
            let answer = try f.savedAnswer()
            try f.history.append(answer)
            f.model.entries = [answer]
            f.model.selection = answer.id
            try expect(!f.model.hasRetainedDraft, "History selection was mistaken for a draft")

            f.model.query = "Unrelated draft"
            f.model.showsMainComposer = true
            f.model.showsMainComposer = false
            try expect(
                f.model.hasRetainedDraft && f.model.query == "Unrelated draft", "Edit/Hide lost the draft")
            try expectEqual(f.model.selection, answer.id, "Edit/Hide replaced the viewed answer")

            for status in ["pending", "unsaved"] {
                var unavailable = answer
                unavailable.status = status
                f.model.reuse(unavailable)
                try expectEqual(f.model.query, "Unrelated draft", "Reuse accepted an unavailable request")
            }
            var foreign = answer
            foreign.sourceID = "saul-fixture"
            f.model.reuse(foreign)
            try expectEqual(f.model.query, "Unrelated draft", "Reuse replaced the draft with a Saul request")

            f.model.reuse(answer)
            try expectEqual(
                f.model.inputValues, answer.inputValues!, "Reuse did not restore the saved inputs")
            try expectEqual(f.model.currentPreset, answer.presetSnapshot, "Reuse lost the saved preset")
            try expect(
                f.model.selection == nil && !f.model.busy, "Reuse did not open the draft without sending")
            try expectEqual(try f.history.load().count, 1, "Reuse wrote another history record")
        },
        stateCase("preset choices surface unavailable models without substituting a route") { f in
            f.model.chooseAction(f.single.id)
            let selected = f.model.currentPreset
            try expect(f.model.lookupPresetChoiceIssue(f.alternate) == nil, "A valid override was disabled")
            var retired = f.alternate
            retired.id = UUID()
            retired.name = "Retired model"
            retired.model = "retired-fixture-model"
            var configuration = f.configuration
            configuration.presets.append(retired)
            try f.model.saveConfiguration(configuration)
            try expect(f.model.lookupPresetChoiceIssue(retired) != nil, "A removed model was available")
            var incompatible = f.alternate
            incompatible.capability = .speak
            try expect(
                f.model.lookupPresetChoiceIssue(incompatible) != nil,
                "A Speak preview was available for Write")
            f.model.chooseLookupPreset(retired.id)
            try expectEqual(f.model.currentPreset, selected, "A removed model replaced the selected route")
            f.model.chooseLookupPreset(f.alternate.id)
            try expectEqual(f.model.currentPreset, f.alternate, "A supported preset could not be selected")
        },
        stateCase("thinking light follows only the selected pending lookup while busy") { f in
            let entry = try f.selectLookup()
            f.model.responseActivity = .thinking
            try expect(f.model.selectedResponseActivity == nil, "Idle history showed thinking")
            f.model.busy = true
            try expect(f.model.selectedResponseActivity == .thinking, "Active reasoning was hidden")
            f.model.responseActivity = .responding
            try expect(
                f.model.selectedResponseActivity?.showsThinkingLight == false,
                "Responding kept thinking light")
            f.model.entries[0].status = "completed"
            try expect(f.model.selectedResponseActivity == nil, "Completed history showed activity")
            f.model.entries[0].status = "pending"
            f.model.selection = UUID()
            try expect(f.model.selectedResponseActivity == nil, "Missing selection showed activity")
            f.model.selection = entry.id
            f.model.busy = false
            try expect(f.model.selectedResponseActivity == nil, "Stopped lookup showed activity")
        },
        stateCase("offline model refuses sending despite ready account and valid draft") { f in
            f.model.signedIn = true
            f.model.planEnabled = true
            f.model.chooseAction(f.single.id)
            f.model.query = "synthetic"
            try expect(!f.model.canSend, "Offline fixture allowed live request")
            f.model.send()
            try expect(!f.model.busy && f.model.entries.isEmpty, "Offline send started work")
        },
    ]
}
