import EZCheckSupport
import EZCore
import Foundation

@MainActor func recipeStateChecks() -> [CheckCase] {
    [
        stateCase("preset override preserves draft during unrelated configuration edit") { f in
            f.model.chooseRecipe(f.single.id)
            f.model.query = "word"
            f.model.choosePreset(f.alternate.id)
            try expect(f.model.currentPreset == f.alternate && f.model.query == "word", "Override lost input")
            var edited = f.configuration
            let index = edited.recipes.firstIndex { $0.legacyMode == .spelling }!
            edited.recipes[index].name = "Proofread"
            try f.model.saveConfiguration(edited)
            try expect(
                f.model.currentPreset == f.alternate && f.model.query == "word",
                "Configuration edit reset override/draft")
        },
        stateCase("new lookup clears override and uses recipe default") { f in
            f.model.chooseRecipe(f.single.id)
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
            f.model.chooseRecipe(f.multi.id)
            try expect(
                f.model.currentPreset == f.alternate
                    && f.model.inputFields == ["fuzzy term", "fuzzy context"], "Recipe defaults/fields wrong")
            let submits = try f.model.prepareLauncher("ellicitate")
            try expect(
                !submits && f.model.inputValues == ["fuzzy term": "ellicitate"],
                "Launcher sent incomplete recipe")
            f.model.inputValues["fuzzy context"] = "draw out"
            let snapshot = try f.multi.prepare(
                values: f.model.inputValues, preset: f.alternate, models: f.model.models)
            try expect(snapshot.inputValues == f.model.inputValues, "Completed launcher inputs lost")
        },
        stateCase("busy guards preserve recipe and reject configuration saves") { f in
            f.model.chooseRecipe(f.multi.id)
            f.model.busy = true
            f.model.chooseRecipe(f.single.id)
            try expect(f.model.currentRecipe?.id == f.multi.id, "Busy recipe changed")
            try expectThrows(
                EZError.self, matching: { $0.message.contains("Configuration cannot be changed") }
            ) {
                try f.model.saveConfiguration(Configuration())
            }
            try expect(f.model.configuration == f.configuration, "Rejected save changed configuration")
        },
        stateCase("deleting configuration clears selected recipe without restoring starters") { f in
            try f.model.saveConfiguration(Configuration())
            try expect(f.model.currentRecipe == nil, "Removed recipe stayed active")
            f.model.newQuery()
            try expect(
                f.model.currentRecipe == nil && f.model.overridePresetID == nil,
                "New lookup resurrected removed recipe")
        },
        stateCase("history reuse restores removed recipe preset and inputs") { f in
            let snapshot = try f.snapshot()
            try f.model.saveConfiguration(Configuration())
            f.model.reuse(snapshot)
            try expect(
                f.model.currentRecipe == snapshot.recipeSnapshot && f.model.currentPreset == f.alternate,
                "Removed recipe/preset could not be reused")
            try expect(f.model.inputValues == snapshot.inputValues, "Historical inputs lost")
            f.model.newQuery()
            try expect(
                f.model.currentRecipe == nil && f.model.overridePresetID == nil,
                "New lookup resurrected removed configuration")
        },
        stateCase("configuration edit preserves history replay until new lookup") { f in
            let snapshot = try f.snapshot()
            f.model.reuse(snapshot)
            var edited = f.configuration
            let index = edited.recipes.firstIndex { $0.id == f.multi.id }!
            edited.recipes[index].template = "Rewrite {{text}}"
            try f.model.saveConfiguration(edited)
            try expect(
                f.model.currentRecipe == snapshot.recipeSnapshot && f.model.currentPreset == f.alternate
                    && f.model.inputValues == snapshot.inputValues,
                "Editing replaced historical recipe/preset/inputs")
            f.model.newQuery()
            try expect(
                f.model.currentRecipe?.id == f.configuration.recipes.first?.id,
                "New lookup did not select a remaining recipe")
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
            f.model.chooseRecipe(f.single.id)
            f.model.query = "synthetic"
            try expect(!f.model.canSend, "Offline fixture allowed live request")
            f.model.send()
            try expect(!f.model.busy && f.model.entries.isEmpty, "Offline send started work")
        },
    ]
}
