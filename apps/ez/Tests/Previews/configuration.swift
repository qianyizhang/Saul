import EZCore
import SaulNativeValues
import SwiftUI

@testable import EZApplication

// Editable production views; the composition supplies no live account or inference adapter.
@main struct EZConfigurationPreview: App {
    @StateObject private var model: AppModel
    private let controller: QuickLookupController

    init() {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ez-configuration-preview-\(UUID())", isDirectory: true)
        let checks = ConnectionChecks(
            status: { connection in
                connection.kind == .chatGPTPlan
                    ? ConnectionStatus(connected: true, identity: "alex@example.com", signedIn: true)
                    : ConnectionStatus(connected: true, endpoint: connection.endpoint, keySuffix: "7K2m")
            },
            catalog: { connection, _ in
                let models =
                    connection.kind == .chatGPTPlan
                    ? [
                        ConnectionModel(
                            id: "fixture-luna", name: "Luna (offline fixture)", capabilities: [.write],
                            efforts: ["low", "medium", "high"], defaultEffort: "low", fastTier: "priority")
                    ]
                    : [
                        ConnectionModel(id: "gpt-image-fixture", capabilities: [.draw]),
                        ConnectionModel(id: "gpt-realtime-fixture", capabilities: [.speak]),
                    ]
                return ConnectionCatalog(models: models, fetchedAt: Date().timeIntervalSince1970)
            })
        let recovery = CommandLine.arguments.contains("--connection-recovery")
        var verifiedKey = false
        let model = fixtureModel(
            directory: directory, connectionChecks: checks,
            client: .init(
                saveKey: { _, key in verifiedKey = key == "fixture-repair" },
                keyStatus: { connection in
                    ConnectionStatus(connected: verifiedKey, endpoint: connection.endpoint)
                }))
        var config = Configuration.starters(model: "fixture-luna", effort: "medium", fast: true)
        config.connections[0].accountId = "fixture-account"
        config.connections[1].baseUrl = "https://api.openai.com/v1"
        config.presets.append(
            ModelPreset(
                name: "Speak", model: "gpt-realtime-fixture", effort: "", fast: false,
                connectionKey: "openai-api", capability: .speak, speechOptions: SpeechOptions()))
        config.presets[0].name = "lit"
        config.presets.append(ModelPreset(name: "steady", model: "fixture-luna", effort: "high", fast: false))
        do { try model.saveConfiguration(config) } catch { model.error = error.localizedDescription }
        model.chooseAction(config.actions[3].id)
        let connections = config.connections
        Task {
            for connection in connections { await checks.refresh(connection) }
            if recovery {
                model.settingsSection = .connections
                let custom = ConnectionDefinition(
                    key: "fixture-recovery", name: "Offline custom endpoint", kind: .openAIAPI,
                    baseUrl: "https://fixture.example/v1")
                do {
                    try await model.saveConnection(custom, previous: nil, key: "fixture-initial")
                } catch {
                    model.error = error.localizedDescription
                }
            }
        }
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
