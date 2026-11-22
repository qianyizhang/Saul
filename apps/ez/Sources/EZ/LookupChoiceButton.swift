import AppKit
import SwiftUI

struct LookupChoice: Equatable {
    let id: String
    let name: String
    var symbol: String? = nil
    var detail: String? = nil
    var badge: String? = nil
    var unavailable: String? = nil

    var summary: String { [name, badge, detail, unavailable].compactMap { $0 }.joined(separator: " · ") }

    func matches(_ search: String) -> Bool {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        return query.isEmpty
            || summary.range(of: query, options: [.caseInsensitive, .diacriticInsensitive]) != nil
    }
}

/// The same native button and transient chooser serve both lookup windows.
struct LookupChoiceButton: NSViewRepresentable {
    let role: String
    let options: [LookupChoice]
    let selection: String
    let choose: (String) -> Void
    @Environment(\.isEnabled) private var enabled

    func makeNSView(context: Context) -> ChoiceAnchor { ChoiceAnchor() }

    func updateNSView(_ view: ChoiceAnchor, context: Context) {
        view.configure(role: role, options: options, selection: selection, enabled: enabled, choose: choose)
    }
}

final class ChoiceAnchor: NSButton, NSPopoverDelegate {
    private static weak var active: ChoiceAnchor?
    static var hasOpenChooser: Bool { active?.popover.isShown == true }

    static func dismissChooser(in window: NSWindow?) {
        if active?.window === window { active?.popover.close() }
    }

    private let roleLabel = NSTextField(labelWithString: "")
    private let valueLabel = NSTextField(labelWithString: "")
    private let badgeLabel = NSTextField(labelWithString: "")
    private let popover = NSPopover()
    private var results: ChoiceResults? { popover.contentViewController as? ChoiceResults }
    private var role = ""
    private var options: [LookupChoice] = []
    private var selection = ""
    private var choose: ((String) -> Void)?
    private var wheel = WheelStepper()
    private var restoreFocus = false

    init() {
        super.init(frame: .zero)
        title = ""
        isBordered = false
        showsBorderOnlyWhileMouseInside = true
        focusRingType = .exterior
        target = self
        action = #selector(toggleChooser)
        setContentHuggingPriority(.defaultLow, for: .horizontal)
        setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        roleLabel.font = .systemFont(ofSize: DesignTokens.controlSize)
        valueLabel.font = .systemFont(ofSize: DesignTokens.controlSize, weight: .medium)
        valueLabel.lineBreakMode = .byTruncatingTail
        valueLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        badgeLabel.font = .systemFont(ofSize: DesignTokens.captionSize, weight: .semibold)
        let labels = NSStackView(views: [roleLabel, valueLabel])
        labels.orientation = .horizontal
        labels.alignment = .firstBaseline
        labels.spacing = DesignTokens.spaceSm
        let chevron = NSImageView()
        chevron.image = NSImage(systemSymbolName: "chevron.down", accessibilityDescription: nil)
        let accessories = NSStackView(views: [badgeLabel, chevron])
        accessories.spacing = 8
        for label in [roleLabel, valueLabel, badgeLabel, chevron] { label.setAccessibilityElement(false) }
        for group in [labels, accessories] {
            group.translatesAutoresizingMaskIntoConstraints = false
            group.setAccessibilityElement(false)
            addSubview(group)
        }
        NSLayoutConstraint.activate([
            labels.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 8),
            labels.trailingAnchor.constraint(lessThanOrEqualTo: accessories.leadingAnchor, constant: -8),
            labels.centerYAnchor.constraint(equalTo: centerYAnchor),
            accessories.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -8),
            accessories.centerYAnchor.constraint(equalTo: centerYAnchor),
            chevron.widthAnchor.constraint(equalToConstant: 10),
        ])

        popover.behavior = .transient
        popover.delegate = self
    }

    required init?(coder: NSCoder) { nil }

    func configure(
        role: String, options: [LookupChoice], selection: String, enabled: Bool,
        choose: @escaping (String) -> Void
    ) {
        self.choose = choose
        self.role = role
        let changed = self.options != options || self.selection != selection
        self.options = options
        self.selection = selection
        let selected = options.first { $0.id == selection }
        roleLabel.stringValue = selected?.unavailable == nil ? role : "\(role) · Unavailable"
        valueLabel.stringValue = selected?.name ?? (role == "Action" ? "No action" : "No preset")
        badgeLabel.stringValue = selected?.badge ?? ""
        badgeLabel.isHidden = badgeLabel.stringValue.isEmpty
        isEnabled = enabled && !options.isEmpty
        valueLabel.textColor = isEnabled ? .labelColor : .disabledControlTextColor
        roleLabel.textColor = isEnabled ? .secondaryLabelColor : .disabledControlTextColor
        badgeLabel.textColor = roleLabel.textColor
        setAccessibilityLabel(role)
        setAccessibilityValue(selected?.summary ?? valueLabel.stringValue)
        toolTip = [role, selected?.summary, isEnabled ? "Scroll to change" : nil]
            .compactMap { $0 }.joined(separator: " · ")
        if !isEnabled {
            popover.close()
        } else if changed {
            results?.update(options: options, selection: selection)
        }
    }

    // Treat label and padding as one native hit target.
    override func hitTest(_ point: NSPoint) -> NSView? { super.hitTest(point) == nil ? nil : self }
    override var acceptsFirstResponder: Bool { isEnabled }

    override func keyDown(with event: NSEvent) {
        if isEnabled, [36, 76].contains(event.keyCode),
            event.modifierFlags.intersection(.deviceIndependentFlagsMask)
                .subtracting([.numericPad, .function, .capsLock]).isEmpty
        {
            if !event.isARepeat { toggleChooser() }
        } else {
            super.keyDown(with: event)
        }
    }

    override func scrollWheel(with event: NSEvent) {
        guard isEnabled, !popover.isShown, options.count > 1,
            abs(event.scrollingDeltaY) >= abs(event.scrollingDeltaX)
        else {
            super.scrollWheel(with: event)
            return
        }
        guard let step = wheel.step(event) else { return }
        let index = options.firstIndex { $0.id == selection } ?? (step > 0 ? -1 : options.count)
        var next = index + step
        while options.indices.contains(next), options[next].unavailable != nil { next += step }
        if options.indices.contains(next) { choose?(options[next].id) }
    }

    @objc private func toggleChooser() {
        guard isEnabled, let window, window.isVisible else { return }
        if popover.isShown {
            finish()
            return
        }
        Self.active?.popover.close()
        let results = ChoiceResults(
            role: role,
            commit: { [weak self] in self?.finish(with: $0) },
            cancel: { [weak self] in self?.finish() })
        results.update(options: options, selection: selection)
        popover.contentViewController = results
        popover.contentSize = results.view.frame.size
        popover.show(relativeTo: bounds, of: self, preferredEdge: .maxY)
        Self.active = self
        results.focusSearch()
    }

    func popoverDidShow(_ notification: Notification) { results?.focusSearch() }

    private func finish(with choice: String? = nil) {
        restoreFocus = true
        popover.close()
        if let choice, choice != selection { choose?(choice) }
    }

    func popoverDidClose(_ notification: Notification) {
        if Self.active === self { Self.active = nil }
        if restoreFocus, let window, window.isVisible { window.makeFirstResponder(self) }
        restoreFocus = false
        popover.contentViewController = nil
    }
}

@MainActor
private final class ChoiceResults: NSViewController, NSSearchFieldDelegate, NSTableViewDataSource,
    NSTableViewDelegate
{
    private let role: String
    private let commit: (String) -> Void
    private let cancel: () -> Void
    private let search = NSSearchField()
    private let table = ChoiceResultsTable()
    private let empty = NSTextField(labelWithString: "No matches")
    private var options: [LookupChoice] = []
    private var selection = ""
    private var matches: [LookupChoice] = []

    init(role: String, commit: @escaping (String) -> Void, cancel: @escaping () -> Void) {
        self.role = role
        self.commit = commit
        self.cancel = cancel
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { nil }

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 354, height: 300))
        let title = NSTextField(labelWithString: "Choose \(role.lowercased())")
        title.font = .systemFont(ofSize: 13, weight: .semibold)
        search.placeholderString = "Search \(role.lowercased())s"
        search.setAccessibilityLabel(search.placeholderString)
        search.delegate = self
        table.setAccessibilityLabel("\(role) choices")
        table.headerView = nil
        table.rowHeight = 60
        table.selectionHighlightStyle = .regular
        table.backgroundColor = .clear
        table.dataSource = self
        table.delegate = self
        table.target = self
        table.action = #selector(clickedRow)
        table.keyAction = { [weak self] event in self?.handleKey(event.keyCode) ?? false }
        let column = NSTableColumn(identifier: .init("choice"))
        column.resizingMask = .autoresizingMask
        table.addTableColumn(column)
        table.columnAutoresizingStyle = .lastColumnOnlyAutoresizingStyle
        let list = NSScrollView()
        list.documentView = table
        list.hasVerticalScroller = true
        list.drawsBackground = false
        empty.textColor = .secondaryLabelColor
        for item in [title, search, list, empty] {
            item.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(item)
        }
        NSLayoutConstraint.activate([
            title.leadingAnchor.constraint(equalTo: search.leadingAnchor),
            title.topAnchor.constraint(equalTo: view.topAnchor, constant: 12),
            search.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 8),
            search.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            search.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
            list.topAnchor.constraint(equalTo: search.bottomAnchor, constant: 6),
            list.leadingAnchor.constraint(equalTo: search.leadingAnchor),
            list.trailingAnchor.constraint(equalTo: search.trailingAnchor),
            list.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -8),
            empty.centerXAnchor.constraint(equalTo: list.centerXAnchor),
            empty.centerYAnchor.constraint(equalTo: list.centerYAnchor),
        ])
    }

    func focusSearch() {
        view.window?.makeFirstResponder(search)
        if table.selectedRow >= 0 { table.scrollRowToVisible(table.selectedRow) }
    }

    func update(options: [LookupChoice], selection: String) {
        loadViewIfNeeded()
        let highlighted = matches.indices.contains(table.selectedRow) ? matches[table.selectedRow].id : nil
        self.options = options
        self.selection = selection
        reload(prefer: highlighted ?? selection)
    }

    private func reload(prefer id: String? = nil) {
        matches = options.filter { $0.matches(search.stringValue) }
        table.reloadData()
        empty.isHidden = !matches.isEmpty
        table.enclosingScrollView?.isHidden = matches.isEmpty
        let row =
            matches.firstIndex { $0.id == id && $0.unavailable == nil }
            ?? matches.firstIndex { $0.unavailable == nil }
        if let row {
            table.selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false)
            table.scrollRowToVisible(row)
        } else {
            table.deselectAll(nil)
        }
    }

    func controlTextDidChange(_ notification: Notification) { reload() }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
        guard !textView.hasMarkedText() else { return false }
        switch commandSelector {
        case #selector(NSResponder.moveUp(_:)): move(by: -1)
        case #selector(NSResponder.moveDown(_:)): move(by: 1)
        case #selector(NSResponder.insertNewline(_:)): select(table.selectedRow)
        case #selector(NSResponder.cancelOperation(_:)): cancel()
        default: return false
        }
        return true
    }

    private func handleKey(_ key: UInt16) -> Bool {
        switch key {
        case 126: move(by: -1)
        case 125: move(by: 1)
        case 36, 76, 49: select(table.selectedRow)
        case 53: cancel()
        default: return false
        }
        return true
    }

    private func move(by step: Int) {
        let start = table.selectedRow < 0 && step < 0 ? matches.count : table.selectedRow
        var row = start + step
        while matches.indices.contains(row), matches[row].unavailable != nil { row += step }
        guard matches.indices.contains(row) else { return }
        table.selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false)
        table.scrollRowToVisible(row)
    }

    @objc private func clickedRow() { select(table.clickedRow) }

    private func select(_ row: Int) {
        guard matches.indices.contains(row), matches[row].unavailable == nil else { return }
        commit(matches[row].id)
    }

    func numberOfRows(in tableView: NSTableView) -> Int { matches.count }

    func tableView(_ tableView: NSTableView, shouldSelectRow row: Int) -> Bool {
        matches[row].unavailable == nil
    }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let option = matches[row]
        let current = option.id == selection
        let icon = current ? "checkmark" : option.symbol
        let iconView = NSImageView()
        iconView.image = icon.flatMap { NSImage(systemSymbolName: $0, accessibilityDescription: nil) }
        iconView.contentTintColor = option.unavailable == nil ? .labelColor : .secondaryLabelColor
        iconView.widthAnchor.constraint(equalToConstant: 18).isActive = true
        let title = rowText(option.name)
        title.font = .systemFont(ofSize: DesignTokens.controlSize, weight: current ? .semibold : .regular)
        title.textColor = option.unavailable == nil ? .labelColor : .secondaryLabelColor
        let subtitle = rowText(
            [option.badge, option.unavailable == nil ? nil : "Unavailable", option.detail]
                .compactMap { $0 }.joined(separator: " · "))
        subtitle.font = .systemFont(ofSize: DesignTokens.captionSize)
        subtitle.textColor = .secondaryLabelColor
        let labels = NSStackView(views: [title, subtitle])
        labels.orientation = .vertical
        labels.alignment = .leading
        labels.spacing = 2
        subtitle.isHidden = subtitle.stringValue.isEmpty
        let cell = NSTableCellView()
        let content = NSStackView(views: [iconView, labels])
        content.spacing = 8
        content.translatesAutoresizingMaskIntoConstraints = false
        cell.addSubview(content)
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: cell.leadingAnchor, constant: 6),
            content.trailingAnchor.constraint(equalTo: cell.trailingAnchor, constant: -6),
            content.centerYAnchor.constraint(equalTo: cell.centerYAnchor),
            title.widthAnchor.constraint(lessThanOrEqualTo: labels.widthAnchor),
            subtitle.widthAnchor.constraint(lessThanOrEqualTo: labels.widthAnchor),
        ])
        cell.toolTip = option.summary
        cell.setAccessibilityLabel(option.summary + (current ? " · Current" : ""))
        cell.setAccessibilityEnabled(option.unavailable == nil)
        return cell
    }

    private func rowText(_ value: String) -> NSTextField {
        let label = NSTextField(wrappingLabelWithString: value)
        label.maximumNumberOfLines = 2
        label.cell?.truncatesLastVisibleLine = true
        // Leave room for the glyph, list insets, and the system scrollbar.
        label.preferredMaxLayoutWidth = 276
        return label
    }
}

private final class ChoiceResultsTable: NSTableView {
    var keyAction: ((NSEvent) -> Bool)?
    override func keyDown(with event: NSEvent) {
        if keyAction?(event) != true { super.keyDown(with: event) }
    }
}
