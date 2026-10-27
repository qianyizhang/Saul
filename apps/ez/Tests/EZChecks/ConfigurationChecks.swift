import EZCheckSupport
import Foundation

@testable import EZCore

@MainActor func configurationChecks() -> [CheckCase] {
    [
        CheckCase("configuration: shared presets migrate once and reject stale edits") { directory in
            let shared = SharedPresetsStore(url: directory.appendingPathComponent("settings.json"))
            try Data("{\"appearance\":{\"theme\":\"dark\"}}".utf8).write(to: shared.url)
            let local = ConfigurationStore(directory: directory.appendingPathComponent("ez"))
            let config = Configuration.starters(model: "fixture", effort: "low", fast: false)
            try local.save(config)
            let ez = ConfigurationStore(directory: directory.appendingPathComponent("ez"), shared: shared)
            var loaded = try ez.load()!
            try expectEqual(loaded.presets, config.presets, "Migration changed preset identity")
            let oldRevision = loaded.sharedPresetRevision!
            var changed = loaded.presets
            changed[0].name = "Edited in Saul"
            let saved = try shared.save(changed, revision: oldRevision)
            loaded.presets[0].effort = "high"
            try expectThrows(EZError.self) { try ez.save(loaded) }
            try expectEqual(try ez.load()!.presets[0].name, "Edited in Saul", "Other app edit was lost")
            _ = try shared.save([], revision: saved.revision)
            try expect(try ez.load()!.presets.isEmpty, "Deleted shared presets were reimported")
            var repaired = try ez.load()!
            repaired.presets = [ModelPreset(name: "Replacement", model: "fixture", effort: "", fast: false)]
            try ez.save(repaired)
            try expectEqual(
                try ez.load()!.presets[0].name, "Replacement", "Missing recipe references blocked recovery")
            let document =
                try JSONSerialization.jsonObject(with: Data(contentsOf: shared.url)) as? [String: Any]
            try expectEqual(
                (document?["appearance"] as? [String: String])?["theme"], "dark",
                "Other settings were overwritten")
        },
        CheckCase("configuration: configuration round trip, empty collections, and reference validation") {
            directory in
            let f = RecipeFixture()
            let preset = f.preset
            let recipe = f.recipe

            let store = ConfigurationStore(directory: directory.appendingPathComponent("config"))
            try expect(try store.load() == nil, "Missing config should be distinct from empty")
            var config = Configuration(presets: [preset], recipes: [recipe])
            try store.save(config)
            try expect(try store.load() == config, "Configuration did not round trip")
            let attributes = try FileManager.default.attributesOfItem(atPath: store.url.path)
            try expect(
                (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600,
                "Configuration is not owner-only"
            )
            config.presets = []
            try expectThrows(EZError.self) { try store.save(config) }
            config = Configuration()
            try store.save(config)
            try expect(try store.load() == Configuration(), "Removed starters must not reappear")
            let duplicate = ModelPreset(name: " LIT ", model: "fixture", effort: "low", fast: false)
            try expectThrows(EZError.self) { try Configuration(presets: [preset, duplicate]).validate() }
        },
        CheckCase("configuration: configuration corruption and failed saves preserve previous bytes") {
            directory in
            let f = RecipeFixture()
            let preset = f.preset
            let recipe = f.recipe

            let store = ConfigurationStore(directory: directory.appendingPathComponent("config-failure"))
            let config = Configuration(presets: [preset], recipes: [recipe])
            try store.save(config)
            let original = try Data(contentsOf: store.url)
            var invalid = config
            invalid.recipes[0].template = "{{unfinished"
            try expectThrows(EZError.self) { try store.save(invalid) }
            try expect(try Data(contentsOf: store.url) == original, "Rejected save overwrote configuration")
            let broken = Data("{broken".utf8)
            try broken.write(to: store.url)
            try expectThrows(DecodingError.self) { _ = try store.load() }
            try expect(try Data(contentsOf: store.url) == broken, "Loading corruption rewrote bytes")
            let blockedDirectory = directory.appendingPathComponent("config-blocked")
            try Data("file".utf8).write(to: blockedDirectory)
            try expectThrows(NSError.self, matching: isFileError) {
                try ConfigurationStore(directory: blockedDirectory).save(config)
            }
        },
    ]
}
