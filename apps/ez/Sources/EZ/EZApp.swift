import EZCore
import SwiftUI

@main struct EZApp: App {
    @NSApplicationDelegateAdaptor(EZAppDelegate.self) private var delegate

    var body: some Scene {
        Window("EZ", id: "main") {
            MainWindowView(model: delegate.model, quickLookup: delegate.quickLookup)
                .frame(minWidth: 760, minHeight: 560)
        }
        .defaultSize(width: 1020, height: 740)
        .windowStyle(.hiddenTitleBar)
        .launcherPresentation()
        .commands {
            LookupCommands(model: delegate.model, quickLookup: delegate.quickLookup)
        }
        MenuBarExtra("EZ", systemImage: "text.book.closed") {
            LookupMenu(quickLookup: delegate.quickLookup)
        }
    }
}

@MainActor final class EZAppDelegate: NSObject, NSApplicationDelegate {
    let model = AppModel()
    lazy var quickLookup = QuickLookupController(model: model)
    private lazy var selectedTextService = SelectedTextService { [unowned self] text in
        try model.prepareSelectedText(text)
        quickLookup.launcherError = nil
        quickLookup.show()
    }
    private var connectionTask: Task<Void, Never>?
    private var launcherTask: Task<Void, Never>?

    func applicationDidFinishLaunching(_ notification: Notification) {
        quickLookup.start()
        _ = connectOnce()
        NSApp.servicesProvider = selectedTextService
        NSUpdateDynamicServices()
    }

    private func connectOnce() -> Task<Void, Never> {
        if let connectionTask { return connectionTask }
        let task = Task { await model.connect() }
        connectionTask = task
        return task
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        quickLookup.show()
        do {
            guard urls.count == 1, let url = urls.first else {
                throw EZError("Submit one EZ launcher query at a time.")
            }
            let request = try LauncherQuery(url: url)
            guard !model.busy, !model.launcherPending, !model.signingIn else {
                throw EZError(
                    "Query not sent: EZ is already preparing a lookup, generating an answer, or signing in. Try again when it finishes."
                )
            }
            quickLookup.launcherError = nil
            let shouldSubmit = try model.prepareLauncher(request.query)
            guard shouldSubmit else { return }
            model.launcherPending = true
            let connection = connectOnce()
            launcherTask = Task {
                await connection.value
                guard !Task.isCancelled else { return }
                model.launcherPending = false
                launcherTask = nil
                if model.canSend {
                    model.send()
                } else if model.error == nil {
                    model.error =
                        model.storageWarning
                        ?? model.requestIssue
                        ?? "Query not sent: connect ChatGPT, enable plan access, and choose an available model. Your query is ready to submit with Send."
                }
            }
        } catch { quickLookup.launcherError = error.localizedDescription }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        quickLookup.showMain()
        return false
    }

    func applicationWillTerminate(_ notification: Notification) {
        launcherTask?.cancel()
        connectionTask?.cancel()
        model.shutdown()
        quickLookup.shutdown()
    }
}

private struct MainWindowView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var quickLookup: QuickLookupController
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        ContentView(model: model)
            .disabled(model.launcherPending)
            .onAppear {
                quickLookup.setOpenMain { openWindow(id: "main") }
            }
    }
}

extension Scene {
    fileprivate func launcherPresentation() -> some Scene {
        if #available(macOS 15, *) {
            return SceneBuilder.buildOptional(
                SceneBuilder.buildLimitedAvailability(
                    defaultLaunchBehavior(
                        ProcessInfo.processInfo.arguments.contains("--ez-launcher") ? .suppressed : .automatic
                    )))
        } else {
            return SceneBuilder.buildOptional(SceneBuilder.buildLimitedAvailability(self))
        }
    }
}

private struct LookupCommands: Commands {
    @ObservedObject var model: AppModel
    @ObservedObject var quickLookup: QuickLookupController

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            commandButton(.newLookup)
            Button("Quick Lookup") { quickLookup.show() }
        }
        CommandMenu("Lookup") {
            commandButton(.send)
            commandButton(.stop)
            Divider()
            commandButton(.previousRecipe)
            commandButton(.nextRecipe)
            Divider()
            ForEach(
                LookupCommand.allCases.filter { $0.recipeIndex != nil || $0 == .lastRecipe }, id: \.rawValue
            ) { command in
                commandButton(command)
            }
        }
        CommandGroup(replacing: .appSettings) {
            Button("Settings…") { quickLookup.showMain(settings: true) }
                .keyboardShortcut(",")
        }
    }
    private func commandButton(_ command: LookupCommand) -> some View {
        Button(command.title) {
            if command == .newLookup { quickLookup.newQuery() } else { model.performLookupCommand(command) }
        }
        .keyboardShortcut(model.shortcuts.binding(for: command).keyboardShortcut)
        .disabled(model.showSettings || !model.commandEnabled(command))
    }
}

private struct LookupMenu: View {
    @ObservedObject var quickLookup: QuickLookupController

    var body: some View {
        Button("Quick Lookup · ⌃⌥ Space") { quickLookup.show() }
        Button("Open EZ & history") { quickLookup.showMain() }
        Button("Account & settings…") { quickLookup.showMain(settings: true, section: .account) }
        if let error = quickLookup.shortcutError { Text(error) }
        Divider()
        Button("Quit EZ") { NSApp.terminate(nil) }.keyboardShortcut("q")
    }
}
