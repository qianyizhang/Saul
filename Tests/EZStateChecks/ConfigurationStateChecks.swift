import EZCheckSupport
import EZCore
import Foundation

@MainActor func configurationStateChecks() -> [CheckCase] {
    [
        CheckCase("state: corrupt configuration blocks sending and preserves original bytes") { directory in
            let configURL = directory.appendingPathComponent("configuration.json")
            let bytes = Data("{broken".utf8)
            try bytes.write(to: configURL)
            let model = AppModel(historyDirectory: directory, offline: true)
            defer { model.shutdown() }
            try expect(model.configurationError != nil && !model.canSend, "Corruption silently reset")
            let revision = model.draftRevision
            try expectThrows(EZError.self, matching: { $0.message == model.configurationError }) {
                try model.prepareSelectedText("synthetic selection")
            }
            try expect(
                model.inputValues.isEmpty && model.draftRevision == revision && !model.launcherPending,
                "Rejected selection changed the workspace")
            try expectThrows(
                EZError.self, matching: { $0.message.contains("Configuration cannot be changed") }
            ) {
                try model.saveConfiguration(
                    Configuration.starters(model: "fixture", effort: "low", fast: false))
            }
            try expect(try Data(contentsOf: configURL) == bytes, "Corrupt file overwritten")
        },
        stateCase("configuration write failure leaves in-memory state intact") { f in
            let url = f.directory.appendingPathComponent("configuration.json")
            try FileManager.default.removeItem(at: url)
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
            try expectThrows(EZError.self, matching: { $0.message.contains("Cannot replace configuration") })
            {
                try f.model.saveConfiguration(Configuration())
            }
            try expect(
                f.model.configuration == f.configuration, "Failed save changed in-memory configuration")
        },
    ]
}
