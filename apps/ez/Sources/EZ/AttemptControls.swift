import SwiftUI

/// The same control boundary in the main composer, reader and Quick Lookup.
struct AttemptControls: View {
    @ObservedObject var model: AppModel
    @ObservedObject var lookup: LookupSession

    var body: some View {
        if lookup.preparingAttempt {
            Text("Saving request…").font(AppStyle.caption).foregroundStyle(.secondary)
        } else if lookup.savingAttempt {
            Text("Saving…").font(AppStyle.caption).foregroundStyle(.secondary)
        } else if lookup.discardingAttempt {
            Text("Finishing…").font(AppStyle.caption).foregroundStyle(.secondary)
        }
        if lookup.canStop {
            Button {
                lookup.stop()
            } label: {
                ControlLabel(symbol: .stop, iconOnly: model.minimumMode)
            }
            .accessibilityLabel("Stop lookup")
            .help("Stop lookup · \(model.shortcuts.binding(for: .stop).display)")
        }
    }
}
