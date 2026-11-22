import EZCore
import SaulNativeValues
import SwiftUI

struct ContentView: View {
    @ObservedObject var model: AppModel
    @State private var lookupToDelete: HistoryRow?
    @State private var page = NotebookPage.answer

    var body: some View {
        // Keep the system sidebar toolbar's own icon-only style outside the columns.
        NavigationSplitView {
            sidebar
                .labelStyle(EverydayLabelStyle(minimum: model.minimumMode))
                .navigationSplitViewColumnWidth(min: 210, ideal: 240, max: 300)
        } detail: {
            VStack(spacing: 0) {
                ThinkingDivider(activity: model.selectedResponseActivity)
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        if let entry = model.selectedEntry {
                            if model.usesSketch && model.showsMainComposer {
                                composer
                            } else {
                                answer(entry)
                            }
                        } else if model.selection != nil {
                            if model.historyDetailLoading {
                                ProgressView("Loading saved lookup…")
                            } else {
                                Text(model.historyDetailError ?? "This saved lookup is unavailable.")
                                    .foregroundStyle(.secondary)
                                Button("Retry") { model.reloadHistorySelection() }
                            }
                        } else {
                            welcome
                            composer
                        }
                        if model.selectedEntry != nil {
                            if let error = model.historyDetailError {
                                Text("Could not refresh this saved lookup. \(error)")
                                    .foregroundStyle(.secondary)
                                Button("Retry") { model.reloadHistorySelection() }
                            } else if model.historyDetailLoading {
                                ProgressView("Refreshing saved lookup…")
                            }
                        }
                    }
                    .padding(30)
                    .frame(
                        maxWidth: (model.selectedEntry?.mode == .spelling && page == .answer)
                            || model.usesSketch ? 1140 : 684, alignment: .leading
                    )
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
                if model.selectedEntry != nil && model.showsMainComposer && !model.usesSketch {
                    Divider()
                    composer.padding(20).frame(maxWidth: 664)
                } else if model.selectedEntry != nil && !model.showsMainComposer {
                    if model.busy {
                        HStack {
                            Spacer()
                            AttemptControls(model: model)
                        }.padding(.horizontal, 24).padding(.vertical, 12)
                    } else if model.hasRetainedDraft && !model.launcherPending {
                        Divider()
                        HStack {
                            Text("Retained draft").foregroundStyle(.secondary)
                            Spacer()
                            Button("Edit") { model.showsMainComposer = true }
                                .help("Edit retained draft").accessibilityLabel("Edit draft")
                        }.font(AppStyle.caption).padding(.horizontal, 24).padding(.vertical, 10)
                    }
                }
                if !model.minimumMode, let entry = model.selectedEntry {
                    Divider()
                    LookupStatusLine(entry: entry)
                        .padding(.horizontal, 20).padding(.vertical, 7)
                }
            }
            .background(Color(nsColor: .textBackgroundColor))
            .labelStyle(EverydayLabelStyle(minimum: model.minimumMode))
        }
        .onChange(of: model.selectedEntry?.id) { _, _ in page = .answer }
        .tint(AppStyle.accent)
        .disclosureGroupStyle(FullRowDisclosureStyle())
        .alert(
            "Delete lookup?",
            isPresented: Binding(
                get: { lookupToDelete != nil },
                set: { if !$0 { lookupToDelete = nil } }
            ), presenting: lookupToDelete
        ) { entry in
            Button("Delete", role: .destructive) { model.deleteLookup(entry.recordID) }
                .disabled(!model.canDeleteLookup(entry.recordID))
            Button("Cancel", role: .cancel) {}
        } message: { entry in
            Text(
                "Delete “\(entry.displayQuery)” and its saved answer from shared history in EZ and Saul? This cannot be undone."
            )
        }
        .sheet(isPresented: $model.showSettings) { SettingsView(model: model) }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ez").font(.system(size: 22, weight: .bold))
                .padding(.top, 20).padding(.horizontal, 18).padding(.bottom, 8)
            VStack(alignment: .leading, spacing: 0) {
                FullRowButton {
                    model.newQuery()
                } label: {
                    Label("New run", systemImage: "square.and.pencil").labelStyle(.titleAndIcon)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .notebookRow(selected: model.selection == nil)
                }
                .accessibilityAddTraits(model.selection == nil ? .isSelected : [])
                .disabled(model.busy || model.launcherPending)
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").accessibilityHidden(true)
                    TextField("Search history", text: $model.search).textFieldStyle(.plain)
                        .accessibilityLabel("Search history")
                }.padding(.horizontal, 8).frame(minHeight: AppStyle.rowHeight).foregroundStyle(.secondary)
            }.font(AppStyle.control).padding(.horizontal, 10).padding(.bottom, 8)
            HStack {
                Text("History").font(AppStyle.control)
                Spacer()
                if !model.minimumMode {
                    Text("\(model.historyTotal)").font(.caption.monospacedDigit())
                }
            }.foregroundStyle(.secondary).padding(.horizontal, 18)
            List(selection: $model.selection) {
                ForEach(model.filteredEntries) { entry in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(entry.displayQuery).font(AppStyle.control).lineLimit(2)
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
                        }.font(AppStyle.caption).foregroundStyle(.secondary)
                    }.padding(.vertical, 5).tag(entry.id)
                        .onAppear {
                            if entry.id == model.entries.last?.id { model.loadMoreHistory() }
                        }
                        .contextMenu {
                            deleteButton(entry)
                        }
                }
                if model.historyHasMore {
                    Button(model.historyLoading ? "Loading…" : "Load more") { model.loadMoreHistory() }
                        .disabled(model.historyLoading)
                }
            }.listStyle(.sidebar)
                .overlay {
                    if model.filteredEntries.isEmpty && model.historyLoading {
                        ProgressView("Loading history…")
                    } else if model.filteredEntries.isEmpty {
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
                model.openSettings(model.connectionGuidance(for: model.currentPreset)?.section ?? .overview)
            } label: {
                HStack {
                    if !model.minimumMode { Image(systemName: "person.crop.circle").font(.title3) }
                    VStack(alignment: .leading, spacing: 3) {
                        Text(
                            "Settings"
                        ).font(
                            AppStyle.control)
                        if model.connecting || !model.minimumMode {
                            Text(model.connecting ? "Connecting…" : "Connections, presets & actions")
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
            if model.currentAction == nil {
                Text("Add an action to start your next run.").font(AppStyle.body).foregroundStyle(.secondary)
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private func answer(_ entry: HistoryEntry) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            Text(entry.displayQuery).font(AppStyle.subject)
                .lineLimit(2).textSelection(.enabled).help(entry.displayQuery)
            HStack(spacing: 4) {
                ForEach(NotebookPage.allCases, id: \.self) { item in
                    let title = item == .text ? model.inspectionTitle(for: entry) : item.rawValue
                    FullRowButton {
                        page = item
                    } label: {
                        Text(title).notebookRow(selected: page == item)
                    }
                    .accessibilityAddTraits(page == item ? .isSelected : [])
                }
            }
            Divider()
            switch page {
            case .answer:
                LookupAnswerText(
                    entry: entry, activity: model.selectedResponseActivity, showsShortSubject: false,
                    imageData: model.imageData(for: entry), imageLoading: model.imageLoading)
            case .details:
                MetadataRow("Action", value: entry.actionName)
                LookupDetails(entry: entry)
            case .text:
                InputOutputInspector(
                    entry: entry, minimum: model.minimumMode,
                    transientFailure: model.isTransientFailure(entry)
                ).id(entry.id)
            }
            RetryAttemptNotice(model: model, entry: entry)
            if let parentID = entry.parentID {
                Button("Previous answer") { model.selection = parentID }.buttonStyle(.borderless)
            }
            if let source = entry.sourceURL, let url = URL(string: source),
                ["http", "https"].contains(url.scheme?.lowercased() ?? "")
            {
                Link(entry.sourceTitle?.isEmpty == false ? entry.sourceTitle! : source, destination: url)
                    .font(AppStyle.caption)
            }
            if entry.status != "pending" {
                if entry.status != "completed" {
                    Text(entry.status.capitalized).font(.caption).foregroundStyle(.orange)
                }
                if let error = entry.error {
                    Text(error).font(.caption).foregroundStyle(.red).textSelection(.enabled)
                }
                answerActions(entry)
            }
            if page == .answer { FollowUpComposer(model: model, entry: entry).id(entry.id) }
        }
    }

    @ViewBuilder private func answerActions(_ entry: HistoryEntry) -> some View {
        let allowsDownload = entry.capability == .draw && model.imageData(for: entry) != nil
        let allowsCopy = entry.capability == .write && !entry.response.isEmpty
        let allowsReuse = model.canReuse(entry)
        let allowsDelete = model.canDeleteLookup(entry.recordID)
        if allowsDownload || allowsCopy || allowsReuse || entry.capability == .write || allowsDelete {
            HStack(spacing: 12) {
                if allowsDownload {
                    Button("Download") { model.downloadImage(entry) }
                }
                if allowsCopy {
                    Button {
                        model.copy(entry.citedResponse)
                    } label: {
                        ControlLabel(symbol: .copy)
                    }.help("Copy answer").accessibilityLabel("Copy answer")
                }
                if allowsReuse {
                    Button("Reuse") { model.reuse(entry) }
                        .help("Restore this request as an editable draft")
                }
                if entry.capability == .write {
                    Button("Export…") { model.export(entry) }.help("Export this lookup as Markdown")
                }
                Spacer(minLength: 4)
                if allowsDelete {
                    deleteButton(HistoryRow(entry)).foregroundStyle(DesignTokens.danger)
                }
            }
            .buttonStyle(.borderless).tint(.primary).font(AppStyle.control)
        }
    }

    private func deleteButton(_ entry: HistoryRow) -> some View {
        Button(role: .destructive) {
            lookupToDelete = entry
        } label: {
            Label(model.minimumMode ? "Delete" : "Delete lookup", systemImage: "trash")
        }.disabled(!model.canDeleteLookup(entry.recordID))
    }
    private var composer: some View {
        VStack(alignment: .leading, spacing: 12) {
            if model.selectedEntry != nil {
                HStack {
                    Text("Draft").font(AppStyle.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Hide") { model.showsMainComposer = false }
                        .buttonStyle(.borderless).help("Hide draft").accessibilityLabel("Hide draft")
                }
            }
            LookupChoices(model: model)
            Divider()
            ActionInputs(model: model)
            if model.currentAction != nil {
                HStack(spacing: 8) {
                    Spacer(minLength: 2)
                    LookupBillingLabel(model: model)
                    NextLookupDetailsButton(model: model)
                    if model.busy {
                        AttemptControls(model: model)
                    } else {
                        Button {
                            model.send()
                        } label: {
                            ControlLabel(symbol: .send).frame(width: 18, height: 24)
                        }
                        .accessibilityLabel("Run action").buttonStyle(.borderedProminent).disabled(
                            !model.canSend
                        )
                        .help("Run · \(model.shortcuts.binding(for: .send).display)")
                    }
                }.controlSize(.regular)
                if !composerHint.isEmpty {
                    Text(composerHint).font(AppStyle.caption).foregroundStyle(AppStyle.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let section = model.currentConnectionSetupSection {
                    Button(AppModel.setupLabel(for: section)) {
                        if section == .configuration { model.settingsPresetID = model.currentPreset?.id }
                        model.openSettings(section)
                    }
                } else if model.connectionIssue == nil, let preset = model.currentPreset,
                    model.presetIssue(preset) != nil
                {
                    Button("Edit preset") {
                        model.settingsPresetID = preset.id
                        model.openSettings(.configuration)
                    }.disabled(model.busy)
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private var composerHint: String {
        if let issue = model.connectionIssue { return issue }
        if let warning = model.currentConnectionWarning { return warning }
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

private enum NotebookPage: String, CaseIterable {
    case answer = "Answer"
    case details = "Details"
    case text
}
