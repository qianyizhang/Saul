import EZCore
import Foundation
import SaulNativeValues
import SaulTestSupport

@testable import EZApplication

@MainActor func quickLookupStateChecks() -> [CheckCase] {
    [
        stateCase("fresh invocation clears previous context and keeps history and action") { f in
            let entry = try f.selectLookup()
            f.model.chooseLookupPreset(f.alternate.id)
            let action = f.model.selectedActionID
            f.model.newQuery()
            f.model.fillQuickLookupSelection(nil)
            try expect(f.model.inputValues.isEmpty && f.model.selection == nil, "Old context survived")
            try expect(
                f.model.selectedActionID == action && f.model.overridePresetID == nil, "Action reset failed")
            try expect(f.model.entries.map(\.id) == [entry.id], "History was lost")
        },
        stateCase("selection autofill preserves Unicode fills one field and never sends") { f in
            f.model.chooseAction(f.multi.id)
            let text = "  café 中文 🧪\nsecond line  "
            f.model.fillQuickLookupSelection(text)
            try expect(f.model.inputValues == ["fuzzy term": text], "Selection or remaining fields changed")
            try expect(
                !f.model.busy && !f.model.launcherPending && f.model.entries.isEmpty, "Autofill submitted")
            try expect(try f.history.load().isEmpty, "Autofill persisted a request")
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
        stateCase("late autofill preserves a preset-only lookup draft") { f in
            f.model.chooseAction(f.single.id)
            f.model.chooseLookupPreset(f.alternate.id)
            try expect(f.model.query.isEmpty && f.model.hasRetainedDraft, "Missing preset-only draft")
            f.model.fillQuickLookupSelection("Captured before the preset changed")
            try expectEqual(f.model.query, "", "Late capture filled the edited draft")
            try expectEqual(f.model.currentPreset, f.alternate, "Late capture lost the preset override")
        },
        stateCase("late autofill preserves typing and active work") { f in
            for blocked in ["typing", "settings", "answer"] {
                f.model.showSettings = blocked == "settings"
                f.model.selection = blocked == "answer" ? UUID() : nil
                f.model.query = blocked == "typing" ? "new typing" : ""
                let before = f.model.inputValues
                f.model.fillQuickLookupSelection("late result")
                try expect(f.model.inputValues == before, "Late capture replaced \(blocked)")
            }
        },
    ]
}
