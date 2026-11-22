import AppKit
import EZCore
import SaulNativeValues
import SwiftUI

extension AppModel {
    func inspectionTitle(for entry: HistoryEntry) -> String {
        isTransientFailure(entry) || entry.status == "pending" || entry.status == "unsaved"
            ? "Request text" : "Saved text"
    }
}

struct InputOutputInspector: View {
    let entry: HistoryEntry
    let minimum: Bool
    let transientFailure: Bool

    private var textOrigin: String {
        if transientFailure { return "Text from the failed request." }
        switch entry.status {
        case "unsaved": return "This answer has not been saved."
        case "pending": return "Text for this running lookup."
        default: return "Saved text for this lookup."
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(entry.status.capitalized)
                .font(AppStyle.caption).foregroundStyle(.secondary)
            if !minimum {
                Text("\(textOrigin) Input fields are included in the assembled prompt.")
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
            if let values = entry.inputValues, !values.isEmpty {
                ForEach(values.keys.sorted(), id: \.self) { field in
                    InspectionTextBlock(label: "Input · \(field)", text: values[field] ?? "")
                }
            } else {
                Text("See the assembled prompt below for the input.")
                    .font(AppStyle.caption).foregroundStyle(.secondary)
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
                InspectionTextBlock(label: "Response · raw text", text: entry.response)
            }
        }
        .font(AppStyle.caption)
        .textSelection(.enabled)

    }
}

private struct InspectionTextBlock: View {
    let label: String
    let text: String

    @State private var notice = ""
    @State private var copiedText: String?
    @State private var findRequest = 0
    private var usesFindBar: Bool { text.utf8.count > 4000 }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(label).font(AppStyle.control).foregroundStyle(.secondary)
                Spacer()
                if usesFindBar {
                    Button("Find…") { findRequest += 1 }.buttonStyle(.borderless)
                        .accessibilityLabel("Find in \(label)")
                }
                Button {
                    copiedText = text
                    notice = TextClipboard.write(text) ? "Copied" : TextClipboard.failure
                } label: {
                    ControlLabel(symbol: .copy, title: "Copy \(label)")
                }
                .buttonStyle(.borderless).disabled(text.isEmpty)
                .help("Copy \(label)").accessibilityLabel("Copy \(label)")
            }
            if copiedText == text && !notice.isEmpty {
                Text(notice).font(AppStyle.caption).foregroundStyle(.secondary)
            }
            if text.isEmpty {
                Text("No text recorded.").font(AppStyle.caption).foregroundStyle(.secondary)
            } else if usesFindBar {
                SearchableInspectionText(text: text, label: label, findRequest: findRequest).frame(
                    height: 200)
            } else {
                Text(verbatim: text)
                    .font(AppStyle.body)
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

/// NSTextView provides literal selection and the native Find bar inside one bounded section.
private struct SearchableInspectionText: NSViewRepresentable {
    let text: String
    let label: String

    let findRequest: Int
    final class Coordinator { var lastRequest = 0 }
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSTextView.scrollableTextView()
        guard let view = scroll.documentView as? NSTextView else { return scroll }
        view.isEditable = false
        view.isRichText = false
        view.usesFindBar = true
        view.isIncrementalSearchingEnabled = true
        view.drawsBackground = false
        scroll.drawsBackground = false
        view.font = .systemFont(ofSize: DesignTokens.bodySize)
        view.textContainer?.lineFragmentPadding = 0
        return scroll
    }
    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let view = scroll.documentView as? NSTextView else { return }
        if view.string != text { view.string = text }
        view.setAccessibilityLabel(label)
        if context.coordinator.lastRequest != findRequest {
            context.coordinator.lastRequest = findRequest
            view.window?.makeFirstResponder(view)
            let item = NSMenuItem()
            item.tag = NSTextFinder.Action.showFindInterface.rawValue
            view.performTextFinderAction(item)
        }
    }
}
