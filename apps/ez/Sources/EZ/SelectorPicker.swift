import AppKit
import SwiftUI

struct SelectorOption<Value: Equatable>: Equatable {
    var value: Value
    var title: String
    var symbol: String? = nil
    var enabled = true
}

/// The native control fills the allocated width; its title never determines the hitbox.
struct SelectorPicker<Value: Equatable>: View {
    let title: String
    var options: [SelectorOption<Value>]
    var selection: Binding<Value>
    var showsLabel = true

    init(
        _ title: String, options: [SelectorOption<Value>], selection: Binding<Value>, showsLabel: Bool = true
    ) {
        self.title = title
        self.options = options
        self.selection = selection
        self.showsLabel = showsLabel
    }

    var body: some View {
        HStack(spacing: 8) {
            if showsLabel { Text(title).frame(width: 100, alignment: .leading) }
            NativeSelector(title: title, options: options, selection: selection)
                .frame(minWidth: 130, maxWidth: .infinity).frame(height: 24)
        }
    }
}

private struct NativeSelector<Value: Equatable>: NSViewRepresentable {
    var title: String
    var options: [SelectorOption<Value>]
    var selection: Binding<Value>
    @Environment(\.isEnabled) private var enabled

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeNSView(context: Context) -> WheelPopUpButton {
        let view = WheelPopUpButton(frame: .zero, pullsDown: false)
        view.menu?.autoenablesItems = false
        view.controlSize = .small
        view.font = .systemFont(ofSize: NSFont.smallSystemFontSize)
        view.target = context.coordinator
        view.action = #selector(Coordinator.changed(_:))
        view.setContentHuggingPriority(.defaultLow, for: .horizontal)
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.cell?.lineBreakMode = .byTruncatingTail
        return view
    }
    func updateNSView(_ view: WheelPopUpButton, context: Context) {
        context.coordinator.parent = self
        if context.coordinator.options != options {
            view.removeAllItems()
            for option in options {
                // addItem(withTitle:) deduplicates equal titles; menu items must retain distinct values.
                let item = NSMenuItem(title: option.title, action: nil, keyEquivalent: "")
                item.isEnabled = option.enabled
                if let symbol = option.symbol {
                    item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
                }
                view.menu?.addItem(item)
            }
            context.coordinator.options = options
        }
        view.selectItem(at: options.firstIndex { $0.value == selection.wrappedValue } ?? -1)
        view.isEnabled = enabled && !options.isEmpty
        view.setAccessibilityLabel(title)
        view.toolTip = "\(title) · Scroll to change"
    }
    @MainActor final class Coordinator: NSObject {
        var parent: NativeSelector
        var options: [SelectorOption<Value>] = []
        init(_ parent: NativeSelector) { self.parent = parent }
        @objc func changed(_ sender: NSPopUpButton) {
            guard parent.options.indices.contains(sender.indexOfSelectedItem),
                parent.options[sender.indexOfSelectedItem].enabled
            else { return }
            let value = parent.options[sender.indexOfSelectedItem].value
            guard parent.selection.wrappedValue != value else { return }
            parent.selection.wrappedValue = value
        }
    }
}

private struct WheelStepper {
    var accumulated: CGFloat = 0
    var lastStep: TimeInterval = -.infinity
    var lastEvent: TimeInterval = -.infinity

    mutating func step(_ event: NSEvent) -> Int? {
        guard event.momentumPhase.isEmpty else { return nil }
        if event.phase.contains(.began) || event.timestamp - lastEvent > 0.3 { accumulated = 0 }
        lastEvent = event.timestamp
        guard event.scrollingDeltaY != 0 else { return nil }
        if accumulated.sign != event.scrollingDeltaY.sign { accumulated = 0 }
        accumulated += event.scrollingDeltaY
        let threshold: CGFloat = event.hasPreciseScrollingDeltas ? 18 : 1
        guard abs(accumulated) >= threshold, event.timestamp - lastStep >= 0.16 else { return nil }
        let result = accumulated < 0 ? 1 : -1
        accumulated = 0
        lastStep = event.timestamp
        return result
    }
}

private final class WheelPopUpButton: NSPopUpButton {
    private var wheel = WheelStepper()
    override func scrollWheel(with event: NSEvent) {
        guard isEnabled, numberOfItems > 1, abs(event.scrollingDeltaY) >= abs(event.scrollingDeltaX) else {
            super.scrollWheel(with: event)
            return
        }
        guard let step = wheel.step(event) else { return }
        var next = indexOfSelectedItem + step
        while (0..<numberOfItems).contains(next), item(at: next)?.isEnabled != true { next += step }
        guard (0..<numberOfItems).contains(next), next != indexOfSelectedItem else { return }
        selectItem(at: next)
        sendAction(action, to: target)
    }
}

struct SettingsSectionPicker: NSViewRepresentable {
    @Binding var selection: AppModel.SettingsSection
    private let sections: [AppModel.SettingsSection] = [.configuration, .account, .shortcuts]
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeNSView(context: Context) -> NSSegmentedControl {
        let view = WheelSegmentedControl(
            labels: ["Configuration", "Account & history", "Shortcuts"], trackingMode: .selectOne,
            target: context.coordinator, action: #selector(Coordinator.changed(_:)))
        view.segmentDistribution = .fillEqually
        view.setAccessibilityLabel("Settings section")
        return view
    }
    func updateNSView(_ view: NSSegmentedControl, context: Context) {
        context.coordinator.parent = self
        view.selectedSegment = sections.firstIndex(of: selection) ?? 0
        view.selectedSegmentBezelColor = NSColor(AppStyle.accent)
    }
    @MainActor final class Coordinator: NSObject {
        var parent: SettingsSectionPicker
        init(_ parent: SettingsSectionPicker) { self.parent = parent }
        @objc func changed(_ sender: NSSegmentedControl) {
            guard parent.sections.indices.contains(sender.selectedSegment) else { return }
            parent.selection = parent.sections[sender.selectedSegment]
        }
    }
}

private final class WheelSegmentedControl: NSSegmentedControl {
    private var wheel = WheelStepper()
    override func scrollWheel(with event: NSEvent) {
        guard isEnabled, segmentCount > 1, abs(event.scrollingDeltaY) >= abs(event.scrollingDeltaX) else {
            super.scrollWheel(with: event)
            return
        }
        guard let step = wheel.step(event) else { return }
        let next = max(0, min(segmentCount - 1, selectedSegment + step))
        guard next != selectedSegment else { return }
        selectedSegment = next
        sendAction(action, to: target)
    }
}
