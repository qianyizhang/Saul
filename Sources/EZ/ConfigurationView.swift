import EZCore
import SwiftUI

struct ConfigurationView: View {
    @ObservedObject var model: AppModel
    @Binding var hasUnsavedChanges: Bool
    @State private var confirmSelection = false
    @State private var pendingSelection: (() -> Void)?
    @State private var preset: ModelPreset?
    @State private var recipe: Recipe?
    @State private var presetMessage: String?
    @State private var recipeMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Text("Name your model choices, then build the recipes you use.")
                    .font(AppStyle.body).foregroundStyle(.secondary)
                if let error = model.configurationError {
                    Text(error).font(AppStyle.caption).foregroundStyle(.red).textSelection(.enabled)
                }
                presetSection
                recipeSection
                Text(
                    "Saved on this Mac. Changes apply to new lookups; history keeps its original prompt and choices."
                )
                .font(AppStyle.caption).foregroundStyle(AppStyle.secondaryText)
            }.padding(24)
        }.onAppear {
            if preset == nil { preset = model.configuration.presets.first }
            if recipe == nil { recipe = model.configuration.recipes.first }
        }
        .onChange(of: presetIsDirty || recipeIsDirty, initial: true) { _, dirty in
            hasUnsavedChanges = dirty
        }
        .alert("Discard unsaved edits?", isPresented: $confirmSelection) {
            Button("Keep editing", role: .cancel) { pendingSelection = nil }
            Button("Discard edits", role: .destructive) {
                let change = pendingSelection
                pendingSelection = nil
                change?()
            }
        } message: {
            Text("Save this item before switching, or discard its edits.")
        }
    }

    private var presetSection: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Label("Model presets", systemImage: "slider.horizontal.3").font(.headline)
                    Spacer()
                    Button("Add preset", systemImage: "plus") {
                        let option = model.currentModel ?? model.models.first
                        selectPreset(
                            ModelPreset(
                                name: "New preset", model: option?.model ?? "",
                                effort: option?.supportedReasoningEfforts.isEmpty == false
                                    ? option!.quickEffort : "", fast: false))
                    }
                }
                HStack(alignment: .top, spacing: 18) {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(model.configuration.presets) { item in
                            Button {
                                selectPreset(item)
                            } label: {
                                Text(item.name).frame(maxWidth: .infinity, alignment: .leading).padding(6)
                                    .background(
                                        preset?.id == item.id ? AppStyle.accent.opacity(0.12) : .clear,
                                        in: RoundedRectangle(cornerRadius: 6))
                            }.buttonStyle(.plain)
                        }
                        if model.configuration.presets.isEmpty {
                            Text("No presets yet").foregroundStyle(.secondary)
                        }
                    }.frame(width: 145)
                    Divider()
                    if preset != nil {
                        presetEditor
                    } else {
                        Text("Add a preset to choose a model, effort, and speed.").foregroundStyle(.secondary)
                    }
                }
                if let message = presetMessage {
                    Text(message).font(AppStyle.caption).textSelection(.enabled)
                }
            }.padding(10)
        }.disabled(model.configurationLocked)
    }

    private var presetEditor: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("Name, e.g. lit", text: presetBinding(\.name)).textFieldStyle(.roundedBorder)
                .accessibilityLabel("Preset name")
            let modelSelection = Binding(
                get: { preset?.model ?? "" },
                set: { value in
                    preset?.model = value
                    if let option = model.models.first(where: { $0.model == value }) {
                        preset?.effort =
                            option.supportedReasoningEfforts.isEmpty ? "" : option.quickEffort
                        preset?.fast = false
                    }
                })
            let modelOptions: [SelectorOption<String>] =
                (model.models.contains(where: { $0.model == preset?.model })
                    ? []
                    : [
                        .init(
                            value: preset?.model ?? "",
                            title: preset?.model.isEmpty == false
                                ? "\(preset!.model) (unavailable)" : "Connect to choose a model")
                    ]) + model.models.map { .init(value: $0.model, title: $0.displayName) }
            SelectorPicker("Model", options: modelOptions, selection: modelSelection)
            let efforts =
                model.models.first { $0.model == preset?.model }?.supportedReasoningEfforts.map(
                    \.reasoningEffort) ?? []
            let effortOptions: [SelectorOption<String>] =
                (efforts.contains(preset?.effort ?? "")
                    ? []
                    : [
                        .init(
                            value: preset?.effort ?? "",
                            title: preset?.effort.isEmpty == false
                                ? "\(preset!.effort.capitalized) (unavailable)" : "Default")
                    ]) + efforts.map { .init(value: $0, title: $0.capitalized) }
            SelectorPicker("Effort", options: effortOptions, selection: presetBinding(\.effort))
            Toggle("Fast", isOn: presetBinding(\.fast)).toggleStyle(.checkbox)
            Text("Fast requests priority service and may use more plan allowance.")
                .font(AppStyle.caption).foregroundStyle(AppStyle.secondaryText)
            if let preset, let issue = preset.availabilityError(in: model.models) {
                Text(issue).font(AppStyle.caption).foregroundStyle(.orange)
            }
            HStack {
                Button("Save preset") { savePreset() }.buttonStyle(.borderedProminent).disabled(
                    !presetIsDirty)
                if presetIsDirty { Text("Unsaved edits").font(AppStyle.caption).foregroundStyle(.secondary) }
                Spacer()
                if model.configuration.presets.contains(where: { $0.id == preset?.id }) {
                    Button("Remove preset", role: .destructive) { removePreset() }
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private var recipeSection: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Label("Recipes", systemImage: "text.badge.plus").font(.headline)
                    Spacer()
                    Button("Add recipe", systemImage: "plus") {
                        guard let defaultPreset = model.configuration.presets.first else { return }
                        selectRecipe(
                            Recipe(name: "New recipe", presetID: defaultPreset.id, template: "{{text}}"))
                    }.disabled(model.configuration.presets.isEmpty)
                }
                HStack(alignment: .top, spacing: 18) {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(model.configuration.recipes) { item in
                            Button {
                                selectRecipe(item)
                            } label: {
                                Label(item.name, systemImage: item.symbol)
                                    .frame(maxWidth: .infinity, alignment: .leading).padding(6)
                                    .background(
                                        recipe?.id == item.id ? AppStyle.accent.opacity(0.12) : .clear,
                                        in: RoundedRectangle(cornerRadius: 6))
                            }.buttonStyle(.plain)
                        }
                        if model.configuration.recipes.isEmpty {
                            Text("No recipes yet").foregroundStyle(.secondary)
                        }
                    }.frame(width: 145)
                    Divider()
                    if recipe != nil {
                        recipeEditor
                    } else {
                        Text("Add a recipe with a prompt and a default preset.").foregroundStyle(.secondary)
                    }
                }
                if let message = recipeMessage {
                    Text(message).font(AppStyle.caption).textSelection(.enabled)
                }
            }.padding(10)
        }.disabled(model.configurationLocked)
    }

    private var recipeEditor: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("Recipe name", text: recipeBinding(\.name)).textFieldStyle(.roundedBorder)
            SelectorPicker(
                "Default preset",
                options: model.configuration.presets.map { .init(value: $0.id, title: $0.name) },
                selection: recipeBinding(\.presetID))
            Text("Prompt template").font(.subheadline.weight(.medium))
            TextEditor(text: recipeBinding(\.template)).font(.system(size: 12, design: .monospaced))
                .frame(height: 125).padding(6)
                .background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(.quaternary))
                .accessibilityLabel("Prompt template")
            Text("Use {{field name}} for each input. Repeated names share a field. All inputs are required.")
                .font(AppStyle.caption).foregroundStyle(AppStyle.secondaryText)
            if let template = try? PromptTemplate(recipe?.template ?? "") {
                DisclosureGroup(
                    "Input preview · \(template.fields.count) field\(template.fields.count == 1 ? "" : "s")"
                ) {
                    VStack(spacing: 8) {
                        ForEach(template.fields, id: \.self) { field in
                            TextField(field, text: .constant("")).textFieldStyle(.roundedBorder).disabled(
                                true)
                        }
                    }.padding(.top, 8)
                }.font(AppStyle.caption)
            } else {
                Text(templateError).font(AppStyle.caption).foregroundStyle(.orange)
            }
            HStack {
                Button("Save recipe") { saveRecipe() }.buttonStyle(.borderedProminent).disabled(
                    !recipeIsDirty)
                if recipeIsDirty { Text("Unsaved edits").font(AppStyle.caption).foregroundStyle(.secondary) }
                Spacer()
                if model.configuration.recipes.contains(where: { $0.id == recipe?.id }) {
                    Button("Remove recipe", role: .destructive) { removeRecipe() }
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private var presetIsDirty: Bool {
        guard let preset else { return false }
        return preset != model.configuration.presets.first { $0.id == preset.id }
    }
    private var recipeIsDirty: Bool {
        guard let recipe else { return false }
        return recipe != model.configuration.recipes.first { $0.id == recipe.id }
    }
    private func selectPreset(_ item: ModelPreset) {
        guard item.id != preset?.id else { return }
        let change = {
            preset = item
            presetMessage = nil
        }
        if presetIsDirty {
            pendingSelection = change
            confirmSelection = true
        } else {
            change()
        }
    }
    private func selectRecipe(_ item: Recipe) {
        guard item.id != recipe?.id else { return }
        let change = {
            recipe = item
            recipeMessage = nil
        }
        if recipeIsDirty {
            pendingSelection = change
            confirmSelection = true
        } else {
            change()
        }
    }

    private var templateError: String {
        do {
            _ = try PromptTemplate(recipe?.template ?? "")
            return ""
        } catch { return error.localizedDescription }
    }
    private func presetBinding<Value>(_ path: WritableKeyPath<ModelPreset, Value>) -> Binding<Value> {
        let original = preset![keyPath: path]
        return Binding(get: { preset?[keyPath: path] ?? original }, set: { preset?[keyPath: path] = $0 })
    }
    private func recipeBinding<Value>(_ path: WritableKeyPath<Recipe, Value>) -> Binding<Value> {
        let original = recipe![keyPath: path]
        return Binding(get: { recipe?[keyPath: path] ?? original }, set: { recipe?[keyPath: path] = $0 })
    }
    private func savePreset() {
        guard var item = preset else { return }
        item.name = item.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !item.model.isEmpty else {
            presetMessage = "Connect ChatGPT and choose a model first."
            return
        }
        var updated = model.configuration
        if let index = updated.presets.firstIndex(where: { $0.id == item.id }) {
            updated.presets[index] = item
        } else {
            updated.presets.append(item)
        }
        do {
            try model.saveConfiguration(updated)
            preset = item
            presetMessage = "Preset saved."
        } catch { presetMessage = error.localizedDescription }
    }
    private func saveRecipe() {
        guard var item = recipe else { return }
        item.name = item.name.trimmingCharacters(in: .whitespacesAndNewlines)
        var updated = model.configuration
        if let index = updated.recipes.firstIndex(where: { $0.id == item.id }) {
            updated.recipes[index] = item
        } else {
            updated.recipes.append(item)
        }
        do {
            try model.saveConfiguration(updated)
            recipe = item
            recipeMessage = "Recipe saved."
        } catch { recipeMessage = error.localizedDescription }
    }
    private func removePreset() {
        guard let item = preset else { return }
        let references = model.configuration.recipes.filter { $0.presetID == item.id }.map(\.name)
        guard references.isEmpty else {
            presetMessage =
                "Change the default preset of \(references.joined(separator: ", ")) before removing this preset."
            return
        }
        var updated = model.configuration
        updated.presets.removeAll { $0.id == item.id }
        do {
            try model.saveConfiguration(updated)
            preset = updated.presets.first
            presetMessage = "Preset removed."
        } catch { presetMessage = error.localizedDescription }
    }
    private func removeRecipe() {
        guard let item = recipe else { return }
        var updated = model.configuration
        updated.recipes.removeAll { $0.id == item.id }
        do {
            try model.saveConfiguration(updated)
            recipe = updated.recipes.first
            recipeMessage = "Recipe removed."
        } catch { recipeMessage = error.localizedDescription }
    }
}
