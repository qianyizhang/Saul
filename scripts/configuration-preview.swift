import EZCore
import SwiftUI

// Editable production views; all account and inference actions are blocked by AppModel.offline.
@main struct EZConfigurationPreview: App {
    @StateObject private var model: AppModel
    private let controller: QuickLookupController

    init() {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ez-configuration-preview-\(UUID())", isDirectory: true)
        let model = AppModel(historyDirectory: directory, offline: true)
        model.models = [
            ModelOption(catalog: [
                "visibility": "list", "slug": "fixture-luna", "display_name": "Luna (offline fixture)",
                "supported_reasoning_levels": [["effort": "low"], ["effort": "medium"], ["effort": "high"]],
                "additional_speed_tiers": ["priority"],
            ])!
        ]
        var config = Configuration.starters(model: "fixture-luna", effort: "medium", fast: true)
        config.presets[0].name = "lit"
        config.presets.append(ModelPreset(name: "steady", model: "fixture-luna", effort: "high", fast: false))
        do { try model.saveConfiguration(config) } catch { model.error = error.localizedDescription }
        model.chooseRecipe(config.recipes[3].id)
        _model = StateObject(wrappedValue: model)
        controller = QuickLookupController(model: model)
    }

    var body: some Scene {
        WindowGroup("EZ Configuration Preview") {
            ConfigurationPreviewSurface(model: model, controller: controller)
        }.defaultSize(width: 1020, height: 820)
    }
}

private struct ConfigurationPreviewSurface: View {
    @ObservedObject var model: AppModel
    let controller: QuickLookupController
    @State private var configuration = true
    @State private var compact = false
    @State private var dark = false
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Native configuration · disposable offline data").font(.caption)
                Spacer()
                Toggle("Configuration", isOn: $configuration)
                Toggle("Quick Lookup", isOn: $compact)
                Toggle("Dark", isOn: $dark)
            }.padding(12)
            Divider()
            if configuration {
                SettingsView(model: model)
            } else if compact {
                QuickLookupView(model: model, controller: controller).frame(width: 560)
            } else {
                ContentView(model: model)
            }
        }.preferredColorScheme(dark ? .dark : .light)
            .frame(minWidth: 780, minHeight: 780)
    }
}
