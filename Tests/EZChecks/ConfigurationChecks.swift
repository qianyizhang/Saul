import Foundation

@testable import EZCore

@MainActor func configurationChecks(directory: URL, run: (String, () throws -> Void) throws -> Void) throws {
    let option = ModelOption(catalog: [
        "visibility": "list", "slug": "fixture", "display_name": "Fixture",
        "supported_reasoning_levels": [["effort": "low"], ["effort": "medium"]],
        "service_tiers": [["id": "priority", "name": "Fast"]],
    ])!
    let preset = ModelPreset(name: "lit", model: "fixture", effort: "medium", fast: true)
    let recipe = Recipe(
        name: "Lookup", presetID: preset.id,
        template: "Find {{fuzzy term}} for {{fuzzy context}}; correct {{ fuzzy term }}.")

    try run("template fields, required values, and literal insertion") {
        let template = try PromptTemplate(recipe.template)
        try expect(template.fields == ["fuzzy term", "fuzzy context"], "Field order/deduplication changed")
        let values = ["fuzzy term": "你好 {{fuzzy context}}", "fuzzy context": "a+b\ncontext"]
        try expect(
            try template.render(values)
                == "Find 你好 {{fuzzy context}} for a+b\ncontext; correct 你好 {{fuzzy context}}.",
            "Values must remain literal; no recursive substitution")
        try rejects("Missing field accepted") { _ = try template.render(["fuzzy term": "word"]) }
        try rejects("Blank field accepted") {
            _ = try template.render(["fuzzy term": "word", "fuzzy context": " \n"])
        }
        for invalid in [
            "{{}}", "{{text", "text}}", "{{a | upper}}", "{{a.b}}", "{% if x %}{{text}}{% endif %}",
            "no inputs", "{{{{text}}",
        ] {
            try rejects("Unsupported or malformed template accepted: \(invalid)") {
                _ = try PromptTemplate(invalid)
            }
        }
    }
    try run("presets refuse unavailable models, effort, and Fast without fallback") {
        try expect(preset.availabilityError(in: [option]) == nil, "Valid preset rejected")
        var changed = preset
        changed.model = "missing"
        try expect(changed.availabilityError(in: [option]) != nil, "Unavailable model accepted")
        changed = preset
        changed.effort = "ultra"
        try expect(changed.availabilityError(in: [option]) != nil, "Unsupported effort accepted")
        let noFast = ModelOption(catalog: [
            "visibility": "list", "slug": "fixture",
            "supported_reasoning_levels": [["effort": "medium"]],
        ])!
        try expect(preset.availabilityError(in: [noFast]) != nil, "Fast silently downgraded")
        try rejects("Invalid preset produced request") {
            _ = try recipe.prepare(
                values: ["fuzzy term": "word", "fuzzy context": "context"], preset: changed, models: [option])
        }
        try expect(changed.effort == "ultra" && preset.fast, "Validation mutated choices")
    }
    try run("configuration round trip, empty collections, and reference validation") {
        let store = ConfigurationStore(directory: directory.appendingPathComponent("config"))
        try expect(try store.load() == nil, "Missing config should be distinct from empty")
        var config = Configuration(presets: [preset], recipes: [recipe])
        try store.save(config)
        try expect(try store.load() == config, "Configuration did not round trip")
        let attributes = try FileManager.default.attributesOfItem(atPath: store.url.path)
        try expect(
            (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600, "Configuration is not owner-only"
        )
        config.presets = []
        try rejects("Referenced preset removed") { try store.save(config) }
        config = Configuration()
        try store.save(config)
        try expect(try store.load() == Configuration(), "Removed starters must not reappear")
        let duplicate = ModelPreset(name: " LIT ", model: "fixture", effort: "low", fast: false)
        try rejects("Duplicate name accepted") { try Configuration(presets: [preset, duplicate]).validate() }
    }
    try run("configuration corruption and failed saves preserve previous bytes") {
        let store = ConfigurationStore(directory: directory.appendingPathComponent("config-failure"))
        let config = Configuration(presets: [preset], recipes: [recipe])
        try store.save(config)
        let original = try Data(contentsOf: store.url)
        var invalid = config
        invalid.recipes[0].template = "{{unfinished"
        try rejects("Invalid save accepted") { try store.save(invalid) }
        try expect(try Data(contentsOf: store.url) == original, "Rejected save overwrote configuration")
        let broken = Data("{broken".utf8)
        try broken.write(to: store.url)
        try rejects("Corrupt config loaded") { _ = try store.load() }
        try expect(try Data(contentsOf: store.url) == broken, "Loading corruption rewrote bytes")
        let blockedDirectory = directory.appendingPathComponent("config-blocked")
        try Data("file".utf8).write(to: blockedDirectory)
        try rejects("Storage error ignored") {
            try ConfigurationStore(directory: blockedDirectory).save(config)
        }
    }
    try run("compiled request and immutable recipe history snapshots") {
        let entry = try recipe.prepare(
            values: ["fuzzy term": "elicit", "fuzzy context": "draw out"], preset: preset, models: [option])
        let body = ResponsesClient.requestBody(entry: entry)
        let input = body["input"] as? [[String: String]]
        try expect(
            input?.first?["content"] == "Find elicit for draw out; correct elicit.", "Wrong compiled payload")
        try expect(body["instructions"] == nil, "Hidden legacy-mode instruction contaminated recipe")
        try expect(
            body["model"] as? String == "fixture" && body["service_tier"] as? String == "priority",
            "Wrong preset sent")
        try expect(body["store"] as? Bool == false && body["stream"] as? Bool == true, "Plan contract lost")
        let store = try HistoryStore(directory: directory.appendingPathComponent("recipe-history"))
        try store.append(entry)
        var edited = recipe
        edited.template = "New {{text}}"
        let reloaded = try store.load().entries[0]
        try expect(
            reloaded.recipeSnapshot == recipe && reloaded.presetSnapshot == preset,
            "Historical snapshot changed")
        try expect(
            reloaded.inputValues == entry.inputValues && reloaded.query == entry.query,
            "Historical fields lost")
        try expect(
            reloaded.recipeName == "Lookup" && reloaded.displayQuery == "elicit · draw out",
            "History display lost user inputs")
        try expect(reloaded.markdown.contains(entry.query), "Export must contain exact compiled prompt")
        let decoder = JSONDecoder()
        let old = try decoder.decode(
            HistoryEntry.self,
            from: Data(
                #"{"id":"00000000-0000-0000-0000-000000000001","createdAt":0,"mode":"Ask","query":"old query","response":"old response","model":"fixture","effort":"low","status":"completed","schemaVersion":1}"#
                    .utf8))
        try expect(
            old.recipeSnapshot == nil && old.displayQuery == "old query", "Legacy history no longer readable")
        try expect(
            ResponsesClient.requestBody(entry: old)["instructions"] as? String == QueryMode.ask.instruction,
            "Legacy request semantics changed")
    }
    try run("Raycast single-field submission versus multi-field completion") {
        let config = Configuration.starters(model: "fixture", effort: "medium", fast: false)
        let single = try config.preparingLauncherInput("query", recipeID: config.recipes[0].id)
        try expect(single.submit && single.values == ["text": "query"], "Single-field launcher changed")
        let multi = try config.preparingLauncherInput("word", recipeID: config.recipes[3].id)
        try expect(
            !multi.submit && multi.values == ["fuzzy term": "word"], "Multi-field launcher must wait for user"
        )
        try rejects("Missing recipe accepted") {
            _ = try config.preparingLauncherInput("word", recipeID: UUID())
        }
    }
}
