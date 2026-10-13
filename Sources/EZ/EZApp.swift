import EZCore
import SwiftUI

@main struct EZApp: App {
    @StateObject private var model = AppModel()
    var body: some Scene {
        Window("EZ", id: "main") {
            ContentView(model: model)
                .frame(minWidth: 760, minHeight: 560)
                .task { await model.connect() }
                .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification))
            { _ in model.shutdown() }
        }
        .defaultSize(width: 1020, height: 740)
        .windowStyle(.hiddenTitleBar)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Lookup") { model.newQuery() }.keyboardShortcut("n").disabled(model.busy)
            }
            CommandGroup(replacing: .appSettings) {
                Button("Settings…") { model.showSettings = true }.keyboardShortcut(",")
            }
        }
    }
}

private let accent = Color(
    nsColor: NSColor(name: "EZAccent") { appearance in
        if appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {
            return NSColor(calibratedRed: 0.43, green: 0.76, blue: 0.63, alpha: 1)
        }
        return NSColor(calibratedRed: 0.16, green: 0.43, blue: 0.35, alpha: 1)
    })

struct ContentView: View {
    @ObservedObject var model: AppModel
    @FocusState private var focused: Bool
    var body: some View {
        NavigationSplitView {
            sidebar
                .navigationSplitViewColumnWidth(min: 210, ideal: 240, max: 300)
        } detail: {
            VStack(spacing: 0) {
                header
                Divider()
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        if let entry = model.selectedEntry {
                            answer(entry)
                        } else {
                            welcome
                        }
                    }
                    .padding(30)
                    .frame(maxWidth: 820, alignment: .leading)
                    .frame(maxWidth: .infinity)
                }
                if let warning = model.storageWarning {
                    banner(warning, symbol: "externaldrive.badge.exclamationmark", color: .orange)
                }
                if let error = model.error { banner(error, symbol: "exclamationmark.circle", color: .red) }
                composer
            }
            .background(Color(nsColor: .textBackgroundColor))
        }
        .tint(accent)
        .sheet(isPresented: $model.showSettings) { SettingsView(model: model) }
        .onChange(of: model.selectedModel) { _, _ in model.normalizeSelection() }
        .onChange(of: model.selection) { _, value in if value == nil { focused = true } }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("ez").font(.system(size: 35, weight: .bold, design: .rounded)).foregroundStyle(accent)
                Text("a little clarity.").font(.system(size: 11)).foregroundStyle(.secondary)
            }.padding(.top, 28).padding(.horizontal, 18)
            Button {
                model.newQuery()
                focused = true
            } label: {
                Label("New lookup", systemImage: "plus").frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 6)
            }.buttonStyle(.bordered).disabled(model.busy).padding(.horizontal, 16)
            TextField("Search history", text: $model.search).textFieldStyle(.roundedBorder).padding(
                .horizontal, 16)
            HStack {
                Text("YOUR LOOKUPS").font(.system(size: 10, weight: .semibold)).tracking(1.4)
                Spacer()
                Text("\(model.entries.count)").font(.caption.monospacedDigit())
            }.foregroundStyle(.secondary).padding(.horizontal, 18)
            List(selection: $model.selection) {
                ForEach(model.filteredEntries) { entry in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(entry.query).font(.system(size: 13, weight: .medium)).lineLimit(2)
                        HStack(spacing: 4) {
                            Image(systemName: entry.mode.symbol)
                            Text(entry.mode.rawValue)
                            if entry.status == "pending" {
                                Text("· Writing")
                            } else if entry.status != "completed" {
                                Text("· \(entry.status.capitalized)")
                            }
                        }.font(.system(size: 10)).foregroundStyle(.secondary)
                    }.padding(.vertical, 5).tag(entry.id)
                }
            }.listStyle(.sidebar)
            Spacer(minLength: 0)
            Divider()
            Button {
                model.showSettings = true
            } label: {
                HStack {
                    Image(systemName: "person.crop.circle").font(.title3)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(model.signedIn ? "ChatGPT connected" : "Connect ChatGPT").font(
                            .system(size: 12, weight: .medium))
                        Text(model.connecting ? "Connecting…" : "Account & settings").font(.system(size: 10))
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "gearshape").foregroundStyle(.secondary)
                }.padding(6)
            }.buttonStyle(.plain).padding([.horizontal, .bottom], 12)
        }
    }
    private var header: some View {
        HStack {
            Label("Your everyday word companion", systemImage: "text.book.closed")
                .font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary)
            Spacer()
            Label("Saved on this Mac", systemImage: "externaldrive").font(.system(size: 10)).foregroundStyle(
                .secondary)
        }.padding(.horizontal, 24).padding(.top, 25).padding(.bottom, 18)
    }
    private var welcome: some View {
        VStack(alignment: .leading, spacing: 18) {
            Image(systemName: "character.book.closed.fill").font(.system(size: 32)).foregroundStyle(accent)
                .padding(.top, 22)
            Text("Find the right words.").font(.system(size: 30, weight: .semibold, design: .serif))
            Text(
                "A definition, a second pair of eyes, or a quick answer.\nA small space for the things you want to know."
            )
            .font(.system(size: 14)).foregroundStyle(.secondary).lineSpacing(5)
            VStack(spacing: 10) {
                example("Serendipity", detail: "A word worth knowing", mode: .dictionary)
                example(
                    "Its a pleasure to meet you're team.", detail: "Give this sentence a quick check",
                    mode: .spelling)
                example(
                    "When should I use affect vs. effect?", detail: "Clear up a common confusion", mode: .ask)
            }.padding(.top, 12)
            if !model.signedIn {
                Button {
                    model.showSettings = true
                } label: {
                    Label("Continue with ChatGPT", systemImage: "person.crop.circle")
                }
                .buttonStyle(.borderedProminent).controlSize(.large).padding(.top, 6)
                Text("Uses your eligible ChatGPT plan. No API key needed.").font(.caption).foregroundStyle(
                    .secondary)
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private func example(_ text: String, detail: String, mode: QueryMode) -> some View {
        Button {
            model.mode = mode
            model.query = text
            focused = true
        } label: {
            HStack(spacing: 14) {
                Image(systemName: mode.symbol).frame(width: 24).foregroundStyle(accent)
                VStack(alignment: .leading, spacing: 4) {
                    Text(text).font(.system(size: 13, weight: .medium)).foregroundStyle(.primary)
                    Text(detail).font(.system(size: 11)).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "arrow.up.left").font(.caption).foregroundStyle(.tertiary)
            }.padding(14).background(.quaternary.opacity(0.45), in: RoundedRectangle(cornerRadius: 10))
        }.buttonStyle(.plain)
    }
    private func answer(_ entry: HistoryEntry) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Label(entry.mode.rawValue.uppercased(), systemImage: entry.mode.symbol)
                    .font(.system(size: 10, weight: .semibold)).tracking(1.2).foregroundStyle(accent)
                Spacer()
                Text(entry.createdAt, style: .time).font(.caption).foregroundStyle(.secondary)
            }
            Text(entry.query).font(.system(size: 24, weight: .medium, design: .serif)).textSelection(.enabled)
            Divider()
            if entry.response.isEmpty && entry.status == "pending" {
                HStack(spacing: 10) {
                    ProgressView().controlSize(.small)
                    Text("Finding the words…").foregroundStyle(.secondary)
                }.padding(.vertical)
            } else {
                Text(
                    (try? AttributedString(
                        markdown: entry.response,
                        options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
                        ?? AttributedString(entry.response)
                )
                .font(.system(size: 15)).lineSpacing(6).textSelection(.enabled).frame(
                    maxWidth: .infinity, alignment: .leading)
            }
            HStack(spacing: 12) {
                Text(
                    "\(entry.model) · \(entry.effort.isEmpty ? "Default effort" : entry.effort) · \(entry.serviceDescription)"
                )
                if let seconds = entry.durationSeconds { Text(String(format: "%.1f s", seconds)) }
            }.font(.system(size: 10)).foregroundStyle(.tertiary)
            if entry.status != "pending" {
                HStack {
                    Button {
                        model.copy(entry.response)
                    } label: {
                        Label("Copy", systemImage: "doc.on.doc")
                    }.disabled(entry.response.isEmpty)
                    Button {
                        model.export(entry)
                    } label: {
                        Label("Export", systemImage: "square.and.arrow.up")
                    }
                    Button {
                        model.reuse(entry)
                        focused = true
                    } label: {
                        Label("Use again", systemImage: "arrow.counterclockwise")
                    }.disabled(model.busy)
                    Spacer()
                    if entry.status != "completed" {
                        Text(entry.status.capitalized).font(.caption).foregroundStyle(.orange)
                    }
                }.buttonStyle(.borderless).font(.caption)
                if let error = entry.error {
                    Text(error).font(.caption).foregroundStyle(.red).textSelection(.enabled)
                }
            }
        }
    }
    private var composer: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("Mode", selection: $model.mode) {
                ForEach(QueryMode.allCases) { mode in Label(mode.rawValue, systemImage: mode.symbol).tag(mode)
                }
            }.pickerStyle(.segmented).labelsHidden().disabled(model.busy)
            ZStack(alignment: .topLeading) {
                if model.query.isEmpty {
                    Text("A word, a sentence, a question…").foregroundStyle(.tertiary).padding(.horizontal, 5)
                        .padding(.top, 8).allowsHitTesting(false)
                }
                TextEditor(text: $model.query).font(.system(size: 14)).scrollContentBackground(.hidden)
                    .frame(minHeight: 64, maxHeight: 100).focused($focused).disabled(model.busy)
                    .accessibilityLabel("Query")
            }
            Divider()
            HStack(spacing: 8) {
                Picker("Model", selection: $model.selectedModel) {
                    if model.models.isEmpty { Text("Connect to load models").tag("") }
                    ForEach(model.models) { Text($0.displayName).tag($0.model) }
                }.labelsHidden().frame(maxWidth: 200).disabled(model.busy)
                Picker("Effort", selection: $model.effort) {
                    if let option = model.currentModel, !option.supportedReasoningEfforts.isEmpty {
                        ForEach(option.supportedReasoningEfforts, id: \.reasoningEffort) {
                            Text($0.reasoningEffort.capitalized).tag($0.reasoningEffort)
                        }
                    } else {
                        Text("Default").tag("")
                    }
                }.labelsHidden().frame(width: 95).disabled(model.busy)
                Toggle(isOn: $model.fast) { Label("Fast", systemImage: "bolt.fill") }
                    .toggleStyle(.checkbox).disabled(model.currentModel?.fastTier == nil || model.busy)
                    .help(
                        model.currentModel?.fastTier == nil
                            ? "This model does not advertise Fast mode."
                            : "Request Fast mode. Higher plan usage may apply.")
                Spacer(minLength: 2)
                if model.busy {
                    Button {
                        model.stop()
                    } label: {
                        Image(systemName: "stop.fill")
                    }.help("Stop generating").keyboardShortcut(".", modifiers: .command)
                } else {
                    Button {
                        model.send()
                    } label: {
                        Image(systemName: "arrow.up").fontWeight(.semibold).frame(width: 22, height: 22)
                    }
                    .buttonStyle(.borderedProminent).disabled(!model.canSend).keyboardShortcut(
                        .return, modifiers: .command
                    ).help("Send · ⌘ Return")
                }
            }.controlSize(.small).disabled(model.connecting)
            HStack {
                Text(
                    model.fast
                        ? "Using ChatGPT plan · Fast may use more allowance." : "Each lookup starts fresh.")
                Spacer()
                Text("⌘ Return to send")
            }.font(.system(size: 10)).foregroundStyle(.tertiary)
        }.padding(16).background(
            Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 14)
        )
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(.quaternary, lineWidth: 1)).padding(20)
    }
    private func banner(_ message: String, symbol: String, color: Color) -> some View {
        HStack(alignment: .top) {
            Image(systemName: symbol).foregroundStyle(color)
            Text(message).font(.caption).textSelection(.enabled)
            Spacer()
            Button {
                model.error = nil
            } label: {
                Image(systemName: "xmark")
            }.buttonStyle(.plain).accessibilityLabel("Dismiss error")
        }.padding(12).background(color.opacity(0.07)).padding(.horizontal, 20)
    }
}

struct SettingsView: View {
    @ObservedObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack {
                Text("Make yourself at home.").font(.system(size: 23, weight: .semibold, design: .serif))
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            GroupBox {
                VStack(alignment: .leading, spacing: 12) {
                    Label("ChatGPT account", systemImage: "person.crop.circle").font(.headline)
                    if !model.profiles.isEmpty {
                        Picker(
                            "Account",
                            selection: Binding(
                                get: { model.accountID },
                                set: { value in Task { await model.selectAccount(value) } })
                        ) {
                            ForEach(model.profiles) { Text($0.label).tag($0.id) }
                        }.disabled(model.busy || model.connecting || model.signingIn)
                    }
                    Text(
                        model.signedIn
                            ? (model.planEnabled
                                ? "Using ChatGPT plan" : "Signed in · Plan usage not enabled")
                            : "Not signed in"
                    ).font(.callout)
                    Text(
                        "Connect your eligible ChatGPT account and allow EZ to use your plan. Credentials stay in macOS Keychain. Model availability and limits depend on your account."
                    ).font(.caption).foregroundStyle(.secondary)
                    HStack {
                        if model.signingIn {
                            ProgressView().controlSize(.small)
                            Text("Finish signing in in your browser.").font(.caption)
                            Button("Cancel") { model.cancelLogin() }
                        } else if model.signedIn {
                            Button("Sign out of EZ") { Task { await model.signOut() } }
                            if !model.planEnabled {
                                Button("Enable plan usage") { model.signIn(enablePlan: true) }
                            }
                            Button("Add account") { model.signIn(newAccount: true) }
                        } else {
                            Button("Continue with ChatGPT") { model.signIn() }.buttonStyle(.borderedProminent)
                            if !model.profiles.isEmpty {
                                Button("Add account") { model.signIn(newAccount: true) }
                            }
                        }
                    }.disabled(model.busy || model.connecting)
                    HStack {
                        Link("Manage usage", destination: URL(string: "https://chatgpt.com/settings/usage")!)
                        Spacer()
                        Button(model.connecting ? "Loading…" : "Refresh models") {
                            Task { await model.connect() }
                        }.disabled(model.busy || model.connecting || model.signingIn || !model.planEnabled)
                    }.font(.caption)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(8)
            }
            GroupBox {
                VStack(alignment: .leading, spacing: 10) {
                    Label("Local history", systemImage: "externaldrive").font(.headline)
                    Text(
                        "Queries and answers are saved as plain-text JSONL on this Mac. Your query is sent to OpenAI to generate an answer; previous lookups are not included."
                    ).font(.caption).foregroundStyle(.secondary)
                    Text(model.directory.appendingPathComponent("history.jsonl").path).font(
                        .system(size: 10, design: .monospaced)
                    ).textSelection(.enabled)
                    Button("Show in Finder") { model.revealHistory() }
                }.frame(maxWidth: .infinity, alignment: .leading).padding(8)
            }
            if let error = model.error {
                Text(error).font(.caption).foregroundStyle(.red).textSelection(.enabled)
            }
            HStack {
                Text("EZ 0.1.0")
                Spacer()
                Link(
                    "Sign-in documentation",
                    destination: URL(string: "https://developers.openai.com/siwc/token-sharing-open-source")!)
            }.font(.caption).foregroundStyle(.secondary)
        }.padding(26).frame(width: 580).tint(accent)
    }
}
