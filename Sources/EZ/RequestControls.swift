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
    @State private var showDetails = false
    var body: some View {
        HStack(spacing: 6) {
            PresetPicker(model: model, showsLabel: false, showsSpeed: true).frame(width: 250)
            Button {
                showDetails.toggle()
            } label: {
                Image(systemName: "info.circle").frame(width: 24, height: 24)
                    .contentShape(Rectangle())
            }.buttonStyle(.borderless).help("Request details")
                .accessibilityLabel("Request details")
                .popover(isPresented: $showDetails) {
                    RequestDetails(model: model) {
                        showDetails = false
                        model.openSettings(.configuration)
                    }
                }
        }.controlSize(.small)
    }
}

struct RequestDetails: View {
    @ObservedObject var model: AppModel
    var onConfigure: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Next lookup").font(.headline)
            if let preset = model.currentPreset {
                Text(preset.name).font(.subheadline.weight(.medium))
                Text(
                    "\(model.currentModel?.displayName ?? preset.model) · \(preset.effort.isEmpty ? "Default effort" : preset.effort.capitalized) · \(preset.fast ? "Fast requested" : "Normal")"
                )
                .font(AppStyle.caption).textSelection(.enabled)
            }
            Text("A preset override lasts until New lookup or a recipe change.")
                .font(AppStyle.caption).foregroundStyle(.secondary)
            if model.fast {
                Text("Fast may use more plan allowance.").font(AppStyle.caption).foregroundStyle(.secondary)
            }
            if let entry = model.selectedEntry {
                Divider()
                Text("Displayed answer · \(entry.recipeName)").font(.subheadline.weight(.medium))
                Text("\(entry.model) · \(entry.effort.isEmpty ? "Default effort" : entry.effort)")
                    .font(AppStyle.caption).textSelection(.enabled)
                Text(entry.serviceDescription).font(AppStyle.caption).textSelection(.enabled)
            }
            Button("Edit presets & recipes…", action: onConfigure)
        }.padding(16).frame(width: 300, alignment: .leading)
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
                ScrollViewReader { proxy in
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
                                .id(field)
                            }
                        }
                    }
                    .onChange(of: focusedField) { _, field in
                        if let field { proxy.scrollTo(field) }
                    }
                }.frame(
                    height: compact
                        ? QuickLookupLayout.inputHeight(fieldCount: model.inputFields.count)
                        : min(180, CGFloat(model.inputFields.count) * 54))
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
