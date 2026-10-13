import SwiftUI

@main struct EZApp: App {
    @StateObject private var model = AppModel()
    var body: some Scene {
        Window("EZ", id: "main") {
            ContentView(model: model)
                .frame(minWidth: 760, minHeight: 560)
                .task { await model.connect() }
                .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification))
            { _ in model.shutdown() }
        }
        .defaultSize(width: 1020, height: 740)
        .windowStyle(.hiddenTitleBar)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Lookup") { model.newQuery() }.keyboardShortcut("n").disabled(model.busy)
            }
            CommandGroup(replacing: .appSettings) {
                Button("Settings…") { model.showSettings = true }.keyboardShortcut(",")
            }
        }
    }
}
