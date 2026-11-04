import EZCore
import SwiftUI

struct ContentView: View {
    @ObservedObject var model: AppModel
    @Environment(\.openWindow) private var openWindow
    @State private var lookupToDelete: HistoryEntry?
    @State private var showsComposer = false
    var body: some View {
        NavigationSplitView {
            sidebar
                .navigationSplitViewColumnWidth(min: 210, ideal: 240, max: 300)
        } detail: {
            VStack(spacing: 0) {
                ThinkingDivider(activity: model.selectedResponseActivity)
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        if let entry = model.selectedEntry {
                            answer(entry)
                        } else {
                            welcome
                            composer
                        }
                    }
                    .padding(30)
                    .frame(maxWidth: model.selectedEntry?.mode == .spelling ? 1140 : 820, alignment: .leading)
                    .frame(maxWidth: .infinity)
                }
                if let warning = model.storageWarning {
                    banner(warning, symbol: "externaldrive.badge.exclamationmark", color: .orange) {
                        model.storageWarning = nil
                    }
                }
                if let error = model.error {
                    banner(error, symbol: "exclamationmark.circle", color: .red) { model.error = nil }
                }
                if model.selectedEntry != nil && showsComposer {
                    composer.padding(20)
                } else if model.selectedEntry != nil {
                    HStack {
                        if !model.minimumMode {
                            Text("New run starts fresh.").foregroundStyle(.secondary)
                        }
                        Spacer()
                        if model.busy {
                            Button("Stop", systemImage: "stop.fill") { model.stop() }
                        } else {
                            Button(
                                model.minimumMode ? "Edit" : "Edit draft", systemImage: "square.and.pencil"
                            ) { showsComposer = true }.help("Edit draft").accessibilityLabel("Edit draft")
                        }
                    }.font(AppStyle.caption).padding(.horizontal, 24).padding(.vertical, 12)
                }
                if !model.minimumMode, let entry = model.selectedEntry {
                    Divider()
                    LookupStatusLine(entry: entry)
                        .padding(.horizontal, 20).padding(.vertical, 7)
                }
            }
            .background(Color(nsColor: .textBackgroundColor))
        }
        .tint(AppStyle.accent)
        .labelStyle(EverydayLabelStyle(minimum: model.minimumMode))
        .disclosureGroupStyle(FullRowDisclosureStyle())
        .onChange(of: model.selection) { _, _ in showsComposer = false }
        .alert(
            "Delete lookup?",
            isPresented: Binding(
                get: { lookupToDelete != nil },
                set: { if !$0 { lookupToDelete = nil } }
            ), presenting: lookupToDelete
        ) { entry in
            Button("Delete", role: .destructive) { model.deleteLookup(entry.id) }
                .disabled(!model.canDeleteLookup)
            Button("Cancel", role: .cancel) {}
        } message: { entry in
            Text(
                "Delete “\(entry.displayQuery)” and its saved answer from shared history in EZ and Saul? This cannot be undone."
            )
        }
        .sheet(isPresented: $model.showSettings) { SettingsView(model: model) }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("ez").font(.system(size: model.minimumMode ? 26 : 35, weight: .bold, design: .rounded))
                    .foregroundStyle(
                        AppStyle.accent)
                if !model.minimumMode {
                    Text("a little clarity.").font(.system(size: 11)).foregroundStyle(.secondary)
                }
            }.padding(.top, model.minimumMode ? 20 : 28).padding(.horizontal, 18)
            Button {
                model.newQuery()
            } label: {
                Label(model.minimumMode ? "New" : "New run", systemImage: "plus").frame(
                    maxWidth: .infinity, alignment: .leading
                )
                .padding(.vertical, 6)
            }.help("New run").accessibilityLabel("New run").buttonStyle(.bordered)
                .disabled(model.busy || model.launcherPending).padding(.horizontal, 16)
            TextField("Search history", text: $model.search).textFieldStyle(.roundedBorder).padding(
                .horizontal, 16)
            HStack {
                Text("History").font(AppStyle.caption)
                Spacer()
                if !model.minimumMode {
                    Text("\(model.filteredEntries.count)").font(.caption.monospacedDigit())
                }
            }.foregroundStyle(.secondary).padding(.horizontal, 18)
            List(selection: $model.selection) {
                ForEach(model.filteredEntries) { entry in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(entry.displayQuery).font(.system(size: 13, weight: .medium)).lineLimit(2)
                        HStack(spacing: 4) {
                            if !model.minimumMode {
                                Image(systemName: entry.actionSymbol)
                                Text(entry.actionName)
                            }
                            if entry.status == "pending" {
                                Text(model.minimumMode ? "In progress" : "· In progress")
                            } else if entry.status != "completed" {
                                Text(
                                    model.minimumMode
                                        ? entry.status.capitalized : "· \(entry.status.capitalized)")
                            }
                        }.font(.system(size: 10)).foregroundStyle(.secondary)
                    }.padding(.vertical, 5).tag(entry.id)
                        .contextMenu {
                            deleteButton(entry)
                        }
                }
            }.listStyle(.sidebar)
                .overlay {
                    if model.filteredEntries.isEmpty {
                        VStack(spacing: 8) {
                            Text(model.search.isEmpty ? "No runs yet" : "No matching runs")
                                .font(AppStyle.caption).foregroundStyle(.secondary)
                            if !model.search.isEmpty {
                                Button(model.minimumMode ? "Clear" : "Clear search") { model.search = "" }
                                    .help("Clear search").accessibilityLabel("Clear search").buttonStyle(
                                        .borderless)
                            }
                        }.frame(maxHeight: .infinity, alignment: .top).padding(.top, 16)
                    }
                }
            Spacer(minLength: 0)
            Divider()
            FullRowButton {
                model.openSettings(model.signedIn ? .overview : .account)
            } label: {
                HStack {
                    if !model.minimumMode { Image(systemName: "person.crop.circle").font(.title3) }
                    VStack(alignment: .leading, spacing: 3) {
                        Text(
                            "Settings"
                        ).font(
                            .system(size: 12, weight: .medium))
                        if model.connecting || !model.minimumMode {
                            Text(model.connecting ? "Connecting…" : "Providers, presets & actions")
                                .font(AppStyle.caption).foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    if !model.minimumMode { Image(systemName: "gearshape").foregroundStyle(.secondary) }
                }.padding(6)
            }.padding([.horizontal, .bottom], 12)
        }
    }
    private var welcome: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("New run").font(AppStyle.subject)
            if !model.minimumMode {
                Text(
                    model.currentAction == nil
                        ? "Add an action to start your next run."
                        : "Choose an action, fill in its inputs, and run it."
                )
                .font(AppStyle.body).foregroundStyle(.secondary)
            }
            if model.needsPlan && !model.signedIn {
                Button {
                    model.openSettings(.account)
                } label: {
                    Label(
                        model.minimumMode ? "Connect" : "Continue with ChatGPT",
                        systemImage: "person.crop.circle")
                }.help("Continue with ChatGPT").accessibilityLabel("Continue with ChatGPT")
                    .buttonStyle(.borderedProminent).padding(.top, 4)
                if !model.minimumMode {
                    Text("Uses your eligible ChatGPT plan. No API key needed.")
                        .font(AppStyle.caption).foregroundStyle(.secondary)
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private func answer(_ entry: HistoryEntry) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Label(entry.actionName, systemImage: entry.actionSymbol)
                    .font(AppStyle.caption).foregroundStyle(AppStyle.accent)
                Spacer()
                if !model.minimumMode {
                    Text(entry.createdAt, style: .time).font(.caption).foregroundStyle(.secondary)
                }
            }
            UnsavedAttemptNotice(model: model, entry: entry)
            LookupAnswerText(
                entry: entry, activity: model.selectedResponseActivity,
                imageData: model.imageData(for: entry), imageLoading: model.imageLoading)
            if let parentID = entry.parentID, model.entries.contains(where: { $0.id == parentID }) {
                Button("Previous answer") { model.selection = parentID }.buttonStyle(.borderless)
            }
            if let source = entry.sourceURL, let url = URL(string: source),
                ["http", "https"].contains(url.scheme?.lowercased() ?? "")
            {
                Link(entry.sourceTitle?.isEmpty == false ? entry.sourceTitle! : source, destination: url)
                    .font(AppStyle.caption)
            }
            FollowUpComposer(model: model, entry: entry).id(entry.id)
            if entry.status != "pending" {
                HStack {
                    if entry.capability == .draw {
                        Button("Download") { model.downloadImage(entry) }
                            .disabled(!entry.hasImage || model.imageLoading)
                    } else {
                        Button {
                            model.copy(entry.citedResponse)
                        } label: {
                            Label("Copy", systemImage: "doc.on.doc")
                        }.disabled(entry.response.isEmpty)
                    }
                    if !model.minimumMode && entry.sourceID == nil {
                        Button("Use again", systemImage: "arrow.counterclockwise") { model.reuse(entry) }
                            .disabled(model.busy || model.launcherPending)
                    }
                    Menu {
                        if model.minimumMode && entry.sourceID == nil {
                            Button("Reuse") { model.reuse(entry) }.disabled(
                                model.busy || model.launcherPending
                            )
                            .help("Restore this saved request as a draft").accessibilityLabel("Use again")
                        }
                        if entry.capability == .write {
                            Button("Export…", systemImage: "square.and.arrow.up") { model.export(entry) }
                        }
                        deleteButton(entry)
                    } label: {
                        Label("More", systemImage: "ellipsis")
                    }.menuStyle(.borderlessButton).fixedSize()
                    Spacer()
                    if entry.status != "completed" && entry.status != "unsaved" {
                        Text(entry.status.capitalized).font(.caption).foregroundStyle(.orange)
                    }
                }.buttonStyle(.borderless).font(.caption)
                if let error = entry.error {
                    Text(error).font(.caption).foregroundStyle(.red).textSelection(.enabled)
                }
            }
            if !model.minimumMode {
                InputOutputInspector(entry: entry, minimum: model.minimumMode).id(entry.id)
            }
            DisclosureGroup("Details") {
                LookupDetails(entry: entry).padding(.top, 8)
                if model.minimumMode {
                    InputOutputInspector(entry: entry, minimum: model.minimumMode).id(entry.id)
                }
            }.font(AppStyle.caption).disclosureGroupStyle(FullRowDisclosureStyle())
        }
    }
    private func deleteButton(_ entry: HistoryEntry) -> some View {
        Button(role: .destructive) {
            lookupToDelete = entry
        } label: {
            Label(model.minimumMode ? "Delete" : "Delete lookup", systemImage: "trash")
        }.disabled(!model.canDeleteLookup)
    }
    private var composer: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                if model.currentAction == nil {
                    Text("No actions yet").font(.headline)
                } else {
                    ActionPicker(model: model)
                }
                if model.selectedEntry != nil {
                    Button {
                        showsComposer = false
                    } label: {
                        Image(systemName: "chevron.down")
                    }
                    .buttonStyle(.borderless).help("Hide draft").accessibilityLabel("Hide draft")
                }
            }
            ActionInputs(model: model)
            if model.currentAction != nil {
                Divider()
                HStack(spacing: 8) {
                    RequestControls(model: model)
                    Spacer(minLength: 2)
                    if model.busy {
                        Button {
                            model.stop()
                        } label: {
                            Image(systemName: "stop.fill")
                        }.accessibilityLabel("Stop generating").help(
                            "Stop generating · \(model.shortcuts.binding(for: .stop).display)")
                    } else {
                        Button("Run") { model.send() }
                            .accessibilityLabel("Run action").buttonStyle(.borderedProminent).disabled(
                                !model.canSend
                            )
                            .help("Run · \(model.shortcuts.binding(for: .send).display)")
                    }
                }.controlSize(.small).disabled(model.needsPlan && model.connecting)
                if model.currentProvider?.kind == .openAIAPI {
                    Text(
                        model.currentAction?.webSearch == true
                            ? "OpenAI API · search charges apply" : "OpenAI API · billed separately"
                    ).font(AppStyle.caption).foregroundStyle(.secondary)
                }
                if !composerHint.isEmpty {
                    Text(composerHint).font(AppStyle.caption).foregroundStyle(AppStyle.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(16).background(
            Color(nsColor: .controlBackgroundColor),
            in: RoundedRectangle(cornerRadius: AppStyle.composerRadius)
        )
        .overlay(RoundedRectangle(cornerRadius: AppStyle.composerRadius).stroke(.quaternary, lineWidth: 1))
    }
    private var composerHint: String {
        if model.needsPlan && model.connecting { return "Connecting to ChatGPT…" }
        if let issue = model.providerIssue { return issue }
        return model.requestIssue
            ?? (model.minimumMode
                ? "" : "\(model.shortcuts.binding(for: .send).display) to send · Each lookup starts fresh.")
    }

    private func banner(
        _ message: String, symbol: String, color: Color, dismiss: @escaping () -> Void
    ) -> some View {
        HStack(alignment: .top) {
            Image(systemName: symbol).foregroundStyle(color)
            Text(message).font(.caption).textSelection(.enabled)
            Spacer()
            Button(action: dismiss) {
                Image(systemName: "xmark")
            }.buttonStyle(.plain).accessibilityLabel("Dismiss message")
        }.padding(12).background(color.opacity(0.07)).padding(.horizontal, 20)
    }
}
