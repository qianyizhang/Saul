import EZCore
import SwiftUI

struct ContentView: View {
    @ObservedObject var model: AppModel
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
                            Text("Each lookup starts fresh.").foregroundStyle(.secondary)
                        }
                        Spacer()
                        if model.busy {
                            Button("Stop", systemImage: "stop.fill") { model.stop() }
                        } else {
                            Button("Edit draft", systemImage: "square.and.pencil") { showsComposer = true }
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
        .disclosureGroupStyle(FullRowDisclosureStyle())
        .onChange(of: model.selection) { _, _ in showsComposer = false }
        .alert(
            "Delete lookup?",
            isPresented: Binding(
                get: { lookupToDelete != nil },
                set: { if !$0 { lookupToDelete = nil } }
            ), presenting: lookupToDelete
        ) { entry in
            Button("Delete lookup", role: .destructive) { model.deleteLookup(entry.id) }
                .disabled(!model.canDeleteLookup)
            Button("Cancel", role: .cancel) {}
        } message: { entry in
            Text("Delete “\(entry.displayQuery)” and its saved answer from this Mac? This cannot be undone.")
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
                Label("New lookup", systemImage: "plus").frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 6)
            }.buttonStyle(.bordered).disabled(model.busy || model.launcherPending).padding(.horizontal, 16)
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
                            Image(systemName: entry.recipeSymbol)
                            Text(entry.recipeName)
                            if entry.status == "pending" {
                                Text("· In progress")
                            } else if entry.status != "completed" {
                                Text("· \(entry.status.capitalized)")
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
                            Text(model.search.isEmpty ? "No lookups yet" : "No matching lookups")
                                .font(AppStyle.caption).foregroundStyle(.secondary)
                            if !model.search.isEmpty {
                                Button("Clear search") { model.search = "" }.buttonStyle(.borderless)
                            }
                        }.frame(maxHeight: .infinity, alignment: .top).padding(.top, 16)
                    }
                }
            Spacer(minLength: 0)
            Divider()
            Button {
                model.openSettings(.account)
            } label: {
                HStack {
                    Image(systemName: "person.crop.circle").font(.title3)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(model.signedIn ? "Settings" : "Connect ChatGPT").font(
                            .system(size: 12, weight: .medium))
                        if model.connecting || !model.minimumMode {
                            Text(model.connecting ? "Connecting…" : "Account & history")
                                .font(AppStyle.caption).foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    Image(systemName: "gearshape").foregroundStyle(.secondary)
                }.padding(6)
            }.buttonStyle(.plain).padding([.horizontal, .bottom], 12)
        }
    }
    private var welcome: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("New lookup").font(AppStyle.subject)
            if !model.minimumMode {
                Text(
                    model.currentRecipe == nil
                        ? "Add a recipe to start your next lookup."
                        : "Choose a recipe, fill in its inputs, and send."
                )
                .font(AppStyle.body).foregroundStyle(.secondary)
            }
            if !model.signedIn {
                Button {
                    model.openSettings(.account)
                } label: {
                    Label("Continue with ChatGPT", systemImage: "person.crop.circle")
                }.buttonStyle(.borderedProminent).padding(.top, 4)
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
                Label(entry.recipeName, systemImage: entry.recipeSymbol)
                    .font(AppStyle.caption).foregroundStyle(AppStyle.accent)
                Spacer()
                if !model.minimumMode {
                    Text(entry.createdAt, style: .time).font(.caption).foregroundStyle(.secondary)
                }
            }
            LookupAnswerText(entry: entry, activity: model.selectedResponseActivity)
            if entry.status != "pending" {
                HStack {
                    Button {
                        model.copy(entry.response)
                    } label: {
                        Label("Copy", systemImage: "doc.on.doc")
                    }.disabled(entry.response.isEmpty)
                    Button {
                        model.reuse(entry)
                    } label: {
                        Label("Use again", systemImage: "arrow.counterclockwise")
                    }.disabled(model.busy || model.launcherPending)
                    Menu {
                        Button("Export…", systemImage: "square.and.arrow.up") { model.export(entry) }
                        deleteButton(entry)
                    } label: {
                        Label("More", systemImage: "ellipsis")
                    }.menuStyle(.borderlessButton).fixedSize()
                    Spacer()
                    if entry.status != "completed" {
                        Text(entry.status.capitalized).font(.caption).foregroundStyle(.orange)
                    }
                }.buttonStyle(.borderless).font(.caption)
                if let error = entry.error {
                    Text(error).font(.caption).foregroundStyle(.red).textSelection(.enabled)
                }
            }
            DisclosureGroup("Details") {
                LookupDetails(entry: entry).padding(.top, 8)
                if entry.mode == .spelling {
                    DisclosureGroup("Full response") {
                        AnswerMarkdown(text: entry.response).padding(.top, 8)
                    }
                }
            }.font(AppStyle.caption).foregroundStyle(AppStyle.secondaryText)
        }
    }
    private func deleteButton(_ entry: HistoryEntry) -> some View {
        Button(role: .destructive) {
            lookupToDelete = entry
        } label: {
            Label("Delete lookup", systemImage: "trash")
        }.disabled(!model.canDeleteLookup)
    }
    private var composer: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                if model.currentRecipe == nil {
                    Text("No recipes yet").font(.headline)
                } else {
                    RecipePicker(model: model)
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
            RecipeInputs(model: model)
            if model.currentRecipe != nil {
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
                        Button {
                            model.send()
                        } label: {
                            Image(systemName: "arrow.up").fontWeight(.semibold).frame(width: 22, height: 22)
                        }
                        .accessibilityLabel("Send query").buttonStyle(.borderedProminent).disabled(
                            !model.canSend
                        )
                        .help("Send · \(model.shortcuts.binding(for: .send).display)")
                    }
                }.controlSize(.small).disabled(model.connecting)
                Text(composerHint)
                    .font(AppStyle.caption).foregroundStyle(AppStyle.secondaryText)
                    .lineLimit(1).help(composerHint)
                    .frame(height: 16, alignment: .leading)
            }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(16).background(
            Color(nsColor: .controlBackgroundColor),
            in: RoundedRectangle(cornerRadius: AppStyle.composerRadius)
        )
        .overlay(RoundedRectangle(cornerRadius: AppStyle.composerRadius).stroke(.quaternary, lineWidth: 1))
    }
    private var composerHint: String {
        if model.connecting { return "Connecting to ChatGPT…" }
        if !model.signedIn { return "Connect ChatGPT to send a lookup." }
        if !model.planEnabled { return "Enable plan usage in Account & history." }
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
