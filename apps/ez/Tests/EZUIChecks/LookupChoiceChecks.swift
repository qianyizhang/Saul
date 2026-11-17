import AppKit
import EZCheckSupport
import SwiftUI

@MainActor enum LookupChoiceChecks {
    static func cases() -> [CheckCase] {
        [false, true].map { panel in
            CheckCase("lookup chooser: search, selection and focus in a \(panel ? "panel" : "window")") { _ in
                var selected = "current"
                let host = ChoiceCheckWindow(panel: panel) { selected = $0 }
                defer { host.window.close() }

                let anchor = try await host.open()
                let search = try await host.searchField()
                try host.key(6, "z", in: search.window)
                try host.key(6, "z", in: search.window)
                try expectEqual(search.stringValue, "zz", "Typing did not reach chooser search")
                try host.key(36, "\r", in: search.window)
                try expectEqual(selected, "current", "Return in empty results committed a choice")
                try expect(ChoiceAnchor.hasOpenChooser, "Empty results dismissed the chooser")
                try host.key(53, "\u{1b}", in: search.window)
                try await host.expectDismissal(after: "Escape", returningFocusTo: anchor)

                try host.key(36, "\r", in: host.window)
                let reopened = try await host.searchField()
                try expectEqual(reopened.stringValue, "", "Reopening retained the last search")
                try host.key(125, "\u{f701}", in: reopened.window)
                try host.key(36, "\r", in: reopened.window)
                try expectEqual(selected, "valid", "Keyboard did not skip the disabled row")
                try await host.expectDismissal(after: "Selection", returningFocusTo: anchor)

                selected = "current"
                guard
                    let wheel = CGEvent(
                        scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: -1, wheel2: 0,
                        wheel3: 0
                    ).flatMap({ NSEvent(cgEvent: $0) })
                else { throw CheckFailure("Cannot create wheel event") }
                anchor.scrollWheel(with: wheel)
                try expectEqual(selected, "valid", "Wheel did not step past the disabled row")
            }
        }
    }
}

@MainActor private final class ChoiceCheckWindow {
    let window: NSWindow
    init(panel: Bool, choose: @escaping (String) -> Void) {
        let frame = NSRect(x: 100, y: 300, width: 420, height: 120)
        window =
            panel
            ? NSPanel(
                contentRect: frame, styleMask: [.titled, .nonactivatingPanel], backing: .buffered,
                defer: false)
            : NSWindow(contentRect: frame, styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = NSHostingView(
            rootView: HStack(spacing: 8) {
                LookupChoiceButton(
                    role: "Action",
                    options: [
                        LookupChoice(id: "current", name: "Keep this action"),
                        LookupChoice(
                            id: "disabled", name: "Unavailable action", unavailable: "Not supported"),
                        LookupChoice(
                            id: "valid", name: "A long alternative action name, fully available when searched"
                        ),
                    ], selection: "current", choose: choose
                ).frame(maxWidth: .infinity)
                LookupChoiceButton(
                    role: "Preset", options: [LookupChoice(id: "preset", name: "Everyday", badge: "Fast")],
                    selection: "preset", choose: choose
                ).frame(maxWidth: .infinity)
            }.frame(height: 44).padding(14))
        window.makeKeyAndOrderFront(nil)
    }

    func open() async throws -> ChoiceAnchor {
        window.contentView?.layoutSubtreeIfNeeded()
        try await settle()
        let anchors = descendants(of: window.contentView).compactMap { $0 as? ChoiceAnchor }
        try expectEqual(anchors.count, 2, "Native buttons were not hosted")
        try expectEqual(
            anchors[0].frame.size, anchors[1].frame.size, "Choice buttons have different hit targets")
        let anchor = anchors[0]
        let point = anchor.convert(
            NSPoint(x: anchor.bounds.maxX - 3, y: anchor.bounds.midY), to: anchor.superview)
        try expect(anchor.hitTest(point) === anchor, "The padded edge is outside the anchor's hit target")
        anchor.performClick(nil)
        try await settle()
        return anchor
    }

    func searchField() async throws -> NSSearchField {
        try await settle()
        try expect(ChoiceAnchor.hasOpenChooser, "The native chooser was not presented")
        let windows = [NSApp.keyWindow].compactMap { $0 } + (window.childWindows ?? []) + NSApp.windows
        guard
            let search = windows
                .lazy.flatMap({ self.descendants(of: $0.contentView) }).compactMap({ $0 as? NSSearchField })
                .first
        else { throw CheckFailure("The chooser did not open a native search field") }
        try expect(search.currentEditor() != nil, "Opening did not focus search")
        return search
    }

    func key(
        _ code: UInt16, _ characters: String, in destination: NSWindow?, flags: NSEvent.ModifierFlags = []
    ) throws {
        guard let destination,
            let event = NSEvent.keyEvent(
                with: .keyDown, location: .zero, modifierFlags: flags,
                timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: destination.windowNumber, context: nil, characters: characters,
                charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code)
        else { throw CheckFailure("Cannot create chooser key event") }
        destination.sendEvent(event)
    }

    func expectDismissal(after action: String, returningFocusTo anchor: ChoiceAnchor) async throws {
        // The chooser restores focus in AppKit's close callback.
        let clock = ContinuousClock()
        let deadline = clock.now + .seconds(2)
        while window.isVisible && (ChoiceAnchor.hasOpenChooser || window.firstResponder !== anchor)
            && clock.now < deadline
        {
            try await Task.sleep(for: .milliseconds(20))
        }
        try expect(window.isVisible, "\(action) closed the host window")
        try expect(!ChoiceAnchor.hasOpenChooser, "\(action) did not close the chooser")
        try expect(window.firstResponder === anchor, "\(action) did not restore anchor focus")
    }

    private func settle() async throws { try await Task.sleep(for: .milliseconds(80)) }

    private func descendants(of root: NSView?) -> [NSView] {
        guard let root else { return [] }
        return [root] + root.subviews.flatMap { descendants(of: $0) }
    }
}
