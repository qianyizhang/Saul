import SwiftUI

/// Shared glyphs keep their complete names even when the visible title is omitted.
struct ControlLabel: View {
    let symbol: ControlSymbol
    var title: String? = nil
    var iconOnly = true
    var body: some View {
        if iconOnly {
            Label(title ?? symbol.label, systemImage: symbol.systemImage).labelStyle(.iconOnly)
        } else {
            Text(title ?? symbol.label)
        }
    }
}
