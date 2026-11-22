import SwiftUI

enum AppStyle {
    static let accent = DesignTokens.primary
    static let waitingActivity = Color.yellow
    static let subject = DesignTokens.subject
    static let body = DesignTokens.body
    static let control = DesignTokens.control
    static let rowHeight = DesignTokens.spaceControlRow
    static let caption = DesignTokens.caption
    static let secondaryText = DesignTokens.muted
    static let controlRadius = DesignTokens.radiusControl
}

extension View {
    func notebookEditor(focused: Bool) -> some View {
        textFieldStyle(.plain).font(AppStyle.body)
            .padding(.vertical, 4)
            .overlay(alignment: .bottom) {
                Rectangle().fill(focused ? AppStyle.accent : Color.secondary.opacity(0.35))
                    .frame(height: focused ? 2 : 1).allowsHitTesting(false)
            }
    }

    func notebookRow(selected: Bool) -> some View {
        font(AppStyle.control).padding(.horizontal, DesignTokens.spaceSm)
            .frame(minHeight: AppStyle.rowHeight)
            .background(
                selected ? Color.primary.opacity(0.08) : Color.clear,
                in: RoundedRectangle(cornerRadius: AppStyle.controlRadius)
            )
            .contentShape(Rectangle())
    }
}

/// Plain row buttons must include transparent label padding in their click target.
struct FullRowButton<Label: View>: View {
    let action: () -> Void
    @ViewBuilder var label: () -> Label

    var body: some View {
        Button(action: action) {
            label().contentShape(Rectangle())
        }.buttonStyle(.plain)
    }
}

/// Keep disclosure activation on the header, with a full-row mouse and keyboard target.
struct FullRowDisclosureStyle: DisclosureGroupStyle {
    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                configuration.isExpanded.toggle()
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: configuration.isExpanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 10, weight: .semibold)).frame(width: 12)
                        .accessibilityHidden(true)
                    configuration.label
                }
                .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(configuration.isExpanded ? "Expanded" : "Collapsed")
            if configuration.isExpanded {
                configuration.content
                    .disclosureGroupStyle(FullRowDisclosureStyle())

            }
        }
    }
}

/// A stable value column shared by request details and fixed shortcut references.
struct MetadataRow: View {
    let label: String
    let value: String

    init(_ label: String, value: String) {
        self.label = label
        self.value = value
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 16) {
            Text(label).foregroundStyle(AppStyle.secondaryText).frame(width: 108, alignment: .leading)
            Text(verbatim: value).foregroundStyle(.primary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(AppStyle.caption.monospacedDigit())
        .accessibilityElement(children: .combine)
    }
}

/// Familiar users get one word; explicit symbol-only controls retain their own labels.
struct EverydayLabelStyle: LabelStyle {
    let minimum: Bool
    @ViewBuilder func makeBody(configuration: Configuration) -> some View {
        if minimum {
            configuration.title
        } else {
            HStack {
                configuration.icon
                configuration.title
            }
        }
    }
}
