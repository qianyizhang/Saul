import EZCore
import SwiftUI

// Production surfaces, disposable storage, no auth connection or global shortcut.
@main struct EZSurfacePreview: App {
    @StateObject private var model: AppModel
    private let controller: QuickLookupController

    init() {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ez-surface-preview-\(UUID())", isDirectory: true)
        let model = AppModel(historyDirectory: directory, offline: true)
        _model = StateObject(wrappedValue: model)
        controller = QuickLookupController(model: model)
    }

    var body: some Scene {
        Window("EZ Surface Preview", id: "main") {
            SurfacePreviewControls(model: model, controller: controller)
        }.defaultSize(width: 780, height: 640)
    }
}

private struct SurfacePreviewControls: View {
    @ObservedObject var model: AppModel
    @ObservedObject var controller: QuickLookupController
    @State private var scenario = "Empty"
    @State private var dark = false
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Picker("Fixture", selection: $scenario) {
                    ForEach(
                        [
                            "Empty", "Two inputs", "Many inputs", "Answer", "Streaming", "Blocked",
                            "No recipes",
                        ], id: \.self
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
            Text("Disposable offline data · Send and account actions are blocked")
                .font(.caption).foregroundStyle(.secondary).padding(.bottom, 8)
            Divider()
            ContentView(model: model)
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
        model.launcherPending = false
        model.newQuery()
        model.storageWarning = nil
        model.error = nil
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
        model.signedIn = true
        model.planEnabled = true
        model.entries = []
        if ["Answer", "Streaming", "Blocked"].contains(scenario) {
            model.query = "Serendipity"
        }
        if ["Answer", "Streaming", "Blocked"].contains(scenario), let recipe, let preset = model.currentPreset
        {
            if var entry = try? recipe.prepare(
                values: model.inputValues, preset: preset, models: model.models)
            {
                entry.response =
                    "**Serendipity** means finding something valuable or pleasant by chance.\n\nExample: finding a book you love while searching for something else."
                entry.status = scenario == "Streaming" ? "pending" : "completed"
                entry.actualServiceTier = scenario == "Streaming" ? nil : "default"
                model.entries = [entry]
                model.selection = entry.id
                model.busy = scenario == "Streaming"
            }
        }
        if scenario == "Blocked" {
            model.models = []
            model.error =
                "The selected preset is unavailable. Open Configuration to choose a supported model."
            model.storageWarning = "Answer could not be saved. Copy it before quitting."
        }
    }
}
