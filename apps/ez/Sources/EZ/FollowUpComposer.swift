import EZCore
import SwiftUI

/// The same per-answer draft is used in Quick Lookup and the main window.
struct FollowUpComposer: View {
    @ObservedObject var model: AppModel
    let entry: HistoryEntry
    @FocusState private var focused: Bool

    var body: some View {
        if entry.sourceID == nil && entry.status == "completed" && !entry.response.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("Ask a follow-up").font(AppStyle.caption).foregroundStyle(.secondary)
                HStack(alignment: .bottom, spacing: 8) {
                    TextField(
                        "Question",
                        text: Binding(
                            get: { model.followUpDrafts[entry.id] ?? "" },
                            set: { model.followUpDrafts[entry.id] = $0 }
                        ), axis: .vertical
                    )
                    .lineLimit(1...4).textFieldStyle(.roundedBorder)
                    .accessibilityLabel("Ask a follow-up")
                    .focused($focused)
                    .onChange(of: focused) { _, focused in
                        if focused {
                            model.followUpTargetID = entry.id
                        } else if model.followUpTargetID == entry.id {
                            model.followUpTargetID = nil
                        }
                    }
                    .onDisappear {
                        if model.followUpTargetID == entry.id { model.followUpTargetID = nil }
                    }
                    .disabled(model.busy)
                    Button("Send") { model.followUp(entry.id) }
                        .accessibilityLabel("Send follow-up")
                        .disabled(
                            !model.canFollowUp
                                || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                || draft.utf16.count > 2_000)
                }
                if draft.utf16.count > 2_000 {
                    Text("Use up to 2,000 characters.").font(AppStyle.caption).foregroundStyle(.red)
                }
            }
        }
    }
    private var draft: String { model.followUpDrafts[entry.id] ?? "" }
}
