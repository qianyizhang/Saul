import AppKit
import Combine
import EZCore

@MainActor final class AppModel: ObservableObject {
    @Published var query = ""
    @Published var mode: QueryMode = .dictionary
    @Published var models: [ModelOption] = []
    @Published var selectedModel = UserDefaults.standard.string(forKey: "model") ?? "" {
        didSet { UserDefaults.standard.set(selectedModel, forKey: "model") }
    }
    @Published var effort = UserDefaults.standard.string(forKey: "effort") ?? "low" {
        didSet { UserDefaults.standard.set(effort, forKey: "effort") }
    }
    @Published var fast = UserDefaults.standard.bool(forKey: "fast") {
        didSet { UserDefaults.standard.set(fast, forKey: "fast") }
    }
    @Published var entries: [HistoryEntry] = []
    @Published var selection: UUID?
    @Published var search = ""
    @Published var connecting = false
    @Published var signedIn = false
    @Published var planEnabled = false
    @Published var profiles: [AccountProfile] = []
    @Published var accountID = ""
    @Published var signingIn = false
    @Published var busy = false
    @Published var error: String?
    @Published var storageWarning: String?
    @Published var showSettings = false
    let directory: URL
    private let auth = ChatGPTAuth()
    private let responses = ResponsesClient()
    private var history: HistoryStore?
    private var lock: SessionLock?
    private var active: HistoryEntry?
    private var requestTask: Task<Void, Never>?
    private var loginTask: Task<Void, Never>?
    private var loaded = false

    init() {
        directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("EZ", isDirectory: true)
        do {
            lock = try SessionLock(directory: directory)
            let store = try HistoryStore(directory: directory)
            history = store
            let loaded = try store.load()
            entries = loaded.entries
            if loaded.damagedLines > 0 {
                storageWarning =
                    "Skipped \(loaded.damagedLines) damaged history lines. Original bytes are preserved."
            }
        } catch { storageWarning = error.localizedDescription }
    }
    var currentModel: ModelOption? { models.first { $0.model == selectedModel } }
    var selectedEntry: HistoryEntry? { entries.first { $0.id == selection } }
    var filteredEntries: [HistoryEntry] {
        search.isEmpty
            ? entries
            : entries.filter {
                $0.query.localizedCaseInsensitiveContains(search)
                    || $0.response.localizedCaseInsensitiveContains(search)
            }
    }
    var canSend: Bool {
        signedIn && planEnabled && !busy && !connecting && !signingIn && currentModel != nil
            && !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && history != nil && lock != nil
    }
    func connect() async {
        guard !connecting, !busy, !signingIn, lock != nil else { return }
        connecting = true
        error = nil
        defer { connecting = false }
        do {
            if !loaded {
                try auth.load()
                loaded = true
            }
            syncAccount()
            try await loadModels()
        } catch {
            syncAccount()
            self.error = error.localizedDescription
        }
    }
    private func syncAccount() {
        profiles = auth.state.profiles
        accountID = auth.state.selectedID ?? ""
        signedIn = auth.selected?.credentials != nil
        planEnabled = auth.selected?.credentials?.canUsePlan == true
    }
    private func loadModels() async throws {
        models = []
        guard auth.selected?.credentials?.canUsePlan == true else { return }
        let token = try await auth.accessToken()
        models = try await responses.models(token: token)
        guard !models.isEmpty else { throw EZError("No models are available for this ChatGPT account.") }
        normalizeSelection()
    }
    func normalizeSelection() {
        if currentModel == nil {
            selectedModel = models.first(where: { $0.isDefault })?.model ?? models.first?.model ?? ""
        }
        guard let model = currentModel else { return }
        if model.supportedReasoningEfforts.isEmpty {
            effort = ""
        } else if !model.supportedReasoningEfforts.contains(where: { $0.reasoningEffort == effort }) {
            effort = model.quickEffort
        }
        if model.fastTier == nil { fast = false }
    }
    func signIn(newAccount: Bool = false, enablePlan: Bool = false) {
        guard !busy, !connecting, !signingIn, lock != nil else { return }
        signingIn = true
        error = nil
        loginTask = Task {
            defer {
                signingIn = false
                loginTask = nil
            }
            do {
                if !loaded {
                    try auth.load()
                    loaded = true
                }
                try await auth.signIn(newAccount: newAccount, enablePlan: enablePlan) {
                    NSWorkspace.shared.open($0)
                }
                syncAccount()
                try await loadModels()
            } catch is CancellationError { syncAccount() } catch {
                syncAccount()
                self.error = error.localizedDescription
            }
        }
    }
    func cancelLogin() {
        loginTask?.cancel()
        auth.cancelSignIn()
    }
    func selectAccount(_ id: String) async {
        guard !busy, !connecting, !signingIn, !id.isEmpty else { return }
        connecting = true
        error = nil
        defer { connecting = false }
        do {
            try auth.select(id)
            syncAccount()
            try await loadModels()
        } catch {
            syncAccount()
            self.error = error.localizedDescription
        }
    }
    func signOut() async {
        guard !busy, !connecting, !signingIn else { return }
        connecting = true
        defer { connecting = false }
        do {
            error = try await auth.signOut()
            syncAccount()
            models = []
        } catch { self.error = error.localizedDescription }
    }
    func send() {
        guard canSend, let model = currentModel, let history else { return }
        error = nil
        let entry = HistoryEntry(
            mode: mode, query: query.trimmingCharacters(in: .whitespacesAndNewlines), model: selectedModel,
            effort: effort, requestedServiceTier: fast ? model.fastTier : nil)
        do { try history.append(entry) } catch {
            self.error = "Query not sent: history could not be saved. \(error.localizedDescription)"
            return
        }
        active = entry
        entries.insert(entry, at: 0)
        selection = entry.id
        busy = true
        requestTask = Task {
            do {
                let token = try await auth.accessToken()
                try Task.checkCancellation()
                let result = try await responses.stream(entry: entry, token: token) { text in
                    guard self.active?.id == entry.id else { return }
                    self.active?.response = text
                    if let active = self.active,
                        let index = self.entries.firstIndex(where: { $0.id == active.id })
                    {
                        self.entries[index] = active
                    }
                }
                if active?.id == entry.id {
                    active?.actualServiceTier = result.actualServiceTier
                    finish(status: "completed")
                }
            } catch is CancellationError { if active?.id == entry.id { finish(status: "interrupted") } } catch
            {
                if active?.id == entry.id {
                    let cancelled = (error as? URLError)?.code == .cancelled
                    finish(
                        status: cancelled ? "interrupted" : "failed",
                        error: cancelled ? nil : error.localizedDescription)
                }
            }
            syncAccount()
        }
    }
    func stop() {
        requestTask?.cancel()
        finish(status: "interrupted")
    }
    func newQuery() {
        guard !busy else { return }
        selection = nil
        query = ""
        error = nil
    }
    func reuse(_ entry: HistoryEntry) {
        guard !busy else { return }
        query = entry.query
        mode = entry.mode
        selection = nil
    }
    func shutdown() {
        cancelLogin()
        stop()
    }
    func revealHistory() { NSWorkspace.shared.activateFileViewerSelecting([history?.url ?? directory]) }
    func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
    func export(_ entry: HistoryEntry) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "EZ-\(entry.id.uuidString.prefix(8)).md"
        if panel.runModal() == .OK, let url = panel.url {
            do { try entry.markdown.write(to: url, atomically: true, encoding: .utf8) } catch {
                self.error = error.localizedDescription
            }
        }
    }
    private func finish(status: String, error message: String? = nil) {
        guard var entry = active else { return }
        entry.status = status
        entry.error = message
        entry.durationSeconds = Date().timeIntervalSince(entry.createdAt)
        if let index = entries.firstIndex(where: { $0.id == entry.id }) { entries[index] = entry }
        do { try history?.append(entry) } catch {
            storageWarning =
                "Answer is visible but could not be saved: \(error.localizedDescription). Copy or export it before closing."
        }
        if let message { error = message }
        active = nil
        busy = false
        requestTask = nil
    }
}
