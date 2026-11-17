import AppKit
import EZCheckSupport
import SwiftUI

@MainActor enum DraftKeyboardChecks {
    static func cases() -> [CheckCase] {
        [false, true].map { panel in
            CheckCase("draft keyboard: newline edits the focused \(panel ? "panel" : "window") draft") { _ in
                let host = DraftHost(panel: panel)
                defer { host.window.close() }
                let editor = try await host.editor()

                editor.setSelectedRange(NSRange(location: 2, length: 0))
                try host.pressReturn(modifiers: .shift)
                try expectEqual(host.draft, "ab\n🙂cd", "Shift-Return must insert at the caret")
                try expectEqual(
                    editor.selectedRange(), NSRange(location: 3, length: 0), "Caret did not advance")

                editor.setSelectedRange(NSRange(location: 3, length: 2))
                try host.pressReturn()
                try expectEqual(host.draft, "ab\n\ncd", "Return must replace the selected Unicode character")
                try expectEqual(
                    editor.selectedRange(), NSRange(location: 4, length: 0), "Selection was retained")

                try host.pressReturn(modifiers: .shift, keypad: true)
                try expectEqual(host.draft, "ab\n\n\ncd", "Keypad Enter must also insert a newline")
                try expect(host.window.firstResponder === editor, "Draft lost keyboard focus")
                try expectEqual(host.sends, 0, "Editing sent the draft")

                try host.pressReturn(modifiers: .command)
                try expectEqual(host.sends, 1, "The configured command must still be available")
                try expectEqual(host.draft, "ab\n\n\ncd", "Command-Return edited the draft")
            }
        }
    }
}

@MainActor private final class DraftHost {
    let window: NSWindow
    var draft = "ab🙂cd"
    var sends = 0

    init(panel: Bool) {
        let rect = NSRect(x: 180, y: 180, width: 300, height: 140)
        window =
            if panel {
                NSPanel(
                    contentRect: rect, styleMask: [.titled, .nonactivatingPanel],
                    backing: .buffered, defer: false)
            } else {
                NSWindow(contentRect: rect, styleMask: [.titled], backing: .buffered, defer: false)
            }
        window.isReleasedWhenClosed = false
        window.title = "EZ draft regression"
        window.contentView = NSHostingView(rootView: DraftFixture(host: self).padding(20))
        window.makeKeyAndOrderFront(nil)
    }

    func editor() async throws -> NSTextView {
        window.contentView?.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(50))
        guard let editor = window.firstResponder as? NSTextView else {
            throw CheckFailure("The draft did not receive native text focus")
        }
        return editor
    }

    func pressReturn(modifiers: NSEvent.ModifierFlags = [], keypad: Bool = false) throws {
        let characters = keypad ? "\u{3}" : "\r"
        guard
            let event = NSEvent.keyEvent(
                with: .keyDown, location: .zero,
                modifierFlags: keypad ? modifiers.union(.numericPad) : modifiers,
                timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                context: nil, characters: characters, charactersIgnoringModifiers: characters,
                isARepeat: false, keyCode: keypad ? 76 : 36)
        else { throw CheckFailure("Cannot create Return key event") }
        if !window.performKeyEquivalent(with: event) {
            window.sendEvent(event)
        }
    }
}

private struct DraftFixture: View {
    unowned let host: DraftHost
    @FocusState private var focused: Bool

    var body: some View {
        VStack {
            TextField("Draft", text: Binding(get: { host.draft }, set: { host.draft = $0 }), axis: .vertical)
                .textFieldStyle(.roundedBorder).lineLimit(1...4)
                .focused($focused).multilineDraftReturn()
            Button("Send") { host.sends += 1 }
                .keyboardShortcut(.return, modifiers: .command)
        }
        .onAppear { focused = true }
    }
}
