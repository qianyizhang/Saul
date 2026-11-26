import EZCore
import SaulNativeValues
import SwiftUI

/// The same per-answer draft is used in Quick Lookup and the main window.
struct FollowUpComposer: View {
    @ObservedObject var lookup: LookupSession
    let entry: HistoryEntry
    @FocusState private var focused: Bool

    var body: some View {
        if entry.sourceID == nil && entry.capability == .write && entry.status == "completed"
            && !entry.response.isEmpty
        {
            VStack(alignment: .leading, spacing: 6) {
                Text("Ask a follow-up").font(AppStyle.control).foregroundStyle(.secondary)
                HStack(alignment: .bottom, spacing: 8) {
                    TextField(
                        "",
                        text: Binding(
                            get: { lookup.followUpDrafts[entry.id] ?? "" },
                            set: { lookup.followUpDrafts[entry.id] = $0 }
                        ), axis: .vertical
                    )
                    .lineLimit(1...4).notebookEditor(focused: focused)
                    .accessibilityLabel("Ask a follow-up")
                    .focused($focused)
                    .multilineDraftReturn()
                    .onChange(of: focused) { _, focused in
                        if focused {
                            lookup.followUpTargetID = entry.id
                        } else if lookup.followUpTargetID == entry.id {
                            lookup.followUpTargetID = nil
                        }
                    }
                    .onDisappear {
                        if lookup.followUpTargetID == entry.id { lookup.followUpTargetID = nil }
                    }
                    .disabled(lookup.busy)
                    Button {
                        lookup.followUp(entry.id)
                    } label: {
                        ControlLabel(symbol: .send)
                    }
                    .help("Send follow-up").accessibilityLabel("Send follow-up")
                    .disabled(
                        !lookup.canFollowUp
                            || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            || draft.utf16.count > 2_000)
                }
                if draft.utf16.count > 2_000 {
                    Text("Use up to 2,000 characters.").font(AppStyle.caption).foregroundStyle(.red)
                }
            }
        }
    }
    private var draft: String { lookup.followUpDrafts[entry.id] ?? "" }
}
