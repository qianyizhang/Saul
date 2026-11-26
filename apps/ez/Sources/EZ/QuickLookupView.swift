import EZCore
import SaulNativeValues
import SwiftUI

struct QuickLookupView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var lookup: LookupSession
    @ObservedObject var controller: QuickLookupController
    @State private var showDetails = false
    @State private var showsComposer = false
    private var showsInputs: Bool { !model.minimumMode || lookup.selectedEntry == nil || showsComposer }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            if showsInputs {
                LookupChoices(model: model, lookup: model.lookup)
                ActionInputs(
                    model: model, lookup: model.lookup, compact: true, presentation: controller.presentation,
                    onConfigure: { controller.showMain(settings: true) },
                    onEditSketch: {
                        lookup.showsMainComposer = true
                        controller.showMain()
                    })
            }
            actions
            if !notices.isEmpty || setupSection != nil {
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(notices, id: \.self) { message in
                            Text(message).font(AppStyle.caption)
                                .foregroundStyle(
                                    message == model.error || message == model.configurationError
                                        ? .red : .orange
                                )
                                .textSelection(.enabled)
                        }
                        if let section = setupSection {
                            Button(AppModel.setupLabel(for: section)) {
                                if section == .configuration {
                                    model.settingsPresetID = lookup.currentPreset?.id
                                }
                                controller.showMain(settings: true, section: section)
                            }.controlSize(.small)
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }.frame(height: 88)
            }
            if let entry = lookup.selectedEntry {
                ThinkingDivider(activity: controller.isVisible ? lookup.selectedResponseActivity : nil)
                ScrollView {
                    result(entry).frame(maxWidth: .infinity, alignment: .leading)
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                Spacer(minLength: 0)
            }
            if let entry = lookup.selectedEntry {
                FollowUpComposer(lookup: lookup, entry: entry).id(entry.id)
            }
            footer
            if !model.minimumMode, let entry = lookup.selectedEntry {
                Divider()
                LookupStatusLine(entry: entry)
            }
        }
        .padding(14).padding(.top, 10)
        .frame(
            minWidth: QuickLookupLayout.minimumWidth, maxWidth: .infinity,
            minHeight: layout.minimumHeight, maxHeight: .infinity, alignment: .topLeading
        )
        .background(Color(nsColor: .windowBackgroundColor)).tint(AppStyle.accent)
        .labelStyle(EverydayLabelStyle(minimum: model.minimumMode))
        .disclosureGroupStyle(FullRowDisclosureStyle())
        .ignoresSafeArea(.container, edges: .top)
        .onAppear {
            controller.resizeContent(layout)
        }
        .onChange(of: layout) { _, layout in controller.resizeContent(layout) }
        .onChange(of: lookup.selection) { _, _ in showsComposer = false }
    }

    private var header: some View {
        HStack(spacing: 8) {
            if showsInputs {
                Text("Quick Lookup").font(AppStyle.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Button {
                controller.showMain()
            } label: {
                ControlLabel(symbol: .openWorkspace)
            }.help("Open EZ & history").accessibilityLabel("Open EZ & history")
            Menu {
                if let entry = lookup.selectedEntry, lookup.canReuse(entry) {
                    Button("Reuse") { lookup.reuse(entry) }
                    Divider()
                }
                Toggle("Min Mode", isOn: $model.minimumMode)
                Divider()
                Button("Settings…") { controller.showMain(settings: true) }
                Button("Connections…") { controller.showMain(settings: true, section: .connections) }
            } label: {
                ControlLabel(symbol: .more)
            }.menuStyle(.borderlessButton).fixedSize()
                .help("More")
                .accessibilityLabel("Quick Lookup actions")
            Button {
                controller.hide()
            } label: {
                ControlLabel(symbol: .close)
            }.help("Hide · Esc").accessibilityLabel("Hide Quick Lookup")
        }.buttonStyle(.borderless).controlSize(.small)
    }

    private var actions: some View {
        HStack {
            Button {
                controller.newQuery()
            } label: {
                Label("New", systemImage: "plus")
            }.buttonStyle(.borderless).help(
                "New lookup · \(model.shortcuts.binding(for: .newLookup).display)"
            )
            .disabled(lookup.busy || lookup.launcherPending)
            if model.minimumMode && lookup.selectedEntry != nil && !lookup.busy && !lookup.launcherPending
                && (showsComposer || lookup.hasRetainedDraft)
            {
                Button(showsInputs ? "Hide draft" : "Edit draft") { showsComposer.toggle() }
                    .buttonStyle(.borderless)
            }
            Spacer()
            if lookup.launcherPending {
                Text("Preparing…").font(AppStyle.caption).foregroundStyle(.secondary)
            } else if lookup.busy {
                AttemptControls(model: model, lookup: model.lookup)
            } else if showsInputs {
                Button {
                    lookup.send()
                } label: {
                    ControlLabel(symbol: .run, iconOnly: model.minimumMode)
                }.buttonStyle(.borderedProminent)
                    .disabled(!lookup.canSend).help(
                        "Run action · \(model.shortcuts.binding(for: .send).display)")
            }
        }.controlSize(.small)
    }

    private var footer: some View {
        HStack(spacing: 8) {
            if showsInputs {
                LookupBillingLabel(lookup: lookup)
            }
            Button {
                showDetails.toggle()
            } label: {
                Image(systemName: "info.circle").frame(width: 24, height: 24)
                    .contentShape(Rectangle())
            }.buttonStyle(.borderless).help("Details")
                .accessibilityLabel("Details")
                .popover(isPresented: $showDetails) { details }
            Spacer(minLength: 0)
            if let entry = lookup.selectedEntry, entry.capability == .draw, model.imageData(for: entry) != nil
            {
                Button("Download") { model.downloadImage(entry) }.buttonStyle(.borderless)
            } else if let entry = lookup.selectedEntry, entry.capability == .write, !entry.response.isEmpty {
                Button {
                    model.copy(entry.citedResponse)
                } label: {
                    ControlLabel(symbol: .copy)
                }.buttonStyle(.borderless)
                    .help("Copy answer").accessibilityLabel("Copy answer")
            }
        }.font(AppStyle.caption).foregroundStyle(AppStyle.secondaryText)
    }

    private var details: some View {
        RequestDetails(model: model, lookup: model.lookup) {
            showDetails = false
            controller.showMain(settings: true)
        }
    }

    private func result(_ entry: HistoryEntry) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            LookupAnswerText(
                entry: entry, activity: lookup.selectedResponseActivity, compact: true,
                imageData: model.imageData(for: entry), imageLoading: model.imageLoading)
            RetryAttemptNotice(lookup: lookup, entry: entry) { controller.showMain() }
            if let parentID = entry.parentID, model.entries.contains(where: { $0.id == parentID }) {
                Button("Previous answer") { lookup.selection = parentID }.buttonStyle(.borderless)
            }
            if !["pending", "completed"].contains(entry.status) {
                Text(entry.status.capitalized).font(AppStyle.caption).foregroundStyle(.orange)
            }
            if let error = entry.error, !notices.contains(error) {
                Text(error).font(AppStyle.caption).foregroundStyle(.red).textSelection(.enabled)
            }
        }
    }

    private var notices: [String] {
        var messages: [String] = []
        let presetIssue = lookup.currentPreset.flatMap { model.presetIssue($0) }
        for message in [
            controller.shortcutError, controller.launcherError, model.storageWarning, lookup.connectionIssue,
            lookup.currentConnectionWarning, model.configurationError, model.error,
            lookup.connectionIssue == nil ? presetIssue : nil,
        ].compactMap({ $0 }) {
            if !messages.contains(message) { messages.append(message) }
        }
        return messages
    }
    private var setupSection: SettingsSection? {
        if lookup.connectionIssue != nil || lookup.currentConnectionWarning != nil {
            return lookup.currentConnectionSetupSection
        }
        if lookup.currentAction != nil,
            lookup.currentPreset == nil || lookup.currentPreset.flatMap({ model.presetIssue($0) }) != nil
                || model.configurationError != nil
        {
            return .configuration
        }
        return nil
    }
    private var layout: QuickLookupLayout {
        QuickLookupLayout(
            showsChoices: showsInputs,
            fieldCount: showsInputs ? lookup.inputFields.count : 0,
            showsNotice: !notices.isEmpty || setupSection != nil,
            showsAnswer: lookup.selectedEntry != nil,
            showsFollowUp: lookup.selectedEntry?.status == "completed"
                && lookup.selectedEntry?.capability == .write,
            showsImageInput: showsInputs && lookup.currentAction?.imageInput != nil)
    }
}
