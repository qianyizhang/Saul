import EZCore
import Foundation
import SaulNativeValues
import SaulTestSupport

@testable import EZApplication

@MainActor struct StateFixture {
    let directory: URL
    let model: AppModel
    let history: HistoryStore
    let configuration: Configuration
    let alternate: ModelPreset
    let single: Action
    let multi: Action

    init(directory: URL, attemptExecution: AttemptExecution? = nil) throws {
        self.directory = directory
        var config = Configuration.starters(model: "fixture", effort: "low", fast: false)
        config.bindFixtureAccount()
        alternate = ModelPreset(name: "lit", model: "fixture", effort: "medium", fast: true)
        config.presets.append(alternate)
        guard let multiIndex = config.actions.firstIndex(where: { $0.legacyMode == nil }),
            let single = config.actions.first(where: { $0.legacyMode == .dictionary })
        else { throw CheckFailure("Starter configuration is missing Dictionary or Lookup") }
        config.actions[multiIndex].presetID = alternate.id
        configuration = config
        self.single = single
        multi = config.actions[multiIndex]
        // Seed before AppModel init so tests never read personal UserDefaults.
        try ConfigurationStore(directory: directory).save(config)
        history = try HistoryStore(directory: directory)
        model = fixtureModel(directory: directory, attemptExecution: attemptExecution)
    }
    func snapshot() throws -> HistoryEntry {
        try multi.prepare(
            values: ["fuzzy term": "elicit", "fuzzy context": "draw out"],
            preset: alternate, models: model.modelsForPreset(alternate), provider: .chatGPTPlan)
    }
    func savedAnswer() throws -> HistoryEntry {
        var entry = try snapshot()
        entry.status = "completed"
        entry.response = "A saved fixture answer."
        return entry
    }
    func selectLookup() throws -> HistoryEntry {
        let entry = try snapshot()
        try history.append(entry)
        model.showHistory([entry])
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
