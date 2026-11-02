import EZCore
import SwiftUI

struct UnsavedAttemptNotice: View {
    @ObservedObject var model: AppModel
    let entry: HistoryEntry

    var body: some View {
        if let message = model.saveError(for: entry.id) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Label("Unsaved", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange)
                    Spacer()
                    Button(model.minimumMode ? "Save" : "Save again") { model.saveAgain(entry.id) }.help(
                        "Save again"
                    ).accessibilityLabel("Save again")
                        .disabled(!model.canSaveAgain)
                    Button("Export…") { model.export(entry) }
                }
                Text("Save or export this answer before quitting EZ.")
                    .foregroundStyle(.secondary)
                DisclosureGroup("Error") {
                    Text(message).textSelection(.enabled).padding(.top, 4)
                }.disclosureGroupStyle(FullRowDisclosureStyle())
            }
            .font(AppStyle.caption).controlSize(.small)
            .padding(10)
            .background(Color.orange.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
        }
    }
}
