import AppKit
import EZCore
import SwiftUI

struct InputOutputInspector: View {
    let entry: HistoryEntry
    var minimum = false

    var body: some View {
        DisclosureGroup("Inspect") {
            VStack(alignment: .leading, spacing: 12) {
                Text(entry.status.capitalized)
                    .font(AppStyle.caption).foregroundStyle(.secondary)
                if !minimum {
                    Text(
                        entry.status == "unsaved"
                            ? "This answer has not been saved. Input fields are included in the assembled prompt."
                            : entry.status == "pending"
                                ? "Text for this running lookup. Input fields are included in the assembled prompt."
                                : "Saved text for this lookup. Input fields are included in the assembled prompt."
                    )
                    .font(AppStyle.caption).foregroundStyle(.secondary)
                }
                if let error = entry.error {
                    Text(error).font(AppStyle.caption).foregroundStyle(.red)
                }
                if let instructions = entry.instructions {
                    InspectionTextBlock(label: "Instructions", text: instructions)
                } else {
                    Text(
                        "Legacy instructions were not saved with this lookup. The exact instruction text is unavailable."
                    )
                    .font(AppStyle.caption).foregroundStyle(.secondary)
                }
                DisclosureGroup("Inputs") {
                    if let values = entry.inputValues, !values.isEmpty {
                        ForEach(values.keys.sorted(), id: \.self) { field in
                            InspectionTextBlock(label: field, text: values[field] ?? "")
                        }
                    } else {
                        Text("No separate input fields were recorded. See the saved prompt below.")
                            .font(AppStyle.caption).foregroundStyle(.secondary)
                    }
                }
                if let image = entry.inputImage {
                    MetadataRow("Input image", value: "\(image.name) · \(image.mediaType)")
                }
                InspectionTextBlock(label: "Prompt · user", text: entry.query)
                if entry.capability == .draw {
                    Text(
                        entry.hasImage
                            ? "Response · \(entry.imageOptions.outputFormat.uppercased()) image"
                            : "No image returned."
                    ).font(
                        AppStyle.caption)
                } else {
                    InspectionTextBlock(label: "Response · raw text", text: entry.response, response: true)
                }
            }.padding(.top, 8)
        }
        .font(AppStyle.caption)
        .textSelection(.enabled)
        .disclosureGroupStyle(FullRowDisclosureStyle())
    }
}

private struct InspectionTextBlock: View {
    let label: String
    let text: String
    var response = false
    @State private var notice = ""
    @State private var copiedText: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(label).font(AppStyle.caption.weight(.semibold))
                Spacer()
                Button("Copy") {
                    copiedText = text
                    NSPasteboard.general.clearContents()
                    notice =
                        NSPasteboard.general.setString(text, forType: .string)
                        ? "Copied" : "Could not copy. Select the text and copy it manually."
                }
                .buttonStyle(.borderless).disabled(text.isEmpty)
                .accessibilityLabel("Copy \(label)")
            }
            if copiedText == text && !notice.isEmpty {
                Text(notice).font(AppStyle.caption).foregroundStyle(.secondary)
            }
            if text.isEmpty {
                Text("No text recorded.").font(AppStyle.caption).foregroundStyle(.secondary)
            } else {
                Text(verbatim: text)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
        }
        .padding(12)
        .background(response ? AppStyle.accent.opacity(0.07) : Color.primary.opacity(0.035))
        .overlay(alignment: .leading) {
            Rectangle().fill(response ? AppStyle.accent : Color.secondary.opacity(0.3)).frame(width: 3)
        }
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .accessibilityElement(children: .contain)
    }
}
