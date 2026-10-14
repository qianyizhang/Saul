import EZCore
import SwiftUI

struct RequestControls: View {
    @ObservedObject var model: AppModel
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Picker(
                "Preset",
                selection: Binding(
                    get: {
                        model.replayEntry != nil && model.overridePresetID == nil
                            ? "saved" : model.currentPreset?.id.uuidString ?? ""
                    }, set: { model.choosePreset(UUID(uuidString: $0)) })
            ) {
                if let saved = model.replayEntry?.presetSnapshot {
                    Text("Saved: \(saved.name)").tag("saved")
                }
                ForEach(model.configuration.presets) { Text($0.name).tag($0.id.uuidString) }
                if model.currentPreset == nil { Text("No preset").tag("") }
            }.frame(maxWidth: 230)
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
    var body: some View {
        Picker(
            "Recipe",
            selection: Binding(
                get: { model.replayEntry != nil ? "saved" : model.selectedRecipeID?.uuidString ?? "" },
                set: { model.chooseRecipe(UUID(uuidString: $0)) })
        ) {
            if let saved = model.replayEntry?.recipeSnapshot {
                Text("Saved: \(saved.name)").tag("saved")
            }
            ForEach(model.configuration.recipes) { recipe in
                Label(recipe.name, systemImage: recipe.symbol).tag(recipe.id.uuidString)
            }
            if model.currentRecipe == nil { Text("No recipes — open Configuration").tag("") }
        }.disabled(model.busy || model.launcherPending)
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
