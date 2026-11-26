import AppKit
import EZCore
import Foundation
import SaulNativeValues

/// One draft shared by the main window and Quick Lookup. Reading history is independent.
struct LookupDraft {
    enum Source {
        case configured
        case reused(HistoryEntry)
    }

    private(set) var selectedActionID: UUID?
    private(set) var source: Source = .configured
    private(set) var presetOverride: UUID?
    private(set) var formatOverride: String?
    private(set) var values: [String: String] = [:]
    private(set) var attachment: ImageAttachment?
    private(set) var sketch = SketchDraft()
    private(set) var revision = 0
    private var imageImportID = UUID()

    var reusedEntry: HistoryEntry? {
        if case .reused(let entry) = source { return entry }
        return nil
    }

    func action(in configuration: Configuration) -> Action? {
        reusedEntry?.actionSnapshot ?? configuration.actions.first { $0.id == selectedActionID }
    }

    func preset(in configuration: Configuration) -> ModelPreset? {
        if let presetOverride { return configuration.presets.first { $0.id == presetOverride } }
        if let saved = reusedEntry?.presetSnapshot { return saved }
        let id = action(in: configuration)?.presetID
        return configuration.presets.first { $0.id == id }
    }

    mutating func reset(actionID: UUID?) {
        selectedActionID = actionID
        source = .configured
        presetOverride = nil
        formatOverride = nil
        values = [:]
        clearImage()
        revision += 1
    }

    mutating func reuse(_ entry: HistoryEntry) {
        source = .reused(entry)
        presetOverride = nil
        formatOverride = nil
        values = entry.inputValues ?? [:]
        clearImage()
        revision += 1
    }

    mutating func choosePreset(_ id: UUID?) {
        presetOverride = id
        formatOverride = nil
    }

    mutating func setValue(_ value: String, for field: String) {
        values[field] = value.isEmpty ? nil : value
    }

    mutating func setValues(_ values: [String: String]) { self.values = values }

    mutating func setFormat(_ format: String) { formatOverride = format }

    mutating func retainFields(_ fields: [String]) {
        values = values.filter { fields.contains($0.key) }
    }

    mutating func beginImageImport() -> UUID {
        imageImportID = UUID()
        return imageImportID
    }

    func acceptsImageImport(_ id: UUID) -> Bool { imageImportID == id }

    mutating func clearImage() {
        _ = beginImageImport()
        attachment = nil
        sketch = SketchDraft()
    }

    mutating func attach(_ image: ImageAttachment?, asSketch: Bool) throws {
        if asSketch {
            var scene = sketch.scene
            scene.photo = try image.map(SketchPhoto.init)
            updateSketch { $0.commit(scene) }
        } else {
            attachment = image
        }
    }

    mutating func restoreImage(_ image: ImageAttachment, sketchPhoto: SketchPhoto?) {
        if let sketchPhoto {
            sketch = SketchDraft(restoring: sketchPhoto)
        } else {
            attachment = image
        }
    }

    mutating func updateSketch(_ update: (inout SketchDraft) -> Void) {
        let previous = sketch.scene.photo?.asset.id
        update(&sketch)
        if sketch.scene.photo?.asset.id != previous { _ = beginImageImport() }
    }
}

extension LookupSession {
    func attachImage(url: URL) {
        beginImageImport()
        guard url.isFileURL else {
            inputImageError = "Choose an image on this Mac."
            return
        }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? Int.max
            guard size <= ImageAttachment.byteLimit else { throw EZError("Choose an image up to 20 MB.") }
            attachImage(data: try Data(contentsOf: url), name: url.lastPathComponent)
        } catch { inputImageError = error.localizedDescription }
    }

    func attachImage(data: Data, name: String) {
        beginImageImport()
        guard !busy, !launcherPending, currentAction?.imageInput != nil else { return }
        do {
            try setImageInput(ImageAttachment(data: data, name: name))
            inputImageError = nil
        } catch { inputImageError = error.localizedDescription }
    }
}
