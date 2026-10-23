import EZCheckSupport
import EZCore
import Foundation

@MainActor struct StateFixture {
    let directory: URL
    let model: AppModel
    let history: HistoryStore
    let configuration: Configuration
    let alternate: ModelPreset
    let single: Recipe
    let multi: Recipe

    init(directory: URL, attemptExecution: AttemptExecution? = nil) throws {
        self.directory = directory
        let option = ModelOption(catalog: [
            "visibility": "list", "slug": "fixture",
            "supported_reasoning_levels": [["effort": "low"], ["effort": "medium"]],
            "additional_speed_tiers": ["priority"],
        ])!
        var config = Configuration.starters(model: "fixture", effort: "low", fast: false)
        alternate = ModelPreset(name: "lit", model: "fixture", effort: "medium", fast: true)
        config.presets.append(alternate)
        guard let multiIndex = config.recipes.firstIndex(where: { $0.legacyMode == nil }),
            let single = config.recipes.first(where: { $0.legacyMode == .dictionary })
        else { throw CheckFailure("Starter configuration is missing Dictionary or Lookup") }
        config.recipes[multiIndex].presetID = alternate.id
        configuration = config
        self.single = single
        multi = config.recipes[multiIndex]
        // Seed before AppModel init so tests never read personal UserDefaults.
        try ConfigurationStore(directory: directory).save(config)
        history = try HistoryStore(directory: directory)
        model = AppModel(historyDirectory: directory, offline: true, attemptExecution: attemptExecution)
        model.models = [option]
    }
    func snapshot() throws -> HistoryEntry {
        try multi.prepare(
            values: ["fuzzy term": "elicit", "fuzzy context": "draw out"],
            preset: alternate, models: model.models)
    }
    func selectLookup() throws -> HistoryEntry {
        let entry = try snapshot()
        try history.append(entry)
        model.entries = [entry]
        model.selection = entry.id
        model.query = "draft to preserve"
        return entry
    }
}

@MainActor func stateCase(
    _ name: String, file: StaticString = #filePath, line: UInt = #line,
    _ body: @escaping @MainActor (StateFixture) throws -> Void
) -> CheckCase {
    CheckCase("state: " + name, file: file, line: line) { directory in
        let fixture = try StateFixture(directory: directory)
        defer { fixture.model.shutdown() }
        try body(fixture)
    }
}
