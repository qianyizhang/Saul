import SwiftUI

/// The same control boundary in the main composer, reader and Quick Lookup.
struct AttemptControls: View {
    @ObservedObject var model: AppModel

    var body: some View {
        if model.preparingAttempt {
            Text("Saving request…").font(AppStyle.caption).foregroundStyle(.secondary)
        } else if model.savingAttempt {
            Text("Saving…").font(AppStyle.caption).foregroundStyle(.secondary)
        } else if model.discardingAttempt {
            Text("Finishing…").font(AppStyle.caption).foregroundStyle(.secondary)
        }
        if model.canStop {
            Button {
                model.stop()
            } label: {
                ControlLabel(symbol: .stop, iconOnly: model.minimumMode)
            }
            .accessibilityLabel("Stop lookup")
            .help("Stop lookup · \(model.shortcuts.binding(for: .stop).display)")
        }
    }
}
