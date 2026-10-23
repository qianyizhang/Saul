import EZCore
import SwiftUI

// Production surfaces, disposable storage, no auth connection or global shortcut.
@main struct EZSurfacePreview: App {
    @StateObject private var model: AppModel
    private let controller: QuickLookupController
    private let syntheticAttempt: Bool

    init() {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ez-surface-preview-\(UUID())", isDirectory: true)
        syntheticAttempt = CommandLine.arguments.contains("--unsaved-attempt")
        let execution: AttemptExecution?
        if syntheticAttempt {
            let history = try? HistoryStore(directory: directory)
            var failedTerminal = false
            execution = AttemptExecution(
                accessToken: { "offline-preview-token" },
                stream: { _, _, update in
                    var result = ResponseAccumulator()
                    try result.consume(
                        JSONSerialization.data(withJSONObject: [
                            "type": "response.output_text.delta",
                            "delta":
                                "**Serendipity** means finding something valuable or pleasant by chance.\n\nThis synthetic answer exercises recovery without network or account access.",
                        ]))
                    try result.consume(
                        JSONSerialization.data(withJSONObject: [
                            "type": "response.completed", "response": ["status": "completed"],
                        ]))
                    update(result)
                    return result
                },
                append: { entry in
                    guard let history else { throw EZError("Preview history is unavailable.") }
                    if entry.status != "pending", !failedTerminal {
                        failedTerminal = true
                        throw EZError(
                            "Synthetic final-save failure. Save again will use disposable local history.")
                    }
                    try history.append(entry)
                })
        } else {
            execution = nil
        }
        let model = AppModel(historyDirectory: directory, offline: true, attemptExecution: execution)
        _model = StateObject(wrappedValue: model)
        controller = QuickLookupController(model: model)
    }

    var body: some Scene {
        Window("EZ Surface Preview", id: "main") {
            SurfacePreviewControls(model: model, controller: controller, syntheticAttempt: syntheticAttempt)
                .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification))
            { _ in
                controller.shutdown()
                model.shutdown()
                try? FileManager.default.removeItem(at: model.directory)
            }
        }.defaultSize(width: 780, height: 640)
    }
}

private struct SurfacePreviewControls: View {
    @ObservedObject var model: AppModel
    @ObservedObject var controller: QuickLookupController
    let syntheticAttempt: Bool
    @State private var scenario = "Empty"
    @State private var dark = false
    @State private var reduceMotion = false
    init(model: AppModel, controller: QuickLookupController, syntheticAttempt: Bool) {
        self.model = model
        self.controller = controller
        self.syntheticAttempt = syntheticAttempt
        _scenario = State(initialValue: syntheticAttempt ? "Unsaved" : "Empty")
    }
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Picker("Fixture", selection: $scenario) {
                    ForEach(
                        [
                            "Empty", "Signed out", "Two inputs", "Many inputs", "Answer", "Waiting",
                            "Thinking",
                            "Streaming", "Blocked", "Prose corrections",
                            "No recipes", "Selector hitboxes", "Long metadata", "Legacy answer",
                        ] + (syntheticAttempt ? ["Unsaved"] : []), id: \.self
                    ) {
                        Text($0)
                    }
                }
                Toggle("Dark", isOn: $dark)
                Button("Show Quick Lookup") { controller.show() }
                Button("Minimum panel") {
                    controller.show()
                    if let panel = NSApp.windows.first(where: { $0.title == "EZ Quick Lookup" }) {
                        panel.setContentSize(panel.contentMinSize)
                    }
                }
            }.padding(12)
            HStack(spacing: 20) {
                Toggle("Minimum Mode", isOn: $model.minimumMode)
                Toggle("Reduce motion (main preview)", isOn: $reduceMotion)
            }.toggleStyle(.checkbox).font(.caption).padding(.bottom, 6)
            Text(
                syntheticAttempt
                    ? "Disposable synthetic requests · No account or network access"
                    : "Disposable offline data · Send and account actions are blocked"
            )
            .font(.caption).foregroundStyle(.secondary).padding(.bottom, 8)
            Divider()
            ContentView(model: model)
                .environment(\.thinkingLightMotionDisabled, reduceMotion)
        }
        .preferredColorScheme(dark ? .dark : .light)
        .onAppear {
            NSApp.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
            loadFixture()
        }
        .onChange(of: scenario) { _, _ in loadFixture() }
        .onChange(of: dark) { _, value in
            NSApp.appearance = NSAppearance(named: value ? .darkAqua : .aqua)
        }
    }

    private func loadFixture() {
        model.busy = false
        model.responseActivity = .waiting
        model.launcherPending = false
        model.newQuery()
        model.storageWarning = nil
        model.error = nil
        model.search = ""
        model.models = [
            ModelOption(catalog: [
                "visibility": "list", "slug": "fixture-luna", "display_name": "Luna (offline fixture)",
                "supported_reasoning_levels": [["effort": "medium"], ["effort": "high"]],
                "additional_speed_tiers": ["priority"],
            ])!
        ]
        var config = Configuration.starters(model: "fixture-luna", effort: "medium", fast: true)
        config.presets[0].name = "lit"
        config.presets.append(ModelPreset(name: "steady", model: "fixture-luna", effort: "high", fast: false))
        if scenario == "Selector hitboxes" {
            config.recipes[0].name = "A deliberately long recipe title for checking the full selector hitbox"
            config.recipes[1].name = "S"
            config.presets[0].name = "A deliberately long preset title"
            config.presets[1].name = "S"
        }
        if scenario == "Many inputs" {
            config.recipes.append(
                Recipe(
                    name: "Long form", presetID: config.presets[0].id,
                    template: (1...8).map { "{{Input \($0)}}" }.joined(separator: "\n")))
        }
        if scenario == "No recipes" { config.recipes = [] }
        do { try model.saveConfiguration(config) } catch { model.error = error.localizedDescription }
        let recipe: Recipe?
        if scenario == "Two inputs" {
            recipe = config.recipes[3]
        } else if scenario == "Many inputs" {
            recipe = config.recipes.last
        } else {
            recipe = config.recipes.first
        }
        model.chooseRecipe(recipe?.id)
        model.signedIn = scenario != "Signed out"
        model.planEnabled = scenario != "Signed out"
        model.entries = []
        if ["Answer", "Waiting", "Thinking", "Streaming", "Blocked", "Long metadata", "Legacy answer"]
            .contains(scenario)
        {
            model.query = "Serendipity"
        }
        if ["Answer", "Waiting", "Thinking", "Streaming", "Blocked", "Long metadata", "Legacy answer"]
            .contains(scenario), let recipe,
            let preset = model.currentPreset
        {
            if var entry = try? recipe.prepare(
                values: model.inputValues, preset: preset, models: model.models)
            {
                entry.response =
                    "**Serendipity** means finding something valuable or pleasant by chance.\n\nExample: finding a book you love while searching for something else."
                let pending = ["Waiting", "Thinking", "Streaming"].contains(scenario)
                if ["Waiting", "Thinking"].contains(scenario) { entry.response = "" }
                model.responseActivity =
                    scenario == "Thinking" ? .thinking : scenario == "Streaming" ? .responding : .waiting
                entry.status = pending ? "pending" : "completed"
                entry.actualServiceTier = pending ? nil : "default"
                entry.metrics = ResponseMetrics(
                    inputTokens: pending ? nil : 128,
                    reasoningTokens: pending ? nil : 256,
                    outputTokens: pending ? nil : 320,
                    timeToFirstTokenSeconds: ["Waiting", "Thinking"].contains(scenario) ? nil : 0.82,
                    durationSeconds: pending ? nil : 4.2)
                if scenario == "Long metadata" {
                    entry.model = "fixture-model-with-a-deliberately-long-identifier-for-wrapping"
                    entry.presetSnapshot?.name =
                        "A deliberately long saved preset name for detailed translation"
                }
                if scenario == "Legacy answer" {
                    entry.presetSnapshot = nil
                    entry.metrics = nil
                    entry.actualServiceTier = nil
                }
                model.entries = [entry]
                model.selection = entry.id
                model.busy = pending
            }
        }
        if scenario == "Prose corrections" {
            var entry = HistoryEntry(
                mode: .spelling,
                query: """
                    our comunity garden opens on saturday.
                    please brings a small shovel and some water, we has extra gloves for everyone.

                    first, meet by the wooden gate so the organiser can explain the planting plan.

                    - label each row befor planting the seeds
                    - the new watering schedule should posted imediately
                    """,
                model: "fixture-luna", effort: "medium", requestedServiceTier: nil)
            entry.response = """
                Our community garden opens on Saturday.
                Please bring a small shovel and some water. We have extra gloves for everyone.

                First, meet by the wooden gate so the organizer can explain the planting plan.

                - Label each row before planting the seeds.
                - The new watering schedule should be posted immediately.

                Changes: Fixed spelling, agreement, capitalization, and punctuation.
                """
            entry.status = "completed"
            model.entries = [entry]
            model.selection = entry.id
        }
        if scenario == "Blocked" {
            model.models = []
            model.error =
                "The selected preset is unavailable. Open Configuration to choose a supported model."
            model.storageWarning = "Answer could not be saved. Copy it before quitting."
        }
        if scenario == "Unsaved" {
            model.query = "Serendipity"
            model.send()
        }
    }
}
