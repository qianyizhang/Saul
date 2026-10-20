import EZCheckSupport
import EZCore
import Foundation

@MainActor func historyStateChecks() -> [CheckCase] {
    [
        stateCase("busy deletion preserves visible lookup and saved bytes") { f in
            let entry = try f.selectLookup()
            let bytes = try Data(contentsOf: f.history.url)
            f.model.busy = true
            f.model.deleteLookup(entry.id)
            try expect(
                f.model.entries == [entry] && f.model.selection == entry.id, "Busy deletion changed state")
            try expect(try Data(contentsOf: f.history.url) == bytes, "Busy deletion changed history bytes")
        },
        stateCase("pending launcher prevents lookup deletion") { f in
            let entry = try f.selectLookup()
            let bytes = try Data(contentsOf: f.history.url)
            f.model.launcherPending = true
            f.model.deleteLookup(entry.id)
            try expect(
                f.model.entries == [entry] && f.model.selection == entry.id,
                "Pending launcher deletion changed state")
            try expect(try Data(contentsOf: f.history.url) == bytes, "Pending launcher allowed deletion")
        },
        stateCase("deletion persists clears selection and preserves composer draft") { f in
            let entry = try f.selectLookup()
            let draft = f.model.inputValues
            f.model.deleteLookup(entry.id)
            try expect(
                f.model.entries.isEmpty && f.model.selection == nil,
                "Successful deletion left lookup selected")
            try expect(f.model.inputValues == draft, "Deletion discarded draft")
            try expect(try f.history.load().entries.isEmpty, "Deletion did not persist")
        },
        stateCase("failed deletion keeps lookup selection and draft and displays error") { f in
            let entry = try f.selectLookup()
            let draft = f.model.inputValues
            try FileManager.default.removeItem(at: f.history.url)
            try FileManager.default.createDirectory(at: f.history.url, withIntermediateDirectories: true)
            f.model.deleteLookup(entry.id)
            try expect(
                f.model.entries == [entry] && f.model.selection == entry.id,
                "Failed deletion removed visible lookup")
            try expect(
                f.model.inputValues == draft && f.model.error != nil,
                "Failed deletion hid error or discarded draft")
        },
    ]
}
