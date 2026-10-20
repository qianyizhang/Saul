import EZCheckSupport
import EZCore
import Foundation

@MainActor func shortcutStateChecks() -> [CheckCase] {
    [
        stateCase("shortcuts cycle recipes in order and wrap with clean drafts") { f in
            let recipes = f.model.configuration.recipes
            f.model.chooseRecipe(recipes[0].id)
            f.model.query = "draft"
            f.model.choosePreset(f.alternate.id)
            f.model.performLookupCommand(.previousRecipe)
            try expectEqual(f.model.currentRecipe?.id, recipes.last?.id, "Shortcut contract mismatch")
            try expect(
                f.model.inputValues.isEmpty && f.model.overridePresetID == nil,
                "Cycle retained draft or override")
            f.model.performLookupCommand(.nextRecipe)
            try expectEqual(f.model.currentRecipe?.id, recipes[0].id, "Shortcut contract mismatch")
            f.model.performLookupCommand(.nextRecipe)
            try expectEqual(f.model.currentRecipe?.id, recipes[1].id, "Shortcut contract mismatch")
            f.model.performLookupCommand(.recipe1)
            try expectEqual(f.model.currentRecipe?.id, recipes[0].id, "Shortcut contract mismatch")
            f.model.query = "preserve when already selected"
            f.model.performLookupCommand(.recipe1)
            try expectEqual(f.model.query, "preserve when already selected", "Shortcut contract mismatch")
            f.model.performLookupCommand(.lastRecipe)
            try expectEqual(f.model.currentRecipe?.id, recipes.last?.id, "Shortcut contract mismatch")
        },
        stateCase("shortcuts respect busy launcher and absent recipe guards") { f in
            f.model.query = "draft"
            let id = f.model.selectedRecipeID
            for pending in [false, true] {
                f.model.busy = !pending
                f.model.launcherPending = pending
                for command in [LookupCommand.newLookup, .nextRecipe, .previousRecipe, .recipe2, .lastRecipe]
                {
                    try expect(!f.model.commandEnabled(command), "Busy command was enabled")
                    f.model.performLookupCommand(command)
                }
                try expectEqual(f.model.selectedRecipeID, id, "Shortcut contract mismatch")
                try expectEqual(f.model.query, "draft", "Shortcut contract mismatch")
            }
            f.model.busy = false
            f.model.launcherPending = false
            try expect(!f.model.commandEnabled(.recipe8), "Missing recipe was enabled")
            try f.model.saveConfiguration(Configuration())
            for command in [LookupCommand.nextRecipe, .previousRecipe, .recipe1, .lastRecipe] {
                f.model.performLookupCommand(command)
                try expect(!f.model.commandEnabled(command), "Empty configuration enabled recipe action")
            }
            try expect(f.model.currentRecipe == nil, "Navigation resurrected a recipe")
        },
        stateCase("shortcuts leave history replay and reset through the shared actions") { f in
            f.model.reuse(try f.snapshot())
            f.model.performLookupCommand(.nextRecipe)
            try expectEqual(
                f.model.currentRecipe?.id, f.configuration.recipes.first?.id, "Shortcut contract mismatch")
            try expect(f.model.replayEntry == nil, "Recipe command kept history replay")
            f.model.query = "new draft"
            f.model.performLookupCommand(.newLookup)
            try expect(
                f.model.inputValues.isEmpty && f.model.selection == nil,
                "New shortcut retained draft/selection")
            try expect(!f.model.commandEnabled(.send), "Offline shortcut can send")
        },
        stateCase("shortcut saves publish only after persistence succeeds") { f in
            try f.model.saveShortcut(.init(key: "t"), for: .newLookup)
            let saved = f.model.shortcuts
            try expectEqual(
                try LookupShortcutsStore(directory: f.directory).load(), saved, "Shortcut contract mismatch")
            try expectThrows(EZError.self) { try f.model.saveShortcut(.init(key: "t"), for: .stop) }
            try expectEqual(f.model.shortcuts, saved, "Shortcut contract mismatch")
            let url = LookupShortcutsStore(directory: f.directory).url
            try FileManager.default.removeItem(at: url)
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false)
            try expectThrows(EZError.self) { try f.model.saveShortcut(.init(key: "y"), for: .newLookup) }
            try expectEqual(f.model.shortcuts, saved, "Shortcut contract mismatch")
            try FileManager.default.removeItem(at: url)
            try f.model.restoreShortcuts()
            try expectEqual(f.model.shortcuts, LookupShortcuts(), "Shortcut contract mismatch")
        },
    ]
}
