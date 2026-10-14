import EZCore
import SwiftUI

struct QuickLookupView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var controller: QuickLookupController
    @Environment(\.openWindow) private var openWindow
    @State private var showDetails = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            RecipeInputs(
                model: model, compact: true, presentation: controller.presentation,
                onConfigure: { controller.showMain(settings: true) })
            actions
            if !notices.isEmpty || needsSetup || model.connecting {
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
                        if model.connecting {
                            Text("Connecting to ChatGPT…").font(AppStyle.caption).foregroundStyle(.secondary)
                        } else if needsSetup {
                            Button(
                                !model.signedIn
                                    ? "Connect ChatGPT"
                                    : !model.planEnabled ? "Enable plan access" : "Open Configuration"
                            ) {
                                controller.showMain(
                                    settings: true, section: needsAccount ? .account : .configuration)
                            }.controlSize(.small)
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }.frame(height: 88)
            }
            if let entry = model.selectedEntry {
                Divider()
                ScrollView {
                    result(entry).frame(maxWidth: .infinity, alignment: .leading)
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                Spacer(minLength: 0)
            }
            footer
        }
        .padding(14).padding(.top, 10)
        .frame(
            minWidth: QuickLookupLayout.minimumWidth, maxWidth: .infinity,
            minHeight: layout.minimumHeight, maxHeight: .infinity, alignment: .topLeading
        )
        .background(Color(nsColor: .windowBackgroundColor)).tint(AppStyle.accent)
        .ignoresSafeArea(.container, edges: .top)
        .onAppear {
            controller.setOpenMain { openWindow(id: "main") }
            controller.resizeContent(layout)
        }
        .onChange(of: layout) { _, layout in controller.resizeContent(layout) }
    }

    private var header: some View {
        HStack(spacing: 8) {
            RecipePicker(model: model).labelsHidden().pickerStyle(.menu)
                .frame(maxWidth: .infinity, alignment: .leading)
                .help("Choose a recipe")
            Button {
                controller.showMain()
            } label: {
                Image(systemName: "sidebar.left")
            }.help("Open EZ & history").accessibilityLabel("Open EZ & history")
            Menu {
                Button("Configuration…") { controller.showMain(settings: true) }
                Button("Account…") { controller.showMain(settings: true, section: .account) }
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
            }.buttonStyle(.borderless).help("New lookup · ⌘ N")
                .disabled(model.busy || model.launcherPending)
            Spacer()
            if model.launcherPending {
                ProgressView().controlSize(.small)
                Text("Preparing…").font(AppStyle.caption).foregroundStyle(.secondary)
            } else if model.busy {
                ProgressView().controlSize(.small)
                Button("Stop") { model.stop() }.help("Stop generating · ⌘ .")
            } else {
                Button("Send") { model.send() }.buttonStyle(.borderedProminent)
                    .disabled(!model.canSend).help("Send lookup · ⌘ Return")
            }
        }.controlSize(.small)
    }

    private var footer: some View {
        HStack(spacing: 8) {
            Button {
                showDetails.toggle()
            } label: {
                HStack(spacing: 4) {
                    Text(model.currentPreset?.name ?? "No preset").lineLimit(1)
                    if model.overridePresetID != nil { Text("· Override") }
                    if model.currentPreset != nil { Text(model.fast ? "· Fast requested" : "· Normal") }
                    Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
                }
            }.buttonStyle(.borderless).help("Preset override & request details")
                .accessibilityLabel("Preset override & request details")
                .accessibilityValue(
                    "\(model.currentPreset?.name ?? "No preset")\(model.overridePresetID == nil ? "" : ", override")\(model.currentPreset == nil ? "" : model.fast ? ", Fast requested" : ", Normal")"
                )
                .popover(isPresented: $showDetails) { details }
            Spacer(minLength: 0)
            if let entry = model.selectedEntry, !entry.response.isEmpty {
                Button("Copy") { model.copy(entry.response) }.buttonStyle(.borderless)
                    .help("Copy answer")
            }
        }.font(AppStyle.caption).foregroundStyle(AppStyle.secondaryText)
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Next lookup").font(.headline)
            RequestControls(model: model)
            Text("A preset override lasts until New lookup or a recipe change.")
                .font(AppStyle.caption).foregroundStyle(.secondary)
            if model.fast {
                Text("Fast may use more plan allowance.").font(AppStyle.caption).foregroundStyle(.secondary)
            }
            if let entry = model.selectedEntry {
                Divider()
                Text("Displayed answer · \(entry.recipeName)").font(.subheadline.weight(.medium))
                Text(entry.displayQuery).font(AppStyle.caption).textSelection(.enabled)
                Text("\(entry.model) · \(entry.effort.isEmpty ? "Default effort" : entry.effort)")
                    .font(AppStyle.caption).textSelection(.enabled)
                Text(entry.serviceDescription).font(AppStyle.caption).textSelection(.enabled)
            }
            Button("Edit presets & recipes…") {
                showDetails = false
                controller.showMain(settings: true)
            }
        }.padding(16).frame(width: 300, alignment: .leading)
    }

    private func result(_ entry: HistoryEntry) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(entry.displayQuery).font(.system(size: 18, weight: .medium, design: .serif))
                .lineLimit(2).textSelection(.enabled)
            if entry.response.isEmpty && entry.status == "pending" {
                Text("Finding the words…").foregroundStyle(.secondary)
            } else {
                Text(
                    (try? AttributedString(
                        markdown: entry.response,
                        options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
                        ?? AttributedString(entry.response)
                )
                .font(AppStyle.body).textSelection(.enabled).lineSpacing(3)
            }
            if entry.status != "pending" && entry.status != "completed" {
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
            controller.shortcutError, controller.launcherError, model.storageWarning,
            model.configurationError, model.error, presetIssue,
        ].compactMap({ $0 }) {
            if !messages.contains(message) { messages.append(message) }
        }
        return messages
    }
    private var needsAccount: Bool { !model.signedIn || !model.planEnabled }
    private var needsSetup: Bool {
        needsAccount
            || (model.currentRecipe != nil
                && (model.currentPreset == nil || model.currentModel == nil
                    || model.configurationError != nil))
    }
    private var layout: QuickLookupLayout {
        QuickLookupLayout(
            fieldCount: model.inputFields.count,
            showsNotice: !notices.isEmpty || needsSetup || model.connecting,
            showsAnswer: model.selectedEntry != nil)
    }
}
