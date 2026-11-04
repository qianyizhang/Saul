import AppKit
import EZCore
import SwiftUI
import UniformTypeIdentifiers

struct ImageInputView: View {
    @ObservedObject var model: AppModel
    let label: String
    @State private var targeted = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(AppStyle.caption).foregroundStyle(AppStyle.secondaryText)
            HStack(spacing: 12) {
                if let attachment = model.inputImage, let data = attachment.data,
                    let image = NSImage(data: data)
                {
                    Image(nsImage: image).resizable().scaledToFit().frame(width: 76, height: 64)
                        .accessibilityLabel("Input image preview")
                    Text(attachment.name).font(AppStyle.caption).lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Text("Drop an image").font(AppStyle.caption).foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                }
                VStack(alignment: .trailing, spacing: 6) {
                    Button(model.inputImage == nil ? "Choose…" : "Replace…") { choose() }
                        .accessibilityLabel("Choose input image")
                    HStack {
                        Button("Paste") { paste() }.accessibilityLabel("Paste input image")
                        if model.inputImage != nil {
                            Button("Remove") {
                                model.inputImage = nil
                                model.inputImageError = nil
                            }
                            .accessibilityLabel("Remove input image")
                        }
                    }
                }
            }
            .padding(8).frame(minHeight: 72)
            .background(
                targeted ? AppStyle.accent.opacity(0.1) : Color.primary.opacity(0.035),
                in: RoundedRectangle(cornerRadius: 6)
            )
            .onDrop(of: [.fileURL, .png, .jpeg, .webP], isTargeted: $targeted, perform: drop)
            if let error = model.inputImageError {
                Text(error).font(AppStyle.caption).foregroundStyle(.orange).textSelection(.enabled)
            }
        }
    }

    private func choose() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.png, .jpeg, .webP]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        model.attachImage(url: url)
    }

    private func paste() {
        let pasteboard = NSPasteboard.general
        if let urls = pasteboard.readObjects(
            forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL],
            urls.count == 1, let url = urls.first
        {
            model.attachImage(url: url)
            return
        }
        for type in [UTType.png, .jpeg, .webP] {
            if let data = pasteboard.data(forType: .init(type.identifier)) {
                model.attachImage(data: data, name: "Pasted image")
                return
            }
        }
        if let data = pasteboard.data(forType: .tiff),
            let bitmap = NSBitmapImageRep(data: data),
            let png = bitmap.representation(using: .png, properties: [:])
        {
            model.attachImage(data: png, name: "Pasted image.png")
        } else {
            model.inputImageError = "Copy one image, then paste it here."
        }
    }

    private func drop(_ providers: [NSItemProvider]) -> Bool {
        guard providers.count == 1, let provider = providers.first else {
            model.inputImageError = "Drop one image at a time."
            return false
        }
        let revision = model.draftRevision
        let importID = UUID()
        model.imageImportID = importID
        if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
            provider.loadDataRepresentation(forTypeIdentifier: UTType.fileURL.identifier) { data, _ in
                Task { @MainActor in
                    guard model.draftRevision == revision, model.imageImportID == importID, !model.busy,
                        !model.launcherPending
                    else { return }
                    guard let data, let url = URL(dataRepresentation: data, relativeTo: nil) else {
                        model.inputImageError = "The dropped file could not be read."
                        return
                    }
                    model.attachImage(url: url)
                }
            }
            return true
        }
        guard
            let type = [UTType.png, .jpeg, .webP].first(where: {
                provider.hasItemConformingToTypeIdentifier($0.identifier)
            })
        else { return false }
        provider.loadDataRepresentation(forTypeIdentifier: type.identifier) { data, _ in
            Task { @MainActor in
                guard model.draftRevision == revision, model.imageImportID == importID, !model.busy,
                    !model.launcherPending
                else { return }
                if let data {
                    model.attachImage(data: data, name: "Dropped image")
                } else {
                    model.inputImageError = "The dropped image could not be read."
                }
            }
        }
        return true
    }
}
