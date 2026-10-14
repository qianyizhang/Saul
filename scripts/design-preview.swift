import EZCore
import SwiftUI

// Renders production views with isolated fixture history. No authentication connection.
@main struct EZDesignPreview: App {
    @StateObject private var model: AppModel

    init() {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ez-design-preview-\(UUID().uuidString)", isDirectory: true)
        let model = AppModel(historyDirectory: directory)
        var entry = HistoryEntry(
            mode: .dictionary, query: "Equanimity", model: "Preview model", effort: "low",
            requestedServiceTier: nil)
        entry.response =
            "**Equanimity** is calmness and balance, especially under pressure.\n\nShe handled the unexpected change with equanimity.\n\nA useful distinction: equanimity means staying steady; indifference means not caring."
        entry.status = "completed"
        entry.actualServiceTier = "default"
        entry.durationSeconds = 1.2
        model.entries = [entry]
        model.selection = entry.id
        model.query = entry.query
        model.storageWarning = nil
        _model = StateObject(wrappedValue: model)
    }

    var body: some Scene {
        WindowGroup("EZ Design Preview") {
            PreviewSurface(model: model)
                .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification))
            { _ in
                model.shutdown()
                try? FileManager.default.removeItem(at: model.directory)
            }
        }.defaultSize(width: 1020, height: 780)
    }
}

private struct PreviewSurface: View {
    @ObservedObject var model: AppModel
    @State private var settings = false
    @State private var dark = true

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Production views · offline fixture").font(.caption)
                Spacer()
                Toggle("Settings", isOn: $settings)
                Toggle("Dark", isOn: $dark)
            }.padding(12)
            Divider()
            Group {
                if settings {
                    SettingsView(model: model)
                } else {
                    ContentView(model: model)
                }
            }
            .disabled(true)
            // Inspection is visual only; fixture controls cannot invoke production requests.
        }
        .preferredColorScheme(dark ? .dark : .light)
        .frame(minWidth: 760, minHeight: 650)
    }
}
