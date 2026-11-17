import EZCore
import SaulNativeValues
import SwiftUI

struct LookupChoices: View {
    @ObservedObject var model: AppModel

    var body: some View {
        HStack(spacing: 8) {
            LookupChoiceButton(
                role: "Action", options: actions,
                selection: model.replayEntry?.actionSnapshot != nil
                    ? "saved" : model.selectedActionID?.uuidString ?? ""
            ) { value in
                if let id = UUID(uuidString: value) { model.chooseAction(id) }
            }
            .frame(maxWidth: .infinity)
            .disabled(model.busy || model.launcherPending)
            LookupChoiceButton(
                role: "Preset", options: presets, selection: presetSelection
            ) { model.chooseLookupPreset(UUID(uuidString: $0)) }
            .frame(maxWidth: .infinity)
            .disabled(model.busy || model.credentialBusy || model.launcherPending)
        }.frame(height: 44)
    }

    private var actions: [LookupChoice] {
        var choices = model.configuration.actions.map {
            LookupChoice(id: $0.id.uuidString, name: $0.name, symbol: $0.symbol, detail: $0.capability.name)
        }
        if let saved = model.replayEntry?.actionSnapshot {
            choices.insert(
                LookupChoice(
                    id: "saved", name: "Saved: \(saved.name)", symbol: saved.symbol,
                    detail: saved.capability.name),
                at: 0)
        }
        return choices
    }

    private var presetSelection: String {
        if model.replayEntry?.presetSnapshot != nil && model.overridePresetID == nil { return "saved" }
        return model.currentPreset?.id.uuidString ?? ""
    }

    private var presets: [LookupChoice] {
        var choices = model.configuration.presets.map { presetChoice($0) }
        if let saved = model.replayEntry?.presetSnapshot {
            choices.insert(presetChoice(saved, saved: true), at: 0)
        }
        return choices
    }

    private func presetChoice(_ preset: ModelPreset, saved: Bool = false) -> LookupChoice {
        let connection = model.configuration.connections.first { $0.key == preset.connectionKey }
        let speed =
            preset.capability == .write
            ? (preset.fast ? "Fast" : (model.minimumMode ? nil : "Standard")) : nil
        let detail = [
            preset.capability.name, connection?.lookupBillingLabel ?? "Connection unavailable",
            !saved && model.overridePresetID == preset.id && !model.minimumMode ? "Override" : nil,
        ].compactMap { $0 }.joined(separator: " · ")
        return LookupChoice(
            id: saved ? "saved" : preset.id.uuidString, name: saved ? "Saved: \(preset.name)" : preset.name,
            detail: detail, badge: speed, unavailable: model.lookupPresetChoiceIssue(preset))
    }
}

struct LookupBillingLabel: View {
    @ObservedObject var model: AppModel

    var body: some View {
        if let connection = model.currentConnection {
            Text(connection.lookupBillingLabel(search: model.currentAction?.webSearch == true))
                .font(AppStyle.caption).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

extension ConnectionDefinition {
    fileprivate var lookupBillingLabel: String { lookupBillingLabel(search: false) }

    fileprivate func lookupBillingLabel(search: Bool) -> String {
        let provider = kind.name
        let identity = name == provider ? provider : "\(provider) · \(name)"
        guard kind == .openAIAPI else { return identity }
        return identity + (search ? " · search charges apply" : " · billed separately")
    }
}

struct NextLookupDetailsButton: View {
    @ObservedObject var model: AppModel
    @State private var showDetails = false
    var body: some View {
        Button {
            showDetails.toggle()
        } label: {
            Image(systemName: "info.circle").frame(width: 24, height: 24).contentShape(Rectangle())
        }
        .buttonStyle(.borderless).help("Next lookup details")
        .accessibilityLabel("Next lookup details")
        .popover(isPresented: $showDetails) {
            RequestDetails(model: model, showsAnswer: false) {
                showDetails = false
                model.openSettings(.configuration)
            }
        }
    }
}

struct RequestDetails: View {
    @ObservedObject var model: AppModel
    var showsAnswer = true
    var onConfigure: () -> Void
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if showsAnswer, let entry = model.selectedEntry {
                    Text("Answer details").font(.headline)
                    LookupDetails(entry: entry)
                    InputOutputInspector(entry: entry, minimum: model.minimumMode).id(entry.id)
                    Divider()
                    DisclosureGroup("Next lookup") { draftDetails.padding(.top, 8) }
                        .font(AppStyle.caption)
                        .disclosureGroupStyle(FullRowDisclosureStyle())
                } else {
                    Text("Next lookup").font(.headline)
                    draftDetails
                }
                Button(model.minimumMode ? "Settings" : "Presets & actions…", action: onConfigure).help(
                    "Presets & actions…"
                ).accessibilityLabel("Presets & actions…")
            }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
        }.frame(width: 380).frame(maxHeight: 520)
    }

    private var draftDetails: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let preset = model.currentPreset {
                MetadataRow("Preset", value: preset.name)
                MetadataRow("Model", value: preset.model)
                MetadataRow("Connection", value: preset.connectionKey)
                MetadataRow("Capability", value: preset.capability.name)
                if preset.capability == .draw {
                    MetadataRow("Output format", value: model.outputFormat.uppercased())
                    MetadataRow("Size", value: (preset.imageOptions ?? ImageOptions()).size)
                    MetadataRow("Quality", value: (preset.imageOptions ?? ImageOptions()).quality.capitalized)
                } else {
                    MetadataRow(
                        "Effort", value: preset.effort.isEmpty ? "Default" : preset.effort.capitalized)
                    MetadataRow("Requested speed", value: preset.fast ? "Fast" : "Standard")
                }
            } else {
                Text("No preset selected").font(AppStyle.caption).foregroundStyle(.secondary)
            }
            if !model.minimumMode {
                Text("A preset override lasts until New run or an action change.")
                    .font(AppStyle.caption).foregroundStyle(.secondary)
            }
            if model.fast && !model.minimumMode {
                Text("Fast requests priority service and may use more plan allowance.")
                    .font(AppStyle.caption).foregroundStyle(.secondary)
            }
        }.textSelection(.enabled)
    }
}

struct ActionInputs: View {
    @ObservedObject var model: AppModel
    var compact = false
    var presentation = 0
    var onConfigure: (() -> Void)? = nil
    var onEditSketch: (() -> Void)? = nil
    @FocusState private var focusedField: String?
    var body: some View {
        let imageField = model.currentAction?.imageInput
        VStack(alignment: .leading, spacing: 8) {
            if imageField != nil && model.outputFormat != "png" {
                Button("Use PNG") { model.chooseOutputFormat("png") }
                    .help("EZ uses PNG for image edits")
            } else if model.currentAction?.capability == .draw && imageField == nil {
                SelectorPicker(
                    "Output format",
                    options: ImageOptions.formats.map {
                        .init(value: $0, title: $0 == "gif" ? "GIF · animated" : "PNG")
                    },
                    selection: Binding(get: { model.outputFormat }, set: { model.chooseOutputFormat($0) }))
            }
            if let label = imageField {
                if model.usesSketch && !compact {
                    SketchEditor(model: model, label: label).id(model.draftRevision)
                } else {
                    ImageInputView(
                        model: model, label: label, onEditSketch: model.usesSketch ? onEditSketch : nil)
                }
            }
            if model.inputFields.isEmpty {
                Button(model.minimumMode ? "Actions" : "Configure actions") {
                    if let onConfigure { onConfigure() } else { model.openSettings(.actions) }
                }.help("Configure actions").accessibilityLabel("Configure actions")
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(spacing: 8) {
                            ForEach(model.inputFields, id: \.self) { field in
                                VStack(alignment: .leading, spacing: 4) {
                                    if model.inputFields.count > 1 || model.currentAction?.imageInput != nil {
                                        Text(field).font(AppStyle.caption).foregroundStyle(
                                            AppStyle.secondaryText)
                                    }
                                    TextField(
                                        model.inputFields.count > 1 ? "" : field,
                                        text: Binding(
                                            get: { model.inputValues[field] ?? "" },
                                            set: { model.setInput($0, for: field) }), axis: .vertical
                                    )
                                    .textFieldStyle(.roundedBorder).lineLimit(2...(compact ? 3 : 4))
                                    .font(.system(size: 14)).accessibilityLabel(field)
                                    .focused($focusedField, equals: field)
                                    .multilineDraftReturn()
                                }.id(field)
                            }
                        }
                    }
                    .onChange(of: focusedField) { _, field in
                        if let field { proxy.scrollTo(field) }
                    }
                }.frame(
                    height: (compact
                        ? QuickLookupLayout.inputHeight(fieldCount: model.inputFields.count)
                        : min(180, CGFloat(model.inputFields.count) * (model.inputFields.count > 1 ? 74 : 54)))
                        + (model.currentAction?.imageInput != nil && model.inputFields.count == 1 ? 20 : 0)
                )
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
            // Action changes replace the fields; focus after the new controls exist.
            await Task.yield()
            guard !model.busy, !model.launcherPending,
                compact == (NSApp.keyWindow is NSPanel)
            else { return }
            focusedField = model.inputFields.first
        }
    }
}
