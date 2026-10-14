import EZCore
import Foundation

struct StateFailure: Error { let message: String }
func check(_ value: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !value() { throw StateFailure(message: message) }
}

@main struct StateChecks {
    @MainActor static func main() {
        do { try run() } catch {
            print("FAIL \((error as? StateFailure)?.message ?? error.localizedDescription)")
            exit(1)
        }
    }

    @MainActor private static func run() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(
            "ez-state-checks-\(UUID())")
        defer { try? FileManager.default.removeItem(at: directory) }
        let option = ModelOption(catalog: [
            "visibility": "list", "slug": "fixture",
            "supported_reasoning_levels": [["effort": "low"], ["effort": "medium"]],
            "additional_speed_tiers": ["priority"],
        ])!
        let model = AppModel(historyDirectory: directory, offline: true)
        model.models = [option]
        var config = Configuration.starters(model: "fixture", effort: "low", fast: false)
        let alternate = ModelPreset(name: "lit", model: "fixture", effort: "medium", fast: true)
        config.presets.append(alternate)
        config.recipes[3].presetID = alternate.id
        try model.saveConfiguration(config)
        model.chooseRecipe(config.recipes[0].id)
        model.query = "word"
        model.choosePreset(alternate.id)
        try check(model.currentPreset == alternate && model.query == "word", "Override lost input")
        var edited = config
        edited.recipes[1].name = "Proofread"
        try model.saveConfiguration(edited)
        try check(
            model.currentPreset == alternate && model.query == "word",
            "An unrelated configuration edit reset the lookup's preset override")
        model.newQuery()
        try check(
            model.overridePresetID == nil && model.currentPreset == config.presets[0],
            "Override persisted into new lookup")
        model.chooseRecipe(config.recipes[3].id)
        try check(
            model.currentPreset == alternate && model.inputFields == ["fuzzy term", "fuzzy context"],
            "Recipe default/fields wrong")
        let submits = try model.prepareLauncher("ellicitate")
        try check(
            !submits && model.inputValues == ["fuzzy term": "ellicitate"], "Raycast sent incomplete recipe")
        model.inputValues["fuzzy context"] = "draw out"
        let snapshot = try model.currentRecipe!.prepare(
            values: model.inputValues, preset: alternate, models: [option])
        model.busy = true
        model.chooseRecipe(config.recipes[0].id)
        try check(model.currentRecipe?.id == config.recipes[3].id, "Busy recipe changed")
        do {
            try model.saveConfiguration(Configuration())
            throw StateFailure(message: "Busy configuration saved")
        } catch is EZError {}
        model.busy = false
        try model.saveConfiguration(Configuration())
        try check(model.currentRecipe == nil, "Deleted selected recipe remained active")
        model.reuse(snapshot)
        try check(
            model.currentRecipe == snapshot.recipeSnapshot && model.currentPreset == alternate
                && model.inputValues == snapshot.inputValues,
            "Deleted recipe/preset could not be reused from history")
        model.newQuery()
        try check(
            model.currentRecipe == nil && model.overridePresetID == nil,
            "New lookup resurrected removed recipe")
        model.reuse(snapshot)
        edited = config
        edited.recipes[3].template = "Rewrite {{text}}"
        try model.saveConfiguration(edited)
        try check(
            model.currentRecipe == snapshot.recipeSnapshot && model.currentPreset == alternate
                && model.inputValues == snapshot.inputValues,
            "Configuration editing replaced a saved lookup's recipe or inputs")
        model.newQuery()
        try check(
            model.currentRecipe?.id == config.recipes[0].id,
            "New lookup did not return to a remaining recipe after replay")
        try check(!model.canSend, "Offline fixture could send a live request")
        model.shutdown()
        print(
            "PASS recipe defaults, override/replay preservation during configuration edits, multi-field launcher, busy guards, and offline inference guard"
        )

        let corruptedDirectory = directory.appendingPathComponent("corrupted")
        try FileManager.default.createDirectory(at: corruptedDirectory, withIntermediateDirectories: true)
        let configURL = corruptedDirectory.appendingPathComponent("configuration.json")
        let bytes = Data("{broken".utf8)
        try bytes.write(to: configURL)
        let corrupted = AppModel(historyDirectory: corruptedDirectory, offline: true)
        try check(
            corrupted.configurationError != nil && !corrupted.canSend, "Corrupt configuration silently reset")
        do {
            try corrupted.saveConfiguration(config)
            throw StateFailure(message: "Corrupt file overwritten")
        } catch is EZError {}
        try check(try Data(contentsOf: configURL) == bytes, "Original corrupted bytes changed")
        corrupted.shutdown()
        print("PASS AppModel preserves corrupt configuration and blocks replacement")

        try model.saveConfiguration(config)
        let blockedURL = directory.appendingPathComponent("configuration.json")
        try FileManager.default.removeItem(at: blockedURL)
        try FileManager.default.createDirectory(at: blockedURL, withIntermediateDirectories: true)
        do {
            try model.saveConfiguration(Configuration())
            throw StateFailure(message: "Storage failure ignored")
        } catch is StateFailure { throw StateFailure(message: "Storage failure ignored") } catch {}
        try check(model.configuration == config, "Failed save changed in-memory configuration")
        print("PASS configuration write failure leaves in-memory state intact")
    }
}
