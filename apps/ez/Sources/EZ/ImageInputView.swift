import AppKit
import EZCore
import SwiftUI
import UniformTypeIdentifiers

struct ImageInputView: View {
    @ObservedObject var model: AppModel
    let label: String
    var onEditSketch: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(AppStyle.caption).foregroundStyle(AppStyle.secondaryText)
            HStack(spacing: 12) {
                if model.usesSketch, model.hasImageInput {
                    SketchArtwork(scene: model.sketch.scene)
                        .frame(width: 64, height: 64).accessibilityLabel("Sketch preview")
                    Text(model.inputImage?.name ?? "Sketch ready").font(AppStyle.caption).lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else if let attachment = model.inputImage, let data = attachment.data,
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
                    if let onEditSketch {
                        Button("Edit sketch", action: onEditSketch)
                    } else {
                        Button(model.inputImage == nil ? "Choose…" : "Replace…") { ImageImport.choose(model) }
                            .accessibilityLabel("Choose input image")
                    }
                    HStack {
                        Button("Paste") { ImageImport.paste(model) }.accessibilityLabel("Paste input image")
                        if model.hasImageInput {
                            Button("Remove", action: model.removeImageInput)
                                .accessibilityLabel(model.usesSketch ? "Remove sketch" : "Remove input image")
                        }
                    }
                }
            }
            .padding(8).frame(minHeight: 72)
            .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 6))
            .modifier(ImageDropTarget(model: model))
            if let error = model.inputImageError {
                Text(error).font(AppStyle.caption).foregroundStyle(.orange).textSelection(.enabled)
            }
        }.disabled(model.busy || model.launcherPending)
    }
}

struct ImageDropTarget: ViewModifier {
    let model: AppModel
    @State private var targeted = false

    func body(content: Content) -> some View {
        content
            .overlay {
                if targeted {
                    RoundedRectangle(cornerRadius: 6).strokeBorder(AppStyle.accent, lineWidth: 2)
                        .allowsHitTesting(false)
                }
            }
            .onDrop(of: ImageImport.types, isTargeted: $targeted) { ImageImport.receive($0, model: model) }
    }
}

@MainActor enum ImageImport {
    static let types: [UTType] = [.fileURL, .png, .jpeg, .webP, .tiff]

    static func choose(_ model: AppModel) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.png, .jpeg, .webP]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        model.attachImage(url: url)
    }

    static func paste(_ model: AppModel) {
        model.beginImageImport()
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
        if let data = pasteboard.data(forType: .tiff), let png = tiffPNG(data) {
            model.attachImage(data: png, name: "Pasted image.png")
        } else {
            model.inputImageError = "Copy one image, then paste it here."
        }
    }

    static func receive(_ providers: [NSItemProvider], model: AppModel) -> Bool {
        guard !model.busy, !model.launcherPending else { return false }
        let importID = model.beginImageImport()
        guard providers.count == 1, let provider = providers.first else {
            model.inputImageError = "Drop one image at a time."
            return false
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
            provider.loadDataRepresentation(forTypeIdentifier: UTType.fileURL.identifier) { data, _ in
                Task { @MainActor in
                    model.finishImageImport(importID) {
                        guard let data, let url = URL(dataRepresentation: data, relativeTo: nil) else {
                            model.inputImageError = "The dropped file could not be read."
                            return
                        }
                        model.attachImage(url: url)
                    }
                }
            }
            return true
        }
        guard
            let type = [UTType.png, .jpeg, .webP, .tiff].first(where: {
                provider.hasItemConformingToTypeIdentifier($0.identifier)
            })
        else { return false }
        provider.loadDataRepresentation(forTypeIdentifier: type.identifier) { data, _ in
            Task { @MainActor in
                model.finishImageImport(importID) {
                    if let data, let image = type == .tiff ? tiffPNG(data) : data {
                        model.attachImage(data: image, name: "Imported image")
                    } else {
                        model.inputImageError = "The dropped image could not be read."
                    }
                }
            }
        }
        return true
    }

    private static func tiffPNG(_ data: Data) -> Data? {
        guard data.count <= ImageAttachment.byteLimit, let bitmap = NSBitmapImageRep(data: data),
            bitmap.pixelsWide > 0, bitmap.pixelsHigh > 0,
            bitmap.pixelsWide <= 8192, bitmap.pixelsHigh <= 8192,
            bitmap.pixelsWide * bitmap.pixelsHigh <= 40_000_000
        else { return nil }
        return bitmap.representation(using: .png, properties: [:])
    }
}
