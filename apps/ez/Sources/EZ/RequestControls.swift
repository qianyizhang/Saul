import EZCore
import SaulNativeValues
import SwiftUI

struct LookupChoices: View {
    @ObservedObject var model: AppModel
    @ObservedObject var lookup: LookupSession

    var body: some View {
        HStack(spacing: 8) {
            LookupChoiceButton(
                role: "Action", options: actions,
                selection: lookup.replayEntry?.actionSnapshot != nil
                    ? "saved" : lookup.selectedActionID?.uuidString ?? ""
            ) { value in
                if let id = UUID(uuidString: value) { lookup.chooseAction(id) }
            }
            .frame(maxWidth: .infinity)
            .disabled(lookup.busy || lookup.launcherPending)
            LookupChoiceButton(
                role: "Preset", options: presets, selection: presetSelection
            ) { lookup.chooseLookupPreset(UUID(uuidString: $0)) }
            .frame(maxWidth: .infinity)
            .disabled(lookup.busy || model.credentialBusy || lookup.launcherPending)
        }.frame(maxWidth: 368, alignment: .leading).frame(height: AppStyle.rowHeight)
    }

    private var actions: [LookupChoice] {
        var choices = model.configuration.actions.map {
            LookupChoice(id: $0.id.uuidString, name: $0.name, symbol: $0.symbol, detail: $0.capability.name)
        }
        if let saved = lookup.replayEntry?.actionSnapshot {
            choices.insert(
                LookupChoice(
                    id: "saved", name: "Saved: \(saved.name)", symbol: saved.symbol,
                    detail: saved.capability.name),
                at: 0)
        }
        return choices
    }

    private var presetSelection: String {
        if lookup.replayEntry?.presetSnapshot != nil && lookup.overridePresetID == nil { return "saved" }
        return lookup.currentPreset?.id.uuidString ?? ""
    }

    private var presets: [LookupChoice] {
        var choices = model.configuration.presets.map { presetChoice($0) }
        if let saved = lookup.replayEntry?.presetSnapshot {
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
            !saved && lookup.overridePresetID == preset.id && !model.minimumMode ? "Override" : nil,
        ].compactMap { $0 }.joined(separator: " · ")
        return LookupChoice(
            id: saved ? "saved" : preset.id.uuidString, name: saved ? "Saved: \(preset.name)" : preset.name,
            detail: detail, badge: speed, unavailable: lookup.lookupPresetChoiceIssue(preset))
    }
}

struct LookupBillingLabel: View {
    @ObservedObject var lookup: LookupSession

    var body: some View {
        if let connection = lookup.currentConnection {
            Text(connection.lookupBillingLabel(search: lookup.currentAction?.webSearch == true))
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
    @ObservedObject var lookup: LookupSession
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
            RequestDetails(model: model, lookup: model.lookup, showsAnswer: false) {
                showDetails = false
                model.openSettings(.configuration)
            }
        }
    }
}

struct RequestDetails: View {
    @ObservedObject var model: AppModel
    @ObservedObject var lookup: LookupSession
    var showsAnswer = true
    var onConfigure: () -> Void
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if showsAnswer, let entry = lookup.selectedEntry {
                    Text("Answer details").font(.headline)
                    LookupDetails(entry: entry)
                    DisclosureGroup(model.inspectionTitle(for: entry)) {
                        InputOutputInspector(
                            entry: entry, minimum: model.minimumMode,
                            transientFailure: model.isTransientFailure(entry)
                        ).id(entry.id)
                    }.disclosureGroupStyle(FullRowDisclosureStyle())
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
            if let preset = lookup.currentPreset {
                MetadataRow("Preset", value: preset.name)
                MetadataRow("Model", value: preset.model)
                MetadataRow("Connection", value: preset.connectionKey)
                MetadataRow("Capability", value: preset.capability.name)
                if preset.capability == .draw {
                    MetadataRow("Output format", value: lookup.outputFormat.uppercased())
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
            if lookup.fast && !model.minimumMode {
                Text("Fast requests priority service and may use more plan allowance.")
                    .font(AppStyle.caption).foregroundStyle(.secondary)
            }
        }.textSelection(.enabled)
    }
}

struct ActionInputs: View {
    @ObservedObject var model: AppModel
    @ObservedObject var lookup: LookupSession
    var compact = false
    var presentation = 0
    var onConfigure: (() -> Void)? = nil
    var onEditSketch: (() -> Void)? = nil
    @FocusState private var focusedField: String?
    var body: some View {
        let imageField = lookup.currentAction?.imageInput
        VStack(alignment: .leading, spacing: 8) {
            if imageField != nil && lookup.outputFormat != "png" {
                Button("Use PNG") { lookup.chooseOutputFormat("png") }
                    .help("EZ uses PNG for image edits")
            } else if lookup.currentAction?.capability == .draw && imageField == nil {
                SelectorPicker(
                    "Output format",
                    options: ImageOptions.formats.map {
                        .init(value: $0, title: $0 == "gif" ? "GIF · animated" : "PNG")
                    },
                    selection: Binding(get: { lookup.outputFormat }, set: { lookup.chooseOutputFormat($0) }))
            }
            if let label = imageField {
                if lookup.usesSketch && !compact {
                    SketchEditor(lookup: lookup, label: label).id(lookup.draftRevision)
                } else {
                    ImageInputView(
                        model: model, lookup: model.lookup, label: label,
                        onEditSketch: lookup.usesSketch ? onEditSketch : nil)
                }
            } else if lookup.restoringSavedImage || lookup.canContinueWithoutSavedImage {
                ImageInputFeedback(lookup: lookup)
            }
            if lookup.inputFields.isEmpty {
                Button(model.minimumMode ? "Actions" : "Configure actions") {
                    if let onConfigure { onConfigure() } else { model.openSettings(.actions) }
                }.help("Configure actions").accessibilityLabel("Configure actions")
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(spacing: 8) {
                            ForEach(lookup.inputFields, id: \.self) { field in
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(field).font(AppStyle.control).foregroundStyle(.secondary)
                                    TextField(
                                        "",
                                        text: Binding(
                                            get: { lookup.inputValues[field] ?? "" },
                                            set: { lookup.setInput($0, for: field) }), axis: .vertical
                                    )
                                    .lineLimit(compact ? 2 : 4, reservesSpace: true)
                                    .notebookEditor(focused: focusedField == field).accessibilityLabel(field)
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
                    height: compact
                        ? QuickLookupLayout.inputHeight(fieldCount: lookup.inputFields.count)
                        : min(248, CGFloat(lookup.inputFields.count) * 124)
                )
            }
        }
        .disabled(lookup.busy || lookup.launcherPending)
        .onAppear { focusInput() }
        .onChange(of: presentation) { _, _ in focusInput() }
        .onChange(of: lookup.draftRevision) { _, _ in focusInput() }
        .onChange(of: lookup.inputFields) { _, _ in focusInput() }
        .onChange(of: lookup.busy) { _, busy in if !busy { focusInput() } }
    }

    private func focusInput() {
        Task { @MainActor in
            focusedField = nil
            // Action changes replace the fields; focus after the new controls exist.
            await Task.yield()
            guard !lookup.busy, !lookup.launcherPending,
                compact == (NSApp.keyWindow is NSPanel)
            else { return }
            focusedField = lookup.inputFields.first
        }
    }
}
