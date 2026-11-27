import EZCore
import Foundation
import SaulNativeValues
import SaulTestSupport

@testable import EZApplication

@MainActor func shortcutStateChecks() -> [CheckCase] {
    [
        stateCase("shortcuts cycle actions in order and wrap with clean drafts") { f in
            let actions = f.model.configuration.actions
            f.model.lookup.chooseAction(actions[0].id)
            f.model.lookup.query = "draft"
            f.model.lookup.chooseLookupPreset(f.alternate.id)
            f.model.lookup.performLookupCommand(.previousRecipe)
            try expectEqual(f.model.lookup.currentAction?.id, actions.last?.id, "Shortcut contract mismatch")
            try expect(
                f.model.lookup.inputValues.isEmpty && f.model.lookup.overridePresetID == nil,
                "Cycle retained draft or override")
            f.model.lookup.performLookupCommand(.nextRecipe)
            try expectEqual(f.model.lookup.currentAction?.id, actions[0].id, "Shortcut contract mismatch")
            f.model.lookup.performLookupCommand(.nextRecipe)
            try expectEqual(f.model.lookup.currentAction?.id, actions[1].id, "Shortcut contract mismatch")
            f.model.lookup.performLookupCommand(.recipe1)
            try expectEqual(f.model.lookup.currentAction?.id, actions[0].id, "Shortcut contract mismatch")
            f.model.lookup.query = "preserve when already selected"
            f.model.lookup.performLookupCommand(.recipe1)
            try expectEqual(
                f.model.lookup.query, "preserve when already selected", "Shortcut contract mismatch")
            f.model.lookup.performLookupCommand(.lastRecipe)
            try expectEqual(f.model.lookup.currentAction?.id, actions.last?.id, "Shortcut contract mismatch")
        },
        stateCase("shortcuts respect absent actions") { f in
            try expect(!f.model.lookup.commandEnabled(.recipe8), "Missing action was enabled")
            try f.model.saveConfiguration(Configuration())
            for command in [LookupCommand.nextRecipe, .previousRecipe, .recipe1, .lastRecipe] {
                f.model.lookup.performLookupCommand(command)
                try expect(
                    !f.model.lookup.commandEnabled(command), "Empty configuration enabled a lookup action")
            }
            try expect(f.model.lookup.currentAction == nil, "Navigation resurrected a action")
        },
        stateCase("shortcuts leave history replay and reset through the shared actions") { f in
            f.model.lookup.reuse(try f.savedAnswer())
            f.model.lookup.performLookupCommand(.nextRecipe)
            try expectEqual(
                f.model.lookup.currentAction?.id, f.configuration.actions.first?.id,
                "Shortcut contract mismatch")
            try expect(f.model.lookup.replayEntry == nil, "Action command kept history replay")
            f.model.lookup.query = "new draft"
            f.model.lookup.performLookupCommand(.newLookup)
            try expect(
                f.model.lookup.inputValues.isEmpty && f.model.lookup.selection == nil,
                "New shortcut retained draft/selection")
            try expect(!f.model.lookup.commandEnabled(.send), "Offline shortcut can send")
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
