import EZCore
import SaulNativeValues
import SwiftUI

public struct EZApp: App {
    public init() {}
    @NSApplicationDelegateAdaptor(EZAppDelegate.self) private var delegate

    public var body: some Scene {
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
    let model = EZComposition.installed()
    lazy var quickLookup = QuickLookupController(model: model)
    private lazy var selectedTextService = SelectedTextService { [unowned self] text in
        try model.lookup.prepareSelectedText(text)
        quickLookup.launcherError = nil
        quickLookup.show()
    }
    private var connectionTask: Task<Void, Never>?
    private var settlement: Task<Void, Never>?
    private var quitDeadline: Task<Void, Never>?

    func applicationDidFinishLaunching(_ notification: Notification) {
        quickLookup.start()
        model.refreshHistory()
        _ = connectOnce()
        NSApp.servicesProvider = selectedTextService
        NSUpdateDynamicServices()
    }

    private func connectOnce() -> Task<Void, Never> {
        if let connectionTask { return connectionTask }
        let task = Task {
            await model.waitForHistory()
            if !Task.isCancelled { await model.connect() }
        }
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
            try model.lookup.submitLauncher(request.query, after: connectOnce())
            quickLookup.launcherError = nil
        } catch { quickLookup.launcherError = error.localizedDescription }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        quickLookup.showMain()
        return false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if settlement != nil { return .terminateLater }
        connectionTask?.cancel()
        quickLookup.shutdown()
        guard model.shutdown() else { return .terminateNow }
        settlement = Task {
            await model.waitForPersistence()
            if !Task.isCancelled { finishQuit(sender) }
        }
        quitDeadline = Task {
            // Allow a SQLite busy wait to finish; do not hold Quit open indefinitely.
            do { try await Task.sleep(for: .seconds(6)) } catch { return }
            finishQuit(sender)
        }
        return .terminateLater
    }

    private func finishQuit(_ sender: NSApplication) {
        guard settlement != nil else { return }
        settlement?.cancel()
        settlement = nil
        quitDeadline?.cancel()
        quitDeadline = nil
        sender.reply(toApplicationShouldTerminate: true)
    }

    func applicationWillTerminate(_ notification: Notification) {
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
        ContentView(model: model, lookup: model.lookup)
            .disabled(model.lookup.launcherPending)
            .onAppear {
                quickLookup.setOpenMain { openWindow(id: "main") }
            }
            .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) {
                _ in
                model.refreshHistory()
                if !model.showSettings { model.refreshConfiguration() }
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
            Button("Quick Lookup") { quickLookup.showFreshLookup() }
        }
        CommandMenu("Actions") {
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
        Button(command.title) { quickLookup.perform(command) }
            .keyboardShortcut(model.shortcuts.binding(for: command).keyboardShortcut)
            .disabled(model.showSettings || !model.lookup.commandEnabled(command))
    }
}

private struct LookupMenu: View {
    @ObservedObject var quickLookup: QuickLookupController

    var body: some View {
        Button("Quick Lookup · ⌃⌥ Space") { quickLookup.showFreshLookup() }
        Button("Open EZ & history") { quickLookup.showMain() }
        Button("Connections & settings…") { quickLookup.showMain(settings: true, section: .connections) }
        if let error = quickLookup.shortcutError { Text(error) }
        Divider()
        Button("Quit EZ") { NSApp.terminate(nil) }.keyboardShortcut("q")
    }
}
