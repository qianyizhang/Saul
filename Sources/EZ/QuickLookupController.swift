import AppKit
import Carbon
import EZCore
import SwiftUI

@MainActor final class QuickLookupController: ObservableObject {
    @Published private(set) var shortcutError: String?
    @Published private(set) var presentation = 0
    @Published var launcherError: String?
    private let model: AppModel
    private var panel: QuickLookupPanel?
    private var hotKey: EventHotKeyRef?
    private var eventHandler: EventHandlerRef?
    private var keyMonitor: Any?
    private var openMain: (() -> Void)?
    private var started = false

    init(model: AppModel) { self.model = model }

    func setOpenMain(_ openMain: @escaping () -> Void) { self.openMain = openMain }

    func start() {
        guard !started else { return }
        started = true
        installKeyMonitor()
        var type = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let status = InstallEventHandler(
            GetApplicationEventTarget(),
            { _, event, context in
                guard let event, let context else { return OSStatus(eventNotHandledErr) }
                var id = EventHotKeyID()
                let status = GetEventParameter(
                    event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                    nil, MemoryLayout<EventHotKeyID>.size, nil, &id)
                guard status == noErr, id.signature == 0x455A_514C, id.id == 1 else {
                    return OSStatus(eventNotHandledErr)
                }
                // Application event handlers run on the main event loop.
                MainActor.assumeIsolated {
                    Unmanaged<QuickLookupController>.fromOpaque(context).takeUnretainedValue().toggle()
                }
                return noErr
            }, 1, &type, Unmanaged.passUnretained(self).toOpaque(), &eventHandler)
        guard status == noErr else {
            shortcutError = "Could not enable ⌃⌥ Space (\(status)). Use Quick Lookup in the menu bar."
            return
        }
        let registration = RegisterEventHotKey(
            UInt32(kVK_Space), UInt32(controlKey | optionKey),
            EventHotKeyID(signature: 0x455A_514C, id: 1), GetApplicationEventTarget(), 0, &hotKey)
        if registration != noErr {
            shortcutError =
                "⌃⌥ Space is unavailable (\(registration)). It may be in use by another app. Use Quick Lookup in the menu bar."
        }
    }

    func toggle() {
        if panel?.isVisible == true && panel?.isKeyWindow == true { hide() } else { show() }
    }

    func show() {
        installKeyMonitor()
        if panel == nil {
            let panel = QuickLookupPanel(
                contentRect: NSRect(x: 0, y: 0, width: QuickLookupLayout.defaultWidth, height: 280),
                styleMask: [.titled, .fullSizeContentView, .nonactivatingPanel, .resizable],
                backing: .buffered, defer: false)
            panel.title = "EZ Quick Lookup"
            panel.titleVisibility = .hidden
            panel.titlebarAppearsTransparent = true
            panel.standardWindowButton(.closeButton)?.isHidden = true
            panel.standardWindowButton(.miniaturizeButton)?.isHidden = true
            panel.standardWindowButton(.zoomButton)?.isHidden = true
            panel.level = .floating
            panel.isFloatingPanel = true
            panel.hidesOnDeactivate = false
            panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            panel.isReleasedWhenClosed = false
            panel.contentMinSize = NSSize(width: QuickLookupLayout.minimumWidth, height: 200)
            panel.contentView = NSHostingView(rootView: QuickLookupView(model: model, controller: self))
            self.panel = panel
        }
        guard let panel else { return }
        if !panel.isVisible {
            let screen =
                NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) }
                ?? NSScreen.main
            if let frame = screen?.visibleFrame {
                panel.setFrameOrigin(
                    NSPoint(
                        x: frame.midX - panel.frame.width / 2,
                        y: frame.midY - panel.frame.height / 2))
            }
        }
        panel.makeKeyAndOrderFront(nil)
        presentation += 1
    }

    private func installKeyMonitor() {
        guard keyMonitor == nil else { return }
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            let handled = MainActor.assumeIsolated { self?.handleKey(event) ?? false }
            return handled ? nil : event
        }
    }

    private func handleKey(_ event: NSEvent) -> Bool {
        guard let window = NSApp.keyWindow, !model.showSettings,
            window.attachedSheet == nil, NSApp.modalWindow == nil
        else { return false }
        let binding = LookupKeyBinding(event: event)
        if window === panel {
            if (event.keyCode == 53 && binding.modifiers == 0)
                || binding == LookupKeyBinding(key: "w")
            {
                hide()
                return true
            }
            if binding == LookupKeyBinding(key: ",") {
                showMain(settings: true)
                return true
            }
        }
        guard
            let command = LookupCommand.allCases.first(where: {
                model.shortcuts.binding(for: $0) != .unassigned
                    && model.shortcuts.binding(for: $0) == binding
            })
        else { return false }
        guard !event.isARepeat else { return true }
        if command == .newLookup { newQuery() } else { model.performLookupCommand(command) }
        return true
    }

    func hide() {
        panel?.orderOut(nil)
    }

    func resizeContent(_ layout: QuickLookupLayout) {
        guard let panel else { return }
        let top = panel.frame.maxY
        let visibleFrame = panel.screen?.visibleFrame ?? NSScreen.main?.visibleFrame
        let titlebarHeight = panel.frame.height - panel.contentLayoutRect.height
        let maximum = (visibleFrame?.height ?? 900) - titlebarHeight - 24
        let minimum = min(layout.minimumHeight, maximum)
        panel.contentMinSize = NSSize(width: QuickLookupLayout.minimumWidth, height: minimum)
        panel.setContentSize(
            NSSize(
                width: max(
                    QuickLookupLayout.minimumWidth,
                    panel.contentView?.bounds.width ?? QuickLookupLayout.defaultWidth),
                height: max(minimum, min(layout.preferredHeight, maximum))))
        var origin = NSPoint(x: panel.frame.minX, y: top - panel.frame.height)
        if let frame = visibleFrame {
            origin.y = max(frame.minY, min(origin.y, frame.maxY - panel.frame.height))
        }
        panel.setFrameOrigin(origin)
    }

    func newQuery() {
        guard !model.busy, !model.launcherPending else { return }
        launcherError = nil
        model.newQuery()
        presentation += 1
    }

    func showMain(settings: Bool = false, section: AppModel.SettingsSection = .configuration) {
        hide()
        openMain?()
        NSApp.activate(ignoringOtherApps: true)
        if settings { model.openSettings(section) }
    }

    func shutdown() {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        if let eventHandler { RemoveEventHandler(eventHandler) }
        if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
        hotKey = nil
        eventHandler = nil
        keyMonitor = nil
        panel?.orderOut(nil)
        panel?.contentView = nil
        panel = nil
    }
}

private final class QuickLookupPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}
