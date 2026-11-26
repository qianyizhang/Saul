import EZCore
import Foundation
import SaulNativeValues
import SaulTestSupport

@testable import EZApplication

@MainActor func quickLookupStateChecks() -> [CheckCase] {
    [
        stateCase("fresh invocation clears previous context and keeps history and action") { f in
            let entry = try f.selectLookup()
            f.model.lookup.chooseLookupPreset(f.alternate.id)
            let action = f.model.lookup.selectedActionID
            f.model.lookup.newQuery()
            f.model.lookup.fillQuickLookupSelection(nil)
            try expect(
                f.model.lookup.inputValues.isEmpty && f.model.lookup.selection == nil, "Old context survived")
            try expect(
                f.model.lookup.selectedActionID == action && f.model.lookup.overridePresetID == nil,
                "Action reset failed")
            try expect(f.model.entries.map(\.id) == [entry.id], "History was lost")
        },
        stateCase("selection autofill preserves Unicode fills one field and never sends") { f in
            f.model.lookup.chooseAction(f.multi.id)
            let text = "  café 中文 🧪\nsecond line  "
            f.model.lookup.fillQuickLookupSelection(text)
            try expect(
                f.model.lookup.inputValues == ["fuzzy term": text], "Selection or remaining fields changed")
            try expect(
                !f.model.lookup.busy && !f.model.lookup.launcherPending && f.model.entries.isEmpty,
                "Autofill submitted")
            try expect(try f.history.load().isEmpty, "Autofill persisted a request")
        },
        stateCase("selection autofill leaves empty input for unavailable invalid or oversized selections") {
            f in
            for text in [nil, "", " \n\t", String(repeating: "é", count: 8193)] {
                f.model.lookup.newQuery()
                f.model.lookup.fillQuickLookupSelection(text)
                try expect(f.model.lookup.inputValues.isEmpty, "Invalid selection filled the draft")
            }
            f.model.lookup.fillQuickLookupSelection(String(repeating: "é", count: 8192))
            try expect(f.model.lookup.query.utf8.count == 16_384, "Boundary selection was rejected")
        },
        stateCase("late autofill preserves a preset-only lookup draft") { f in
            f.model.lookup.chooseAction(f.single.id)
            f.model.lookup.chooseLookupPreset(f.alternate.id)
            try expect(
                f.model.lookup.query.isEmpty && f.model.lookup.hasRetainedDraft, "Missing preset-only draft")
            f.model.lookup.fillQuickLookupSelection("Captured before the preset changed")
            try expectEqual(f.model.lookup.query, "", "Late capture filled the edited draft")
            try expectEqual(
                f.model.lookup.currentPreset, f.alternate, "Late capture lost the preset override")
        },
        stateCase("late autofill preserves typing and active work") { f in
            for blocked in ["typing", "settings", "answer"] {
                f.model.showSettings = blocked == "settings"
                f.model.lookup.selection = blocked == "answer" ? UUID() : nil
                f.model.lookup.query = blocked == "typing" ? "new typing" : ""
                let before = f.model.lookup.inputValues
                f.model.lookup.fillQuickLookupSelection("late result")
                try expect(f.model.lookup.inputValues == before, "Late capture replaced \(blocked)")
            }
        },
    ]
}
