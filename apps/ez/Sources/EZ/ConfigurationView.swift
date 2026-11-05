import EZCore
import SwiftUI

struct ConfigurationView: View {
    @ObservedObject var model: AppModel
    @Binding var hasUnsavedChanges: Bool
    @Binding var viewingPresetID: UUID?
    @State private var confirmSelection = false
    @State private var pendingSelection: (() -> Void)?
    @State private var preset: ModelPreset?
    @State private var action: Action?
    @State private var presetMessage: String?
    @State private var actionMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                if !model.minimumMode {
                    Text("Name your model choices, then build the actions you use.")
                        .font(AppStyle.body).foregroundStyle(.secondary)
                }
                if let error = model.configurationError {
                    Text(error).font(AppStyle.caption).foregroundStyle(.red).textSelection(.enabled)
                }
                HStack {
                    if !model.minimumMode {
                        Text("Connections and presets are shared with Saul. Actions stay in this app.")
                            .font(AppStyle.caption).foregroundStyle(AppStyle.secondaryText)
                    }
                    Spacer()
                    Button(model.minimumMode ? "Reload" : "Reload saved settings") {
                        let reload = {
                            model.refreshConfiguration()
                            preset = model.configuration.presets.first
                            action = model.configuration.actions.first
                        }
                        if presetIsDirty || actionIsDirty {
                            pendingSelection = reload
                            confirmSelection = true
                        } else {
                            reload()
                        }
                    }.help("Reload saved settings").accessibilityLabel("Reload saved settings")
                }
                if model.settingsSection == .actions { actionSection } else { presetSection }
                if !model.minimumMode {
                    Text(
                        "Saved on this Mac. Changes apply to new lookups; history keeps its original prompt and choices."
                    )
                    .font(AppStyle.caption).foregroundStyle(AppStyle.secondaryText)
                }
            }.padding(24)
        }.onAppear {
            if preset == nil { preset = model.configuration.presets.first }
            if action == nil { action = model.configuration.actions.first }
        }
        .task(id: "\(model.settingsSection.rawValue):\(preset?.connectionKey ?? "")") {
            if model.settingsSection == .configuration,
                let connection = model.configuration.connections.first(where: {
                    $0.key == preset?.connectionKey
                })
            {
                await model.refreshConnection(connection)
            }
        }
        .onChange(of: preset?.id, initial: true) { _, id in viewingPresetID = id }
        .onChange(of: presetIsDirty || actionIsDirty, initial: true) { _, dirty in
            hasUnsavedChanges = dirty
        }
        .onChange(of: model.settingsPresetID, initial: true) { _, id in
            if let chosen = model.configuration.presets.first(where: { $0.id == id }) { selectPreset(chosen) }
        }
        .alert("Discard unsaved edits?", isPresented: $confirmSelection) {
            Button("Keep", role: .cancel) { pendingSelection = nil }
            Button("Discard", role: .destructive) {
                let change = pendingSelection
                pendingSelection = nil
                change?()
            }
        } message: {
            Text("Save this item before switching, or discard its edits.")
        }
    }

    private var catalogModels: [ConnectionModel] {
        if let catalog = model.connectionCatalogs[preset?.connectionKey ?? ""] { return catalog.models }
        guard model.offline else { return [] }
        var options = model.models.map {
            ConnectionModel(
                id: $0.model, name: $0.displayName,
                capabilities: [.write], efforts: $0.supportedReasoningEfforts.map(\.reasoningEffort),
                defaultEffort: $0.defaultReasoningEffort, fastTier: $0.fastTier)
        }
        if let preset, !options.contains(where: { $0.id == preset.model }) {
            options.append(ConnectionModel(id: preset.model, capabilities: [preset.capability]))
        }
        return options
    }

    private var presetSection: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("Presets").font(.headline)
                    Spacer()
                    Button(model.minimumMode ? "Add" : "Add preset", systemImage: "plus") {
                        let option = model.currentModel ?? model.models.first
                        selectPreset(
                            ModelPreset(
                                name: "New preset", model: option?.model ?? "",
                                effort: option?.supportedReasoningEfforts.isEmpty == false
                                    ? option!.quickEffort : "", fast: false))
                    }.help("Add preset").accessibilityLabel("Add preset")
                }
                HStack(alignment: .top, spacing: 18) {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(model.configuration.presets) { item in
                            FullRowButton {
                                selectPreset(item)
                            } label: {
                                Text(item.name).frame(maxWidth: .infinity, alignment: .leading).padding(6)
                                    .background(
                                        preset?.id == item.id ? AppStyle.accent.opacity(0.12) : .clear,
                                        in: RoundedRectangle(cornerRadius: 6))
                            }
                        }
                        if model.configuration.presets.isEmpty {
                            Text("No presets yet").foregroundStyle(.secondary)
                        }
                    }.frame(width: 145)
                    Divider()
                    if preset != nil {
                        presetEditor
                    } else if !model.minimumMode {
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
            HStack(spacing: 8) {
                Text("Preset name").frame(width: 100, alignment: .leading)
                TextField("Preset name", text: presetBinding(\.name)).textFieldStyle(.roundedBorder)
                    .accessibilityLabel("Preset name")
            }
            let modelSelection = Binding(
                get: { preset?.model ?? "" },
                set: { value in
                    preset?.model = value
                    if let option = catalogModels.first(where: { $0.id == value }) {
                        preset?.effort =
                            option.efforts.first(where: { ["none", "minimal", "low"].contains($0) })
                            ?? option.defaultEffort
                        preset?.fast = false
                    }
                })
            SelectorPicker(
                "Connection",
                options: (model.configuration.connections.contains { $0.key == preset?.connectionKey }
                    ? []
                    : [
                        .init(
                            value: preset?.connectionKey ?? "",
                            title: "\(preset?.connectionKey ?? "Unknown") (unavailable)", enabled: false)
                    ])
                    + model.configuration.connections.map { .init(value: $0.key, title: $0.name) },
                selection: presetBinding(\.connectionKey))
            let supported =
                model.configuration.connections.first { $0.key == preset?.connectionKey }?.capabilities ?? []
            SelectorPicker(
                "Capability",
                options: ActionCapability.allCases.map {
                    .init(
                        value: $0, title: supported.contains($0) ? $0.name : "\($0.name) (unavailable)",
                        enabled: supported.contains($0))
                }, selection: presetCapabilityBinding)
            let available = catalogModels.filter {
                $0.capabilities.isEmpty || $0.capabilities.contains(preset?.capability ?? .write)
            }
            SelectorPicker(
                "Model",
                options: (available.contains { $0.id == preset?.model }
                    ? []
                    : [
                        .init(
                            value: preset?.model ?? "",
                            title:
                                "\(preset?.model.isEmpty == false ? preset!.model : "Choose a model") (unavailable)"
                        )
                    ])
                    + available.map {
                        .init(
                            value: $0.id,
                            title: $0.name + ($0.capabilities.isEmpty ? " · capability unverified" : ""))
                    },
                selection: modelSelection)
            if preset?.capability == .draw {
                DisclosureGroup("Image settings") {
                    VStack(alignment: .leading, spacing: 12) {
                        SelectorPicker(
                            "Output format",
                            options: ImageOptions.formats.map {
                                .init(value: $0, title: $0.uppercased())
                            }, selection: imageOptionBinding(\.outputFormat))
                        SelectorPicker(
                            "Size",
                            options: ImageOptions.sizes.map {
                                .init(value: $0, title: $0.replacingOccurrences(of: "x", with: " × "))
                            }, selection: imageOptionBinding(\.size))
                        SelectorPicker(
                            "Quality",
                            options: ImageOptions.qualities.map {
                                .init(value: $0, title: $0.capitalized)
                            }, selection: imageOptionBinding(\.quality))
                    }.padding(.top, 8)
                }
            } else if preset?.capability == .speak {
                SelectorPicker(
                    "Voice",
                    options: SpeechOptions.voices.map {
                        .init(value: $0, title: $0.capitalized)
                    }, selection: speechVoiceBinding)
                if let preset { SpeakPreview(model: model, preset: preset, saved: !presetIsDirty) }
            } else {
                DisclosureGroup("Options") {
                    let selected = catalogModels.first { $0.id == preset?.model }
                    let efforts = selected?.efforts ?? []
                    SelectorPicker(
                        "Effort",
                        options: [.init(value: "", title: "Default")]
                            + ((!efforts.contains(preset?.effort ?? "") && preset?.effort.isEmpty == false)
                                ? [.init(value: preset!.effort, title: "\(preset!.effort) (unavailable)")]
                                : []) + efforts.map { .init(value: $0, title: $0.capitalized) },
                        selection: presetBinding(\.effort))
                    let officialAPI =
                        model.configuration.connections.first { $0.key == preset?.connectionKey }.map {
                            $0.kind == .openAIAPI && $0.endpoint == "https://api.openai.com/v1"
                        } ?? false
                    let supportsFast = selected?.fastTier != nil || officialAPI
                    SelectorPicker(
                        "Speed",
                        options: [
                            .init(value: false, title: "Standard"),
                            .init(
                                value: true, title: supportsFast ? "Fast" : "Fast (unavailable)",
                                enabled: supportsFast),
                        ], selection: presetBinding(\.fast))
                }
            }
            if let preset, let issue = model.presetIssue(preset) {
                Text(issue).font(AppStyle.caption).foregroundStyle(.orange)
            }
            HStack {
                Button(model.minimumMode ? "Save" : "Save preset") { savePreset() }.help("Save preset")
                    .accessibilityLabel("Save preset").buttonStyle(.borderedProminent).disabled(
                        !presetIsDirty)
                if presetIsDirty { Text("Unsaved edits").font(AppStyle.caption).foregroundStyle(.secondary) }
                Spacer()
                if model.configuration.presets.contains(where: { $0.id == preset?.id }) {
                    Button(model.minimumMode ? "Remove" : "Remove preset", role: .destructive) {
                        removePreset()
                    }.help("Remove preset").accessibilityLabel("Remove preset")
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private var actionSection: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Label("Actions", systemImage: "text.badge.plus").font(.headline)
                    Spacer()
                    Button(model.minimumMode ? "Add" : "Add action", systemImage: "plus") {
                        guard let defaultPreset = model.configuration.presets.first else { return }
                        selectAction(
                            Action(name: "New action", presetID: defaultPreset.id, template: "{{text}}"))
                    }.help("Add action").accessibilityLabel("Add action").disabled(
                        model.configuration.presets.isEmpty)
                }
                HStack(alignment: .top, spacing: 18) {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(model.configuration.actions) { item in
                            FullRowButton {
                                selectAction(item)
                            } label: {
                                Label(item.name, systemImage: item.symbol)
                                    .frame(maxWidth: .infinity, alignment: .leading).padding(6)
                                    .background(
                                        action?.id == item.id ? AppStyle.accent.opacity(0.12) : .clear,
                                        in: RoundedRectangle(cornerRadius: 6))
                            }
                        }
                        if model.configuration.actions.isEmpty {
                            Text("No actions yet").foregroundStyle(.secondary)
                        }
                    }.frame(width: 145)
                    Divider()
                    if action != nil {
                        actionEditor
                    } else if !model.minimumMode {
                        Text("Add an action with a prompt and a default preset.").foregroundStyle(.secondary)
                    }
                }
                if let message = actionMessage {
                    Text(message).font(AppStyle.caption).textSelection(.enabled)
                }
            }.padding(10)
        }.disabled(model.configurationLocked)
    }

    private var actionEditor: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Action name").font(AppStyle.caption)
            TextField("Action name", text: actionBinding(\.name)).textFieldStyle(.roundedBorder)
                .accessibilityLabel("Action name")
            SelectorPicker(
                "Capability",
                options: ActionCapability.allCases.filter { $0 != .speak }.map {
                    .init(value: $0, title: $0.name)
                },
                selection: actionBinding(\.capability))
            let compatible = model.configuration.presets.filter { preset in
                preset.capability == action?.capability
                    && (action?.webSearch != true
                        || model.configuration.connections.first { $0.key == preset.connectionKey }?.kind
                            == .openAIAPI)
            }
            let presetOptions: [SelectorOption<UUID>] =
                (compatible.contains { $0.id == action?.presetID }
                    ? []
                    : [
                        .init(value: action!.presetID, title: "Unavailable preset")
                    ]) + compatible.map { .init(value: $0.id, title: $0.name) }
            SelectorPicker(
                "Default preset",
                options: presetOptions,
                selection: actionBinding(\.presetID))
            if action?.capability == .write {
                Toggle("Search the web", isOn: actionBinding(\.webSearch))
                if action?.webSearch == true {
                    Text("Requires an API Write preset. Each Run searches and adds search charges.")
                        .font(AppStyle.caption).foregroundStyle(.secondary)
                }
            }
            if action?.capability == .draw {
                Toggle(
                    "Image input",
                    isOn: Binding(
                        get: { action?.imageInput != nil },
                        set: { action?.imageInput = $0 ? "Image" : nil }))
                if action?.imageInput != nil {
                    TextField(
                        "Image input name",
                        text: Binding(
                            get: { action?.imageInput ?? "Image" }, set: { action?.imageInput = $0 })
                    )
                    .textFieldStyle(.roundedBorder).accessibilityLabel("Image input name")
                }
            }
            Text("Prompt").font(.subheadline.weight(.medium))
            TextEditor(text: actionBinding(\.template)).font(.system(size: 12, design: .monospaced))
                .frame(height: 125).padding(6)
                .background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(.quaternary))
                .accessibilityLabel("Prompt template")
            if !model.minimumMode { templateHint }
            if let template = try? PromptTemplate(action?.template ?? "") {
                DisclosureGroup(
                    model.minimumMode
                        ? "Preview"
                        : "Input preview · \(template.fields.count) field\(template.fields.count == 1 ? "" : "s")"
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
                Button(model.minimumMode ? "Save" : "Save action") { saveAction() }.help("Save action")
                    .accessibilityLabel("Save action").buttonStyle(.borderedProminent).disabled(
                        !actionIsDirty)
                if actionIsDirty { Text("Unsaved edits").font(AppStyle.caption).foregroundStyle(.secondary) }
                Spacer()
                if model.configuration.actions.contains(where: { $0.id == action?.id }) {
                    Button(model.minimumMode ? "Remove" : "Remove action", role: .destructive) {
                        removeAction()
                    }.help("Remove action").accessibilityLabel("Remove action")
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private var templateHint: some View {
        Text("Use {{field name}} for each input. Repeated names share a field. All inputs are required.")
            .font(AppStyle.caption).foregroundStyle(AppStyle.secondaryText)
    }

    private var presetIsDirty: Bool {
        guard let preset else { return false }
        return preset != model.configuration.presets.first { $0.id == preset.id }
    }
    private var actionIsDirty: Bool {
        guard let action else { return false }
        return action != model.configuration.actions.first { $0.id == action.id }
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
    private func selectAction(_ item: Action) {
        guard item.id != action?.id else { return }
        let change = {
            action = item
            actionMessage = nil
        }
        if actionIsDirty {
            pendingSelection = change
            confirmSelection = true
        } else {
            change()
        }
    }

    private var templateError: String {
        do {
            _ = try PromptTemplate(action?.template ?? "")
            return ""
        } catch { return error.localizedDescription }
    }
    private func presetBinding<Value>(_ path: WritableKeyPath<ModelPreset, Value>) -> Binding<Value> {
        let original = preset![keyPath: path]
        return Binding(get: { preset?[keyPath: path] ?? original }, set: { preset?[keyPath: path] = $0 })
    }
    private func actionBinding<Value>(_ path: WritableKeyPath<Action, Value>) -> Binding<Value> {
        let original = action![keyPath: path]
        return Binding(get: { action?[keyPath: path] ?? original }, set: { action?[keyPath: path] = $0 })
    }
    private var speechVoiceBinding: Binding<String> {
        Binding(
            get: { (preset?.speechOptions ?? SpeechOptions()).voice },
            set: { preset?.speechOptions = SpeechOptions(voice: $0) })
    }
    private var presetCapabilityBinding: Binding<ActionCapability> {
        Binding(
            get: { preset?.capability ?? .write },
            set: { capability in
                if capability == .speak && preset?.capability != .speak {
                    preset?.model = catalogModels.first(where: { $0.capabilities.contains(.speak) })?.id ?? ""
                    preset?.effort = ""
                    preset?.fast = false
                    preset?.speechOptions = preset?.speechOptions ?? SpeechOptions()
                }
                preset?.capability = capability
            })
    }
    private func imageOptionBinding(_ path: WritableKeyPath<ImageOptions, String>) -> Binding<String> {
        Binding(
            get: { (preset?.imageOptions ?? ImageOptions())[keyPath: path] },
            set: { value in
                var options = preset?.imageOptions ?? ImageOptions()
                options[keyPath: path] = value
                preset?.imageOptions = options
            })
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
            preset = model.configuration.presets.first { $0.id == item.id }
            presetMessage = "Preset saved."
        } catch { presetMessage = error.localizedDescription }
    }
    private func saveAction() {
        guard var item = action else { return }
        guard
            model.configuration.presets.contains(where: {
                $0.id == item.presetID && $0.capability == item.capability
            })
        else {
            actionMessage = "Choose an available default preset before saving this action."
            return
        }
        item.name = item.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if item.capability != .write { item.webSearch = false }
        if item.capability != .draw { item.imageInput = nil }
        var updated = model.configuration
        if let index = updated.actions.firstIndex(where: { $0.id == item.id }) {
            updated.actions[index] = item
        } else {
            updated.actions.append(item)
        }
        do {
            try model.saveConfiguration(updated)
            action = item
            actionMessage = "Action saved."
        } catch { actionMessage = error.localizedDescription }
    }
    private func removePreset() {
        guard let item = preset else { return }
        let references = model.configuration.actions.filter { $0.presetID == item.id }.map(\.name)
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
    private func removeAction() {
        guard let item = action else { return }
        var updated = model.configuration
        updated.actions.removeAll { $0.id == item.id }
        do {
            try model.saveConfiguration(updated)
            action = updated.actions.first
            actionMessage = "Action removed."
        } catch { actionMessage = error.localizedDescription }
    }
}
