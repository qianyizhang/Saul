import SwiftUI

enum AppStyle {
    static let accent = DesignTokens.primary
    static let waitingActivity = Color.yellow
    static let subject = DesignTokens.subject
    static let body = DesignTokens.body
    static let caption = DesignTokens.caption
    static let secondaryText = DesignTokens.muted
    static let composerRadius = DesignTokens.radiusComposer
    static let controlRadius = DesignTokens.radiusControl
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
                    .padding(.leading, 20)
            }
        }
    }
}
