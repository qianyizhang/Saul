import EZCheckSupport
import EZCore
import Foundation

@MainActor func quickLookupStateChecks() -> [CheckCase] {
    [
        stateCase("fresh invocation clears previous context and keeps history and recipe") { f in
            let entry = try f.selectLookup()
            f.model.choosePreset(f.alternate.id)
            let recipe = f.model.selectedRecipeID
            f.model.newQuery()
            f.model.fillQuickLookupSelection(nil)
            try expect(f.model.inputValues.isEmpty && f.model.selection == nil, "Old context survived")
            try expect(
                f.model.selectedRecipeID == recipe && f.model.overridePresetID == nil, "Recipe reset failed")
            try expect(f.model.entries.map(\.id) == [entry.id], "History was lost")
        },
        stateCase("selection autofill preserves Unicode fills one field and never sends") { f in
            f.model.chooseRecipe(f.multi.id)
            let text = "  café 中文 🧪\nsecond line  "
            f.model.fillQuickLookupSelection(text)
            try expect(f.model.inputValues == ["fuzzy term": text], "Selection or remaining fields changed")
            try expect(
                !f.model.busy && !f.model.launcherPending && f.model.entries.isEmpty, "Autofill submitted")
            try expect(try f.history.load().entries.isEmpty, "Autofill persisted a request")
        },
        stateCase("selection autofill leaves empty input for unavailable invalid or oversized selections") {
            f in
            for text in [nil, "", " \n\t", String(repeating: "é", count: 8193)] {
                f.model.newQuery()
                f.model.fillQuickLookupSelection(text)
                try expect(f.model.inputValues.isEmpty, "Invalid selection filled the draft")
            }
            f.model.fillQuickLookupSelection(String(repeating: "é", count: 8192))
            try expect(f.model.query.utf8.count == 16_384, "Boundary selection was rejected")
        },
        stateCase("late autofill preserves typing and active work") { f in
            for blocked in ["typing", "busy", "launcher", "signing", "settings", "answer"] {
                f.model.busy = blocked == "busy"
                f.model.launcherPending = blocked == "launcher"
                f.model.signingIn = blocked == "signing"
                f.model.showSettings = blocked == "settings"
                f.model.selection = blocked == "answer" ? UUID() : nil
                f.model.inputValues = blocked == "typing" ? ["text": "new typing"] : [:]
                let before = f.model.inputValues
                f.model.fillQuickLookupSelection("late result")
                try expect(f.model.inputValues == before, "Late capture replaced \(blocked)")
            }
        },
    ]
}
