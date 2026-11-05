import EZCheckSupport
import EZCore
import Foundation

@MainActor func actionContractChecks() -> [CheckCase] {
    [
        CheckCase("action contract: shared connections migrate names and reject stale or invalid saves") {
            directory in
            let fixture = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
                .appendingPathComponent("../../../../contracts/fixtures/connections.json").standardizedFileURL
            guard
                let object = try JSONSerialization.jsonObject(with: Data(contentsOf: fixture))
                    as? [String: Any],
                let invalidValues = object["invalid"] as? [[[String: Any]]]
            else { throw CheckFailure("Invalid shared provider fixture") }
            let connections = try JSONDecoder().decode(
                [ConnectionDefinition].self,
                from: JSONSerialization.data(withJSONObject: object["connections"]!))
            try ConnectionDefinition.validate(connections)
            let shared = SharedPresetsStore(url: directory.appendingPathComponent("settings.json"))
            let store = ConfigurationStore(directory: directory, shared: shared)
            try store.save(Configuration.starters(model: "fixture", effort: "", fast: false))
            var loaded = try store.load()!
            let first = try shared.read()
            _ = try shared.save(first.presets, revision: first.revision, connections: connections)
            try expectThrows(EZError.self) { try store.save(loaded) }
            loaded = try store.load()!
            try expectEqual(loaded.connections, connections, "Native did not load shared provider names")
            loaded.connections[1].name = "Renamed in EZ"
            try store.save(loaded)
            let saved = try shared.read()
            try expectEqual(saved.connections[1].name, "Renamed in EZ", "Provider edit stayed app-scoped")
            try expectEqual(saved.connections[1].key, "openai-api", "Provider rename changed its binding")
            let scope = try shared.readAppSection("configuration").value!
            try expect(scope["connections"] == nil, "Connection definitions have two persisted owners")
            let bytes = try Data(contentsOf: shared.url)
            for raw in invalidValues {
                let data = try JSONSerialization.data(withJSONObject: raw)
                if let invalid = try? JSONDecoder().decode([ConnectionDefinition].self, from: data) {
                    try expectThrows(EZError.self) {
                        _ = try shared.save(saved.presets, revision: saved.revision, connections: invalid)
                    }
                } else {
                    try expectThrows(DecodingError.self) {
                        _ = try JSONDecoder().decode([ConnectionDefinition].self, from: data)
                    }
                }
                try expectEqual(
                    try Data(contentsOf: shared.url), bytes, "Invalid connections changed saved bytes")
            }
        },
        CheckCase("action contract: image settings match the shared JSON boundary without coercion") {
            directory in
            let fixture = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
                .appendingPathComponent("../../../../contracts/fixtures/image-options.json")
                .standardizedFileURL
            guard
                let object = try JSONSerialization.jsonObject(with: Data(contentsOf: fixture))
                    as? [String: Any],
                let valid = object["valid"] as? [[String: Any]], let invalid = object["invalid"] as? [Any]
            else { throw CheckFailure("Invalid image settings fixture") }
            let store = SharedPresetsStore(url: directory.appendingPathComponent("settings.json"))
            let preset: [String: Any] = [
                "id": UUID().uuidString, "name": "Draw", "model": "gpt-image-2.5-flare", "effort": "",
                "fast": false,
            ]
            func write(_ options: Any) throws {
                var value = preset
                value["imageOptions"] = options
                try JSONSerialization.data(withJSONObject: [
                    "modelPresets": ["revision": 0, "presets": [value]]
                ]).write(to: store.url)
            }
            for options in valid {
                try write(options)
                try expect(try store.read().presets[0].imageOptions != nil, "Valid image options disappeared")
            }
            for options in invalid {
                try write(options)
                let original = try Data(contentsOf: store.url)
                // Type/schema failures decode differently from unsupported enum values.
                var value = preset
                value["imageOptions"] = options
                let data = try JSONSerialization.data(withJSONObject: value)
                if let decoded = try? JSONDecoder().decode(ModelPreset.self, from: data) {
                    try expect(decoded.imageOptions != nil, "Malformed options silently became defaults")
                    try expectThrows(EZError.self) { _ = try store.read() }
                } else {
                    try expectThrows(DecodingError.self) { _ = try store.read() }
                }
                try expectEqual(
                    try Data(contentsOf: store.url), original, "Rejected settings rewrote the original")
            }
        },
        CheckCase("action contract: Speak presets preserve voices and keep preview separate from actions") {
            directory in
            let fixture = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
                .appendingPathComponent("../../../../contracts/fixtures/speech-options.json")
                .standardizedFileURL
            guard
                let object = try JSONSerialization.jsonObject(with: Data(contentsOf: fixture))
                    as? [String: Any],
                let valid = object["valid"] as? [[String: Any]], let invalid = object["invalid"] as? [Any]
            else { throw CheckFailure("Malformed speech-options fixture") }
            let store = SharedPresetsStore(url: directory.appendingPathComponent("settings.json"))
            let id = UUID()
            for raw in valid {
                let options = try JSONDecoder().decode(
                    SpeechOptions.self, from: JSONSerialization.data(withJSONObject: raw))
                let preset = ModelPreset(
                    id: id, name: "Speak", model: "gpt-realtime-fixture", effort: "", fast: false,
                    connectionKey: "openai-api", capability: .speak, speechOptions: options)
                _ = try store.save([preset], revision: store.read().revision)
                try expectEqual(try store.read().presets[0], preset, "Speak options disappeared")
                try expect(
                    preset.availabilityError(in: [], provider: .openAIAPI)?.contains("Settings") == true,
                    "Native execution was not blocked")
                let action = Action(name: "Speak", presetID: id, template: "{{text}}", capability: .speak)
                try expectThrows(EZError.self) {
                    _ = try action.prepare(
                        values: ["text": "Hello"], preset: preset, models: [], provider: .openAIAPI)
                }
            }
            for raw in invalid {
                var preset: [String: Any] = [
                    "id": id.uuidString, "name": "Speak", "model": "gpt-realtime-fixture", "effort": "",
                    "fast": false, "connectionKey": "openai-api", "capability": "speak",
                ]
                preset["speechOptions"] = raw
                let data = try JSONSerialization.data(withJSONObject: [
                    "modelPresets": ["revision": 0, "presets": [preset]]
                ])
                try data.write(to: store.url)
                do {
                    _ = try store.read()
                    throw CheckFailure("Malformed speech options accepted")
                } catch is DecodingError {} catch is EZError {}
                try expectEqual(
                    try Data(contentsOf: store.url), data, "Rejected speech options rewrote the file")
            }
        },
        CheckCase("action contract: legacy presets migrate to gpt-plan Write without identity changes") {
            directory in
            let id = UUID()
            let legacy: [String: Any] = [
                "id": id.uuidString, "name": "Existing", "model": "fixture", "effort": "low", "fast": false,
            ]
            let preset = try JSONDecoder().decode(
                ModelPreset.self, from: JSONSerialization.data(withJSONObject: legacy))
            try expectEqual(preset.id, id, "Preset ID changed")
            try expectEqual(preset.connectionKey, "gpt-plan", "Legacy provider changed")
            try expectEqual(preset.capability, .write, "Legacy capability changed")
            let shared = SharedPresetsStore(url: directory.appendingPathComponent("settings.json"))
            let result = try shared.save([preset], revision: 0)
            try expectEqual(try shared.read().presets, result.presets, "Typed preset did not round trip")
        },
        CheckCase(
            "action contract: typed Draw preset and action survive shared settings and literal preparation"
        ) { directory in
            var config = Configuration.starters(model: "fixture", effort: "low", fast: false)
            try expect(config.addIllustration(), "Illustration was not seeded")
            for index in config.presets.indices where config.presets[index].capability == .draw {
                config.presets[index].model = "gpt-image-2.6-flare"
            }
            try expect(!config.addIllustration(), "Illustration seed duplicated")
            let action = config.actions.first { $0.capability == .draw }!
            let preset = config.presets.first { $0.id == action.presetID }!
            let store = ConfigurationStore(
                directory: directory,
                shared: SharedPresetsStore(url: directory.appendingPathComponent("settings.json")))
            try store.save(config)
            let loaded = try store.load()!
            try expectEqual(
                loaded.presets.first { $0.id == preset.id }, preset, "Draw preset options were dropped")
            let entry = try action.prepare(
                values: ["context": "{{not parsed again}} 中文"], preset: preset, models: [],
                provider: .openAIAPI)
            try expect(entry.query.contains("{{not parsed again}} 中文"), "Inputs were parsed again")
            try expectEqual(entry.capability, .draw, "Typed output lost")
            let writing = config.presets.first { $0.capability == .write }!
            try expectThrows(EZError.self) {
                _ = try action.prepare(
                    values: ["context": "Tree"], preset: writing, models: [], provider: .openAIAPI)
            }
            let launch = try config.preparingLauncherInput("Tree", recipeID: action.id)
            try expect(!launch.submit, "Launcher silently submitted a billed Draw action")
        },
        CheckCase("action contract: API Write freezes an explicit Fast tier without a plan catalog") { _ in
            let preset = ModelPreset(
                name: "API", model: "explicit-model", effort: "", fast: true,
                connectionKey: "openai-api")
            let action = Action(name: "Write", presetID: preset.id, template: "{{text}}")
            let entry = try action.prepare(
                values: ["text": "Exact input"], preset: preset, models: [], provider: .openAIAPI)
            try expectEqual(entry.requestedServiceTier, "priority", "API Fast was silently dropped")
            try expectEqual(
                ResponsesRequest.body(entry: entry)["service_tier"] as? String,
                "priority", "Explicit API tier did not reach transport")
            var config = Configuration(presets: [preset], actions: [action])
            config.connections[1].name = "My API"
            try expectEqual(config.presets[0].connectionKey, "openai-api", "Renaming changed preset binding")
            try expectEqual(config.connections[1].key, "openai-api", "Renaming changed provider identity")
        },
        CheckCase("action contract: image bytes are durable separately from JSON and delete with their entry")
        { directory in
            let store = try HistoryStore(directory: directory)
            var config = Configuration.starters(model: "fixture", effort: "", fast: false)
            config.addIllustration()
            for index in config.presets.indices where config.presets[index].capability == .draw {
                config.presets[index].model = "gpt-image-2.6-flare"
            }
            let action = config.actions.first { $0.capability == .draw }!
            let preset = config.presets.first { $0.id == action.presetID }!
            var entry = try action.prepare(
                values: ["context": "Tree"], preset: preset, models: [], provider: .openAIAPI)
            entry.imageData = fixturePNG
            entry.status = "completed"
            try store.append(entry)
            let json = try historySQL(store.url, "SELECT data FROM ez_entry") ?? ""
            try expect(
                !json.contains(fixturePNG.base64EncodedString()),
                "PNG bytes entered the JSON payload")
            let reloaded = try store.load()[0]
            try expectEqual(
                try store.image(for: reloaded), fixturePNG, "History did not restore original PNG")
            let permissions =
                try FileManager.default.attributesOfItem(atPath: store.url.path)[.posixPermissions] as? Int
            try expectEqual(permissions, 0o600, "History is not owner-only")
            try store.delete(id: entry.id)
            try expect(try store.image(for: reloaded) == nil, "Deleted entry left its image")
        },
        CheckCase("action contract: history storage rejects database symlinks") {
            directory in
            let store = try HistoryStore(directory: directory)
            var entry = HistoryEntry(
                mode: .ask, query: "Tree", model: "image", effort: "", requestedServiceTier: nil)
            entry.imageData = fixturePNG
            try store.append(entry)
            let linked = directory.appendingPathComponent("linked")
            try FileManager.default.createDirectory(at: linked, withIntermediateDirectories: true)
            try FileManager.default.createSymbolicLink(
                at: linked.appendingPathComponent("history.sqlite3"), withDestinationURL: store.url)
            try expectThrows(EZError.self) { _ = try HistoryStore(directory: linked) }
        },
    ]
}
