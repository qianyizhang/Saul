import EZCore
import SwiftUI

struct PresetPicker: View {
    @ObservedObject var model: AppModel
    var showsLabel = true
    var showsSpeed = false
    private var options: [SelectorOption<String>] {
        var items: [SelectorOption<String>] = []
        if let saved = model.replayEntry?.presetSnapshot {
            items.append(.init(value: "saved", title: presetTitle(saved, saved: true)))
        }
        items += model.configuration.presets.map {
            .init(value: $0.id.uuidString, title: presetTitle($0))
        }
        if model.currentPreset == nil { items.append(.init(value: "", title: "No preset")) }
        return items
    }
    private func presetTitle(_ preset: ModelPreset, saved: Bool = false) -> String {
        let name = saved ? "Saved: \(preset.name)" : preset.name
        guard showsSpeed else { return name }
        let override = !saved && model.overridePresetID == preset.id ? " · Override" : ""
        return name + override + (preset.fast ? " · Fast requested" : " · Normal")
    }
    var body: some View {
        SelectorPicker(
            "Preset", options: options,
            selection: Binding(
                get: {
                    model.replayEntry != nil && model.overridePresetID == nil
                        ? "saved" : model.currentPreset?.id.uuidString ?? ""
                }, set: { model.choosePreset(UUID(uuidString: $0)) }), showsLabel: showsLabel
        )
        .disabled(model.busy || model.connecting || model.signingIn || model.launcherPending)
    }
}

struct RequestControls: View {
    @ObservedObject var model: AppModel
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            PresetPicker(model: model).frame(maxWidth: 260)
            if let preset = model.currentPreset {
                Text(
                    "\(model.currentModel?.displayName ?? preset.model) · \(preset.effort.isEmpty ? "Default effort" : preset.effort.capitalized) · \(preset.fast ? "Fast requested" : "Normal")"
                )
                .font(AppStyle.caption).foregroundStyle(AppStyle.secondaryText).lineLimit(2)
            }
        }.controlSize(.small)
            .disabled(model.busy || model.connecting || model.signingIn || model.launcherPending)
    }
}

struct RecipePicker: View {
    @ObservedObject var model: AppModel
    var showsLabel = true
    private var options: [SelectorOption<String>] {
        var items: [SelectorOption<String>] = []
        if let saved = model.replayEntry?.recipeSnapshot {
            items.append(.init(value: "saved", title: "Saved: \(saved.name)", symbol: saved.symbol))
        }
        items += model.configuration.recipes.map {
            .init(value: $0.id.uuidString, title: $0.name, symbol: $0.symbol)
        }
        if model.currentRecipe == nil {
            items.append(.init(value: "", title: "No recipes — open Configuration"))
        }
        return items
    }
    var body: some View {
        SelectorPicker(
            "Recipe", options: options,
            selection: Binding(
                get: { model.replayEntry != nil ? "saved" : model.selectedRecipeID?.uuidString ?? "" },
                set: { value in
                    guard value != "saved" else { return }
                    model.chooseRecipe(UUID(uuidString: value))
                }), showsLabel: showsLabel
        )
        .disabled(model.busy || model.launcherPending)
    }
}

struct RecipeInputs: View {
    @ObservedObject var model: AppModel
    var compact = false
    var presentation = 0
    var onConfigure: (() -> Void)? = nil
    @FocusState private var focusedField: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if model.inputFields.isEmpty {
                Button("Configure recipes") {
                    if let onConfigure { onConfigure() } else { model.openSettings() }
                }
            } else {
                ScrollView {
                    VStack(spacing: 8) {
                        ForEach(model.inputFields, id: \.self) { field in
                            TextField(
                                field,
                                text: Binding(
                                    get: { model.inputValues[field] ?? "" },
                                    set: { model.inputValues[field] = $0 }), axis: .vertical
                            )
                            .textFieldStyle(.roundedBorder).lineLimit(2...(compact ? 3 : 4))
                            .font(.system(size: 14)).accessibilityLabel(field)
                            .focused($focusedField, equals: field)
                        }
                    }
                }.frame(
                    height: compact
                        ? QuickLookupLayout.inputHeight(fieldCount: model.inputFields.count)
                        : min(220, CGFloat(model.inputFields.count) * 62))
            }
            if !compact, let issue = model.requestIssue, model.planEnabled, !model.models.isEmpty {
                Text(issue).font(AppStyle.caption).foregroundStyle(AppStyle.secondaryText)
            }
        }
        .disabled(model.busy || model.launcherPending)
        .onAppear { focusInput() }
        .onChange(of: presentation) { _, _ in focusInput() }
        .onChange(of: model.draftRevision) { _, _ in focusInput() }
        .onChange(of: model.inputFields) { _, _ in focusInput() }
        .onChange(of: model.busy) { _, busy in if !busy { focusInput() } }
    }

    private func focusInput() {
        Task { @MainActor in
            focusedField = nil
            // Recipe changes replace the fields; focus after the new controls exist.
            await Task.yield()
            guard !model.busy, !model.launcherPending,
                compact == (NSApp.keyWindow is NSPanel)
            else { return }
            focusedField = model.inputFields.first
        }
    }
}
