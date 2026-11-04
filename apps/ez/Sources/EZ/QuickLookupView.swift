import EZCore
import SwiftUI

struct QuickLookupView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var controller: QuickLookupController
    @Environment(\.openWindow) private var openWindow
    @State private var showDetails = false
    @State private var showsComposer = false
    private var showsInputs: Bool { !model.minimumMode || model.selectedEntry == nil || showsComposer }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            if showsInputs {
                ActionInputs(
                    model: model, compact: true, presentation: controller.presentation,
                    onConfigure: { controller.showMain(settings: true) })
            }
            actions
            if !notices.isEmpty || needsSetup || (model.needsPlan && model.connecting) {
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
                        if model.needsPlan && model.connecting {
                            Text("Connecting to ChatGPT…").font(AppStyle.caption).foregroundStyle(.secondary)
                        } else if needsSetup {
                            Button(
                                model.minimumMode
                                    ? (needsAccount ? "Connect" : "Settings")
                                    : (!model.signedIn
                                        ? "Connect ChatGPT"
                                        : !model.planEnabled ? "Enable plan access" : "Open Configuration")
                            ) {
                                controller.showMain(
                                    settings: true, section: needsAccount ? .account : .configuration)
                            }.controlSize(.small)
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }.frame(height: 88)
            }
            if let entry = model.selectedEntry {
                ThinkingDivider(activity: controller.isVisible ? model.selectedResponseActivity : nil)
                ScrollView {
                    result(entry).frame(maxWidth: .infinity, alignment: .leading)
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                Spacer(minLength: 0)
            }
            if let entry = model.selectedEntry {
                FollowUpComposer(model: model, entry: entry).id(entry.id)
            }
            footer
            if !model.minimumMode, let entry = model.selectedEntry {
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
            controller.setOpenMain { openWindow(id: "main") }
            controller.resizeContent(layout)
        }
        .onChange(of: layout) { _, layout in controller.resizeContent(layout) }
        .onChange(of: model.selection) { _, _ in showsComposer = false }
    }

    private var header: some View {
        HStack(spacing: 8) {
            if showsInputs {
                ActionPicker(model: model, showsLabel: false)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else if let entry = model.selectedEntry {
                Label(entry.actionName, systemImage: entry.actionSymbol)
                    .font(AppStyle.caption).foregroundStyle(AppStyle.accent).lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading).frame(height: 24)
            }
            Button {
                controller.showMain()
            } label: {
                Image(systemName: "sidebar.left")
            }.help("Open EZ & history").accessibilityLabel("Open EZ & history")
            Menu {
                Toggle("Min Mode", isOn: $model.minimumMode)
                Divider()
                Button("Settings…") { controller.showMain(settings: true) }
                Button("Providers…") { controller.showMain(settings: true, section: .account) }
            } label: {
                Image(systemName: "ellipsis")
            }.menuStyle(.borderlessButton).fixedSize()
                .accessibilityLabel("Quick Lookup actions")
            Button {
                controller.hide()
            } label: {
                Image(systemName: "xmark")
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
            .disabled(model.busy || model.launcherPending)
            if model.minimumMode && model.selectedEntry != nil && !model.busy {
                Button(showsInputs ? "Hide" : "Edit") { showsComposer.toggle() }
                    .help(showsInputs ? "Hide draft" : "Edit draft")
                    .accessibilityLabel(showsInputs ? "Hide draft" : "Edit draft")
                    .buttonStyle(.borderless)
            }
            Spacer()
            if model.launcherPending {
                Text("Preparing…").font(AppStyle.caption).foregroundStyle(.secondary)
            } else if model.busy {
                Button("Stop") { model.stop() }.help(
                    "Stop generating · \(model.shortcuts.binding(for: .stop).display)")
            } else if showsInputs {
                Button("Run") { model.send() }.buttonStyle(.borderedProminent)
                    .disabled(!model.canSend).help(
                        "Run action · \(model.shortcuts.binding(for: .send).display)")
            }
        }.controlSize(.small)
    }

    private var footer: some View {
        HStack(spacing: 8) {
            if showsInputs {
                PresetPicker(model: model, showsLabel: false, showsSpeed: true)
                    .frame(width: 250)
            } else if let entry = model.selectedEntry {
                Text(
                    entry.presetSnapshot.map {
                        entry.capability == .draw || (model.minimumMode && entry.requestedServiceTier == nil)
                            ? $0.name
                            : "\($0.name) · \(entry.requestedServiceTier == nil ? "Standard" : "Fast")"
                    } ?? "Details"
                )
                .lineLimit(1).help(entry.capability == .draw ? "Draw · PNG" : entry.serviceDescription)
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
            if let entry = model.selectedEntry, entry.capability == .draw, entry.hasImage {
                Button("Download") { model.downloadImage(entry) }.buttonStyle(.borderless)
                    .disabled(model.imageLoading)
            } else if let entry = model.selectedEntry, !entry.response.isEmpty {
                Button("Copy") { model.copy(entry.response) }.buttonStyle(.borderless)
                    .help("Copy answer")
            }
        }.font(AppStyle.caption).foregroundStyle(AppStyle.secondaryText)
    }

    private var details: some View {
        RequestDetails(model: model) {
            showDetails = false
            controller.showMain(settings: true)
        }
    }

    private func result(_ entry: HistoryEntry) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            UnsavedAttemptNotice(model: model, entry: entry)
            LookupAnswerText(
                entry: entry, activity: model.selectedResponseActivity, compact: true,
                imageData: model.imageData(for: entry), imageLoading: model.imageLoading)
            if let parentID = entry.parentID, model.entries.contains(where: { $0.id == parentID }) {
                Button("Previous answer") { model.selection = parentID }.buttonStyle(.borderless)
            }
            if !["pending", "completed", "unsaved"].contains(entry.status) {
                Text(entry.status.capitalized).font(AppStyle.caption).foregroundStyle(.orange)
            }
            if let error = entry.error, !notices.contains(error) {
                Text(error).font(AppStyle.caption).foregroundStyle(.red).textSelection(.enabled)
            }
        }
    }

    private var notices: [String] {
        var messages: [String] = []
        let presetIssue =
            model.planEnabled && !model.models.isEmpty
            ? model.currentPreset?.availabilityError(in: model.models) : nil
        for message in [
            controller.shortcutError, controller.launcherError, model.storageWarning, model.providerIssue,
            model.configurationError, model.error, presetIssue,
        ].compactMap({ $0 }) {
            if !messages.contains(message) { messages.append(message) }
        }
        return messages
    }
    private var needsAccount: Bool { model.providerIssue != nil }
    private var needsSetup: Bool {
        needsAccount
            || (model.currentAction != nil
                && (model.currentPreset == nil || (model.needsPlan && model.currentModel == nil)
                    || model.configurationError != nil))
    }
    private var layout: QuickLookupLayout {
        QuickLookupLayout(
            fieldCount: showsInputs ? model.inputFields.count : 0,
            showsNotice: !notices.isEmpty || needsSetup || (model.needsPlan && model.connecting),
            showsAnswer: model.selectedEntry != nil,
            showsFollowUp: model.selectedEntry?.status == "completed"
                && model.selectedEntry?.capability == .write)
    }
}
