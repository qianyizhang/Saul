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
        items += model.compatiblePresets.map {
            .init(value: $0.id.uuidString, title: presetTitle($0))
        }
        if let selected = model.currentPreset, !items.contains(where: { $0.value == selected.id.uuidString }),
            model.replayEntry == nil
        {
            items.append(
                .init(value: selected.id.uuidString, title: "\(selected.name) (unavailable)", enabled: false))
        }
        if model.currentPreset == nil { items.append(.init(value: "", title: "No preset")) }
        return items
    }
    private func presetTitle(_ preset: ModelPreset, saved: Bool = false) -> String {
        let name = saved ? "Saved: \(preset.name)" : preset.name
        if preset.capability == .draw { return name }
        guard showsSpeed else { return name }
        if model.minimumMode {
            return preset.fast ? "\(name) · Fast" : name
        }
        let override = !saved && model.overridePresetID == preset.id ? " · Override" : ""
        return name + override + (preset.fast ? " · Fast requested" : " · Standard")
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
            }.buttonStyle(.borderless).help("Details")
                .accessibilityLabel("Details")
                .popover(isPresented: $showDetails) {
                    RequestDetails(model: model, showsAnswer: false) {
                        showDetails = false
                        model.openSettings(.configuration)
                    }
                }
        }.controlSize(.small)
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
                MetadataRow("Provider", value: preset.providerKey)
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

struct ActionPicker: View {
    @ObservedObject var model: AppModel
    var showsLabel = true
    private var options: [SelectorOption<String>] {
        var items: [SelectorOption<String>] = []
        if let saved = model.replayEntry?.actionSnapshot {
            items.append(.init(value: "saved", title: "Saved: \(saved.name)", symbol: saved.symbol))
        }
        items += model.configuration.actions.map {
            .init(value: $0.id.uuidString, title: $0.name, symbol: $0.symbol)
        }
        if model.currentAction == nil {
            items.append(.init(value: "", title: "No actions — open Configuration"))
        }
        return items
    }
    var body: some View {
        SelectorPicker(
            "Action", options: options,
            selection: Binding(
                get: { model.replayEntry != nil ? "saved" : model.selectedActionID?.uuidString ?? "" },
                set: { value in
                    guard value != "saved" else { return }
                    model.chooseAction(UUID(uuidString: value))
                }), showsLabel: showsLabel
        )
        .disabled(model.busy || model.launcherPending)
    }
}

struct ActionInputs: View {
    @ObservedObject var model: AppModel
    var compact = false
    var presentation = 0
    var onConfigure: (() -> Void)? = nil
    @FocusState private var focusedField: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if model.currentAction?.capability == .draw {
                SelectorPicker(
                    "Output format",
                    options: ImageModelOption.formats.map {
                        .init(value: $0, title: $0 == "gif" ? "GIF · animated" : "PNG")
                    },
                    selection: Binding(get: { model.outputFormat }, set: { model.outputFormatOverride = $0 }))
            }
            if let label = model.currentAction?.imageInput {
                ImageInputView(model: model, label: label)
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
                                            set: { model.inputValues[field] = $0 }), axis: .vertical
                                    )
                                    .textFieldStyle(.roundedBorder).lineLimit(2...(compact ? 3 : 4))
                                    .font(.system(size: 14)).accessibilityLabel(field)
                                    .focused($focusedField, equals: field)
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
