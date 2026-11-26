import EZCore
import SaulNativeValues
import SwiftUI

struct ContentView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var lookup: LookupSession
    @State private var lookupToDelete: HistoryRow?
    @State private var page = NotebookPage.answer
    @State private var showsRecentlyDeleted = false

    var body: some View {
        // Keep the system sidebar toolbar's own icon-only style outside the columns.
        NavigationSplitView {
            sidebar
                .labelStyle(EverydayLabelStyle(minimum: model.minimumMode))
                .navigationSplitViewColumnWidth(min: 210, ideal: 240, max: 300)
        } detail: {
            VStack(spacing: 0) {
                ThinkingDivider(activity: lookup.selectedResponseActivity)
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        if let entry = lookup.selectedEntry {
                            if lookup.usesSketch && lookup.showsMainComposer {
                                composer
                            } else {
                                answer(entry)
                            }
                        } else if lookup.selection != nil {
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
                        if lookup.selectedEntry != nil {
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
                        maxWidth: (lookup.selectedEntry?.mode == .spelling && page == .answer)
                            || lookup.usesSketch ? 1140 : 684, alignment: .leading
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
                if lookup.selectedEntry != nil && lookup.showsMainComposer && !lookup.usesSketch {
                    Divider()
                    composer.padding(20).frame(maxWidth: 664)
                } else if lookup.selectedEntry != nil && !lookup.showsMainComposer {
                    if lookup.busy {
                        HStack {
                            Spacer()
                            AttemptControls(model: model, lookup: model.lookup)
                        }.padding(.horizontal, 24).padding(.vertical, 12)
                    } else if lookup.hasRetainedDraft && !lookup.launcherPending {
                        Divider()
                        HStack {
                            if !model.minimumMode { Text("Retained draft").foregroundStyle(.secondary) }
                            Spacer()
                            Button(model.minimumMode ? "Edit draft" : "Edit") {
                                lookup.showsMainComposer = true
                            }
                            .help("Edit retained draft").accessibilityLabel("Edit draft")
                        }.font(AppStyle.caption).padding(.horizontal, 24).padding(.vertical, 10)
                    }
                }
                if !model.minimumMode, let entry = lookup.selectedEntry {
                    Divider()
                    LookupStatusLine(entry: entry)
                        .padding(.horizontal, 20).padding(.vertical, 7)
                }
            }
            .background(Color(nsColor: .textBackgroundColor))
            .labelStyle(EverydayLabelStyle(minimum: model.minimumMode))
        }
        .onChange(of: lookup.selectedEntry?.id) { _, _ in page = .answer }
        .tint(AppStyle.accent)
        .disclosureGroupStyle(FullRowDisclosureStyle())
        .alert(
            "Delete lookup?",
            isPresented: Binding(
                get: { lookupToDelete != nil },
                set: { if !$0 { lookupToDelete = nil } }
            ), presenting: lookupToDelete
        ) { entry in
            if model.canStopAndDeleteLookup(entry.recordID) {
                Button("Stop and delete", role: .destructive) { model.stopAndDeleteLookup(entry.recordID) }
            } else {
                Button("Delete", role: .destructive) {
                    model.deleteLookup(entry.recordID, expectedRevision: entry.revision)
                }
                .disabled(!model.canDeleteLookup(entry.recordID))
            }
            Button("Cancel", role: .cancel) {}
        } message: { entry in
            Text(
                "Move “\(entry.displayQuery)” to Recently deleted in EZ and Saul? You can restore it for 365 days."
            )
        }
        .sheet(isPresented: $model.showSettings) { SettingsView(model: model) }
        .sheet(isPresented: $showsRecentlyDeleted) {
            if let library = model.library {
                RecentlyDeletedView(model: model, library: library)
            }
        }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ez").font(.system(size: 22, weight: .bold))
                .padding(.top, 20).padding(.horizontal, 18).padding(.bottom, 8)
            VStack(alignment: .leading, spacing: 0) {
                FullRowButton {
                    lookup.newQuery()
                } label: {
                    Label("New run", systemImage: "square.and.pencil").labelStyle(.titleAndIcon)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .notebookRow(selected: lookup.selection == nil)
                }
                .accessibilityAddTraits(lookup.selection == nil ? .isSelected : [])
                .disabled(lookup.busy || lookup.launcherPending)
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
            List(selection: $lookup.selection) {
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
            if model.library != nil {
                FullRowButton {
                    showsRecentlyDeleted = true
                } label: {
                    Label("Recently deleted", systemImage: "trash")
                        .labelStyle(.titleAndIcon)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .notebookRow(selected: false)
                }
                .padding(.horizontal, 10)
            }
            Spacer(minLength: 0)
            Divider()
            FullRowButton {
                model.openSettings(lookup.connectionGuidance(for: lookup.currentPreset)?.section ?? .overview)
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
            if lookup.currentAction == nil && !model.minimumMode {
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
                    entry: entry, activity: lookup.selectedResponseActivity, showsShortSubject: false,
                    imageData: model.imageData(for: entry), imageLoading: model.imageLoading)
            case .details:
                LookupDetails(entry: entry)
            case .text:
                InputOutputInspector(
                    entry: entry, minimum: model.minimumMode,
                    transientFailure: model.isTransientFailure(entry)
                ).id(entry.id)
            }
            RetryAttemptNotice(lookup: lookup, entry: entry)
            if let parentID = entry.parentID {
                Button("Previous answer") { lookup.selection = parentID }.buttonStyle(.borderless)
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
            if page == .answer {
                FollowUpComposer(lookup: lookup, entry: entry).id(entry.id)
            }
        }
    }

    @ViewBuilder private func answerActions(_ entry: HistoryEntry) -> some View {
        let allowsDownload = entry.capability == .draw && model.imageData(for: entry) != nil
        let allowsCopy = entry.capability == .write && !entry.response.isEmpty
        let allowsReuse = lookup.canReuse(entry)
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
                    Button("Reuse") { lookup.reuse(entry) }
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
        }.disabled(!model.canDeleteLookup(entry.recordID) && !model.canStopAndDeleteLookup(entry.recordID))
    }
    private var composer: some View {
        VStack(alignment: .leading, spacing: 12) {
            if lookup.selectedEntry != nil {
                HStack {
                    if !model.minimumMode {
                        Text("Draft").font(AppStyle.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button(model.minimumMode ? "Hide draft" : "Hide") { lookup.showsMainComposer = false }
                        .buttonStyle(.borderless).help("Hide draft").accessibilityLabel("Hide draft")
                }
            }
            LookupChoices(model: model, lookup: model.lookup)
            Divider()
            ActionInputs(model: model, lookup: model.lookup)
            if lookup.currentAction != nil {
                HStack(spacing: 8) {
                    Spacer(minLength: 2)
                    LookupBillingLabel(lookup: lookup)
                    NextLookupDetailsButton(model: model, lookup: model.lookup)
                    if lookup.busy {
                        AttemptControls(model: model, lookup: model.lookup)
                    } else {
                        Button {
                            lookup.send()
                        } label: {
                            ControlLabel(symbol: .send).frame(width: 18, height: 24)
                        }
                        .accessibilityLabel("Run action").buttonStyle(.borderedProminent).disabled(
                            !lookup.canSend
                        )
                        .help("Run · \(model.shortcuts.binding(for: .send).display)")
                    }
                }.controlSize(.regular)
                if !composerHint.isEmpty {
                    Text(composerHint).font(AppStyle.caption).foregroundStyle(AppStyle.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let section = lookup.currentConnectionSetupSection {
                    Button(AppModel.setupLabel(for: section)) {
                        if section == .configuration { model.settingsPresetID = lookup.currentPreset?.id }
                        model.openSettings(section)
                    }
                } else if lookup.connectionIssue == nil, let preset = lookup.currentPreset,
                    model.presetIssue(preset) != nil
                {
                    Button("Edit preset") {
                        model.settingsPresetID = preset.id
                        model.openSettings(.configuration)
                    }.disabled(lookup.busy)
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private var composerHint: String {
        if let issue = lookup.connectionIssue { return issue }
        if let warning = lookup.currentConnectionWarning { return warning }
        return lookup.requestIssue
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
