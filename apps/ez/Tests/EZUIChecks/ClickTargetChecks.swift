import AppKit
import EZCheckSupport
import SwiftUI

/// Real SwiftUI row buttons, window-local mouse events, and no global input or personal data.
@main struct ClickTargetChecks {
    @MainActor static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        Task { @MainActor in
            exit(await CheckRunner.run(cases()))
        }
        app.run()
    }

    @MainActor static func cases() -> [CheckCase] {
        var checks: [CheckCase] = []
        for selected in [false, true] {
            for title in ["Ask", "Dictionary"] {
                checks.append(
                    CheckCase("row clicks: \(title), selected=\(selected)") { _ in
                        var clicks = 0
                        let host = ClickHost(
                            FullRowButton {
                                clicks += 1
                            } label: {
                                Text(title).frame(maxWidth: .infinity, minHeight: 20, alignment: .leading)
                                    .padding(6)
                                    .background(selected ? AppStyle.accent.opacity(0.12) : .clear)
                            })
                        defer { host.close() }
                        try await host.ready()
                        // Text, empty trailing area (the reported Ask miss), padding, and all four corners.
                        for point in [
                            NSPoint(x: 18, y: 16), NSPoint(x: 120, y: 16),
                            NSPoint(x: 2, y: 16), NSPoint(x: 72, y: 2), NSPoint(x: 72, y: 30),
                            NSPoint(x: 2, y: 2), NSPoint(x: 143, y: 2),
                            NSPoint(x: 2, y: 30), NSPoint(x: 143, y: 30),
                        ] {
                            let before = clicks
                            try await host.click(point)
                            try expectEqual(clicks, before + 1, "Missed row point \(point)")
                        }
                        for point in [
                            NSPoint(x: -2, y: 16), NSPoint(x: 147, y: 16),
                            NSPoint(x: 72, y: -2), NSPoint(x: 72, y: 34),
                        ] {
                            let before = clicks
                            try await host.click(point)
                            try expectEqual(clicks, before, "Click leaked beyond the row")
                        }
                    })
            }
        }
        checks.append(
            CheckCase("row clicks: disabled row ignores label and blank-area clicks") { _ in
                var clicks = 0
                let host = ClickHost(
                    FullRowButton {
                        clicks += 1
                    } label: {
                        Text("Ask").frame(maxWidth: .infinity, minHeight: 20, alignment: .leading).padding(6)
                    }.disabled(true))
                defer { host.close() }
                try await host.ready()
                try await host.click(NSPoint(x: 18, y: 16))
                try await host.click(NSPoint(x: 120, y: 16))
                try expectEqual(clicks, 0, "Disabled row activated")
            })
        checks.append(
            CheckCase("row clicks: native keyboard shortcut activates once") { _ in
                var clicks = 0
                let host = ClickHost(
                    FullRowButton {
                        clicks += 1
                    } label: {
                        Text("Ask").frame(maxWidth: .infinity, minHeight: 20, alignment: .leading).padding(6)
                    }.keyboardShortcut(.defaultAction))
                defer { host.close() }
                try await host.ready()
                guard
                    let event = NSEvent.keyEvent(
                        with: .keyDown, location: .zero, modifierFlags: [],
                        timestamp: ProcessInfo.processInfo.systemUptime,
                        windowNumber: host.window.windowNumber,
                        context: nil, characters: "\r", charactersIgnoringModifiers: "\r", isARepeat: false,
                        keyCode: 36)
                else { throw CheckFailure("Cannot create Return key event") }
                try expect(
                    host.window.performKeyEquivalent(with: event), "Native button did not handle Return")
                try expectEqual(clicks, 1, "Keyboard activation missed or repeated")
            })
        return checks
    }
}

@MainActor private final class ClickHost {
    let window: NSWindow

    init(_ view: some View) {
        window = NSWindow(
            contentRect: NSRect(x: 100, y: 100, width: 185, height: 72),
            styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.title = "EZ row regression"
        window.contentView = NSHostingView(rootView: view.frame(width: 145, height: 32).padding(20))
        window.makeKeyAndOrderFront(nil)
    }

    func close() { window.close() }

    func ready() async throws {
        window.contentView?.layoutSubtreeIfNeeded()
        // Let SwiftUI commit layout before dispatching an AppKit event into the hosted view.
        try await Task.sleep(for: .milliseconds(50))
    }

    func click(_ point: NSPoint) async throws {
        let point = NSPoint(x: point.x + 20, y: point.y + 20)
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            guard
                let event = NSEvent.mouseEvent(
                    with: type, location: point, modifierFlags: [],
                    timestamp: ProcessInfo.processInfo.systemUptime,
                    windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1,
                    pressure: 1)
            else { throw CheckFailure("Cannot create click event") }
            window.sendEvent(event)
        }
        try await ready()
    }
}
