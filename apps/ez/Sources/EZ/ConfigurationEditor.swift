import EZCore
import Foundation
import SaulNativeValues

/// The two Settings drafts are independent; navigation and Save work on their captured originals.
@MainActor struct ConfigurationEditor {
    enum Destination {
        case preset(ModelPreset)
        case action(Action)
        case reload
    }

    private var originalPreset: ModelPreset?
    private var originalAction: Action?
    var preset: ModelPreset?
    var action: Action?
    private(set) var presetMessage: String?
    private(set) var actionMessage: String?
    private var pending: Destination?

    var presetIsDirty: Bool { preset != originalPreset }
    var actionIsDirty: Bool { action != originalAction }
    var hasUnsavedChanges: Bool { presetIsDirty || actionIsDirty }
    var needsDiscard: Bool { pending != nil }

    mutating func open(_ configuration: Configuration) {
        if preset == nil { setPreset(configuration.presets.first, in: configuration) }
        if action == nil { setAction(configuration.actions.first, in: configuration) }
    }

    mutating func syncSavedPreset(_ configuration: Configuration) {
        guard !presetIsDirty, let id = preset?.id,
            let saved = configuration.presets.first(where: { $0.id == id }), saved != originalPreset
        else { return }
        setPreset(saved, in: configuration)
    }

    mutating func request(_ destination: Destination, model: AppModel) {
        let dirty: Bool
        switch destination {
        case .preset(let next):
            guard next.id != preset?.id else { return }
            dirty = presetIsDirty
        case .action(let next):
            guard next.id != action?.id else { return }
            dirty = actionIsDirty
        case .reload:
            dirty = hasUnsavedChanges
        }
        if dirty {
            pending = destination
        } else {
            apply(destination, model: model)
        }
    }

    mutating func keepEditing() { pending = nil }

    mutating func discardAndContinue(model: AppModel) {
        guard let pending else { return }
        self.pending = nil
        apply(pending, model: model)
    }

    private mutating func apply(_ destination: Destination, model: AppModel) {
        switch destination {
        case .preset(let next): setPreset(next, in: model.configuration)
        case .action(let next): setAction(next, in: model.configuration)
        case .reload:
            model.refreshConfiguration()
            guard model.configurationError == nil else { return }
            setPreset(model.configuration.presets.first, in: model.configuration)
            setAction(model.configuration.actions.first, in: model.configuration)
        }
    }

    mutating func savePreset(model: AppModel) {
        guard var item = preset, presetIsDirty else { return }
        item.name = item.name.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            guard !item.model.isEmpty else { throw EZError("Choose a model before saving this preset.") }
            var updated = model.configuration
            let index = updated.presets.firstIndex { $0.id == item.id }
            guard index.map({ updated.presets[$0] }) == originalPreset else { throw changed("preset") }
            if let index { updated.presets[index] = item } else { updated.presets.append(item) }
            try model.saveConfiguration(updated)
            setPreset(model.configuration.presets.first { $0.id == item.id }, in: model.configuration)
            presetMessage = "Preset saved."
        } catch { presetMessage = error.localizedDescription }
    }

    mutating func saveAction(model: AppModel) {
        guard var item = action, actionIsDirty else { return }
        item.name = item.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if item.capability != .write { item.webSearch = false }
        if item.capability != .draw { item.imageInput = nil }
        do {
            var updated = model.configuration
            guard
                updated.presets.contains(where: { $0.id == item.presetID && $0.capability == item.capability }
                )
            else { throw EZError("Choose an available default preset before saving this action.") }
            let index = updated.actions.firstIndex { $0.id == item.id }
            guard index.map({ updated.actions[$0] }) == originalAction else { throw changed("action") }
            if let index { updated.actions[index] = item } else { updated.actions.append(item) }
            try model.saveConfiguration(updated)
            setAction(model.configuration.actions.first { $0.id == item.id }, in: model.configuration)
            actionMessage = "Action saved."
        } catch { actionMessage = error.localizedDescription }
    }

    mutating func removePreset(model: AppModel) {
        guard let originalPreset else { return }
        do {
            var updated = model.configuration
            guard updated.presets.first(where: { $0.id == originalPreset.id }) == originalPreset
            else { throw changed("preset") }
            let references = updated.actions.filter { $0.presetID == originalPreset.id }.map(\.name)
            guard references.isEmpty else {
                throw EZError(
                    "Change the default preset of \(references.joined(separator: ", ")) before removing this preset."
                )
            }
            updated.presets.removeAll { $0.id == originalPreset.id }
            try model.saveConfiguration(updated)
            setPreset(model.configuration.presets.first, in: model.configuration)
            presetMessage = "Preset removed."
        } catch { presetMessage = error.localizedDescription }
    }

    mutating func removeAction(model: AppModel) {
        guard let originalAction else { return }
        do {
            var updated = model.configuration
            guard updated.actions.first(where: { $0.id == originalAction.id }) == originalAction
            else { throw changed("action") }
            updated.actions.removeAll { $0.id == originalAction.id }
            try model.saveConfiguration(updated)
            setAction(model.configuration.actions.first, in: model.configuration)
            actionMessage = "Action removed."
        } catch { actionMessage = error.localizedDescription }
    }

    private func changed(_ item: String) -> EZError {
        EZError("This \(item) changed since you opened it. Reload saved settings before editing it again.")
    }

    private mutating func setPreset(_ item: ModelPreset?, in configuration: Configuration) {
        preset = item
        originalPreset = configuration.presets.first { $0.id == item?.id }
        presetMessage = nil
    }

    private mutating func setAction(_ item: Action?, in configuration: Configuration) {
        action = item
        originalAction = configuration.actions.first { $0.id == item?.id }
        actionMessage = nil
    }
}
