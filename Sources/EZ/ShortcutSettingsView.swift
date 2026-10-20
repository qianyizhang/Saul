import EZCore
import SwiftUI

extension LookupKeyBinding {
    init(event: NSEvent) {
        let flags = event.modifierFlags
        var bits = 0
        if flags.contains(.command) { bits |= 1 }
        if flags.contains(.option) { bits |= 2 }
        if flags.contains(.control) { bits |= 4 }
        if flags.contains(.shift) { bits |= 8 }
        let named: [UInt16: String] = [
            36: "return", 48: "tab", 49: "space", 123: "left", 124: "right", 125: "down", 126: "up",
        ]
        // Shift is a separate modifier even when AppKit returns the shifted symbol.
        let base = [
            "{": "[", "}": "]", ":": ";", "\"": "'", "<": ",", ">": ".", "?": "/", "|": "\\", "_": "-",
            "+": "=", "~": "`", "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7",
            "*": "8", "(": "9", ")": "0",
        ]
        let text = event.charactersIgnoringModifiers?.lowercased() ?? ""
        self.init(key: named[event.keyCode] ?? base[text] ?? text, modifiers: bits)
    }

    var keyboardShortcut: KeyboardShortcut? {
        guard self != .unassigned else { return nil }
        let names: [String: KeyEquivalent] = [
            "return": .return, "tab": .tab, "space": .space, "left": .leftArrow, "right": .rightArrow,
            "up": .upArrow, "down": .downArrow,
        ]
        guard let equivalent = names[key] ?? key.first.map({ KeyEquivalent($0) }) else { return nil }
        var flags: EventModifiers = []
        if modifiers & 1 != 0 { flags.insert(.command) }
        if modifiers & 2 != 0 { flags.insert(.option) }
        if modifiers & 4 != 0 { flags.insert(.control) }
        if modifiers & 8 != 0 { flags.insert(.shift) }
        return KeyboardShortcut(equivalent, modifiers: flags)
    }
}

struct ShortcutSettingsView: View {
    @ObservedObject var model: AppModel
    @State private var recording: LookupCommand?
    @State private var message: String?
    @State private var recordingError: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Keyboard shortcuts").font(.headline)
                if !model.minimumMode {
                    Text(
                        "Work in the main window and Quick Lookup, including while typing. Click a shortcut to record a replacement; changes save immediately on this Mac."
                    )
                    .font(AppStyle.caption).foregroundStyle(.secondary)
                }
                ForEach(LookupCommand.allCases, id: \.rawValue) { command in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(command.title)
                            if let name = recipeName(command) {
                                Text(name).font(AppStyle.caption).foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        Button(model.shortcuts.binding(for: command).display) {
                            recordingError = nil
                            recording = command
                        }
                        .font(.system(.body, design: .monospaced)).frame(width: 140)
                        .accessibilityLabel("Change \(command.title) shortcut")
                    }
                    Divider()
                }
                if !model.minimumMode {
                    Text(
                        "Recipe numbers follow Configuration order; Last recipe selects the final item. Next/Previous wraps. Switching recipes clears the draft and restores its default preset. Recipe changes and New are unavailable during generation."
                    )
                    .font(AppStyle.caption).foregroundStyle(.secondary)
                }
                VStack(spacing: 8) {
                    MetadataRow("Quick Lookup", value: "⌃⌥Space")
                    MetadataRow("Settings", value: "⌘,")
                    MetadataRow("Hide panel", value: "Esc / ⌘W")
                }.font(AppStyle.caption).foregroundStyle(.secondary)
                HStack {
                    Button("Use Chrome navigation") { chromeNavigation() }
                    Spacer()
                    Button("Restore defaults") {
                        do {
                            try model.restoreShortcuts()
                            message = "Default shortcuts restored."
                        } catch { message = error.localizedDescription }
                    }
                }
                if let error = model.shortcutSettingsError {
                    Text(error).font(AppStyle.caption).foregroundStyle(.red)
                }
                if let message { Text(message).font(AppStyle.caption) }
            }.padding(24)
        }
        .sheet(isPresented: Binding(get: { recording != nil }, set: { if !$0 { recording = nil } })) {
            if let command = recording {
                VStack(spacing: 18) {
                    Text(command.title).font(.headline)
                    Text("Press a shortcut with Command or Control. Esc cancels.")
                        .font(AppStyle.caption)
                    ShortcutCapture(
                        onKey: { binding in
                            do {
                                try model.saveShortcut(binding, for: command)
                                recording = nil
                                message = "\(command.title): \(binding.display)"
                            } catch { recordingError = error.localizedDescription }
                        }, onCancel: { recording = nil }
                    ).frame(height: 36)
                    if let recordingError {
                        Text(recordingError).font(AppStyle.caption).foregroundStyle(.red)
                    }
                    HStack {
                        Button("Clear shortcut") {
                            do {
                                try model.saveShortcut(.unassigned, for: command)
                                recording = nil
                            } catch { recordingError = error.localizedDescription }
                        }
                        Spacer()
                        Button("Cancel") { recording = nil }
                    }
                }.padding(24).frame(width: 440)
            }
        }
    }

    private func recipeName(_ command: LookupCommand) -> String? {
        if command == .lastRecipe { return model.configuration.recipes.last?.name ?? "No recipes" }
        guard let index = command.recipeIndex else { return nil }
        return model.configuration.recipes.indices.contains(index)
            ? model.configuration.recipes[index].name : "No recipe at this position"
    }

    private func chromeNavigation() {
        do {
            var updated = model.shortcuts
            updated.overrides[LookupCommand.nextRecipe.rawValue] = .init(key: "right", modifiers: 3)
            updated.overrides[LookupCommand.previousRecipe.rawValue] = .init(key: "left", modifiers: 3)
            try model.saveShortcuts(updated)
            message = "Chrome navigation: ⌘⌥← / ⌘⌥→."
        } catch { message = error.localizedDescription }
    }
}

private struct ShortcutCapture: View {
    var onKey: (LookupKeyBinding) -> Void
    var onCancel: () -> Void
    @State private var monitor: Any?

    var body: some View {
        Text("Waiting for shortcut…")
            .font(.system(.body, design: .monospaced))
            .onAppear {
                guard monitor == nil else { return }
                monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
                    MainActor.assumeIsolated {
                        if event.keyCode == 53 {
                            onCancel()
                        } else if !event.isARepeat {
                            onKey(LookupKeyBinding(event: event))
                        }
                    }
                    return nil
                }
            }
            .onDisappear {
                if let monitor { NSEvent.removeMonitor(monitor) }
                monitor = nil
            }
    }
}
