import EZCheckSupport
import EZCore
import Foundation

@MainActor func selectedTextChecks() -> [CheckCase] {
    [
        stateCase("selected text preserves Unicode and waits for Send in a single-field recipe") { f in
            f.model.chooseRecipe(f.single.id)
            f.model.signedIn = true
            f.model.planEnabled = true
            let text = "  café 中文 🧪\nsecond line + % &  "
            try f.model.prepareSelectedText(text)
            try expect(f.model.query == text, "Selection was trimmed or decoded")
            try expect(
                !f.model.busy && !f.model.launcherPending && f.model.entries.isEmpty,
                "Selected text started or queued a request")
            try expect(try f.history.load().entries.isEmpty, "Draft was saved as a request")
        },
        stateCase("selected text fills only the first field of a multi-input recipe") { f in
            f.model.chooseRecipe(f.multi.id)
            try f.model.prepareSelectedText("elicit")
            try expect(f.model.inputValues == ["fuzzy term": "elicit"], "Other recipe inputs were filled")
            try expect(
                f.model.currentPreset == f.alternate && !f.model.busy,
                "Recipe default changed or request sent")
        },
        stateCase("selected text refuses active work and preserves the entire draft") { f in
            f.model.chooseRecipe(f.multi.id)
            f.model.inputValues = ["fuzzy term": "existing", "fuzzy context": "context"]
            f.model.choosePreset(f.alternate.id)
            let revision = f.model.draftRevision
            for blocked in ["draft", "busy", "launcher", "signing", "settings"] {
                f.model.busy = blocked == "busy"
                f.model.launcherPending = blocked == "launcher"
                f.model.signingIn = blocked == "signing"
                f.model.showSettings = blocked == "settings"
                let expected = blocked == "draft" ? "draft" : blocked == "settings" ? "Settings" : "already"
                try expectThrows(EZError.self, matching: { $0.message.contains(expected) }) {
                    try f.model.prepareSelectedText("replacement")
                }
                try expect(
                    f.model.inputValues == ["fuzzy term": "existing", "fuzzy context": "context"]
                        && f.model.currentPreset == f.alternate && f.model.draftRevision == revision,
                    "Rejected selection changed the draft")
            }
        },
        stateCase("selected text rejects empty and oversized input before clearing a saved selection") { f in
            let entry = try f.selectLookup()
            f.model.inputValues = [:]
            let revision = f.model.draftRevision
            for text in ["", " \n\t", String(repeating: "é", count: 8193)] {
                try expectThrows(EZError.self) { try f.model.prepareSelectedText(text) }
                try expect(
                    f.model.selection == entry.id && f.model.draftRevision == revision,
                    "Invalid selection cleared the workspace")
            }
            try f.model.prepareSelectedText(String(repeating: "é", count: 8192))
            try expect(
                f.model.query.utf8.count == 16_384 && f.model.selection == nil,
                "Boundary selection rejected or old answer stayed selected")
        },
        stateCase("selected text without recipes preserves the workspace and reports configuration") { f in
            try f.model.saveConfiguration(Configuration())
            let revision = f.model.draftRevision
            try expectThrows(EZError.self, matching: { $0.message.contains("Configuration") }) {
                try f.model.prepareSelectedText("word")
            }
            try expect(
                f.model.inputValues.isEmpty && f.model.draftRevision == revision,
                "Missing recipe changed the workspace")
        },
    ]
}
