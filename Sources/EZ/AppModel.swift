import AppKit
import Combine
import EZCore

@MainActor final class AppModel: ObservableObject {
    enum SettingsSection { case configuration, account, shortcuts }
    @Published var settingsSection: SettingsSection = .configuration
    @Published private(set) var configuration = Configuration()
    @Published var selectedRecipeID: UUID?
    @Published var overridePresetID: UUID?
    @Published var inputValues: [String: String] = [:]
    @Published private(set) var draftRevision = 0
    @Published private(set) var replayEntry: HistoryEntry?
    @Published var configurationError: String?
    @Published var models: [ModelOption] = []
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
    @Published var launcherPending = false
    @Published var error: String?
    @Published var storageWarning: String?
    @Published var showSettings = false
    @Published private(set) var shortcuts = LookupShortcuts()
    @Published var shortcutSettingsError: String?
    private var shortcutsLoaded = false
    let directory: URL
    let offline: Bool
    private let auth = ChatGPTAuth()
    private let responses = ResponsesClient()
    private var history: HistoryStore?
    private var lock: SessionLock?
    private var active: HistoryEntry?
    private var requestTask: Task<Void, Never>?
    private var loginTask: Task<Void, Never>?
    private var loaded = false
    private var configurationStore: ConfigurationStore?
    private var configurationLoaded = false

    init(historyDirectory: URL? = nil, offline: Bool = false) {
        self.offline = offline
        directory =
            historyDirectory
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
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
            let configStore = ConfigurationStore(directory: directory)
            configurationStore = configStore
            do {
                if let saved = try configStore.load() {
                    configuration = saved
                } else {
                    let oldModel = UserDefaults.standard.string(forKey: "model") ?? ""
                    configuration = .starters(
                        model: oldModel,
                        effort: UserDefaults.standard.string(forKey: "effort") ?? "low",
                        fast: UserDefaults.standard.bool(forKey: "fast"))
                    try configStore.save(configuration)
                }
                configurationLoaded = true
                selectedRecipeID = configuration.recipes.first?.id
            } catch {
                configurationError =
                    "Configuration could not be loaded. Original file is preserved. \(error.localizedDescription)"
            }
            do {
                shortcuts = try LookupShortcutsStore(directory: directory).load()
                shortcutsLoaded = true
            } catch {
                shortcutSettingsError =
                    "Shortcuts could not be loaded. Using defaults; original file is preserved. \(error.localizedDescription)"
            }
        } catch { storageWarning = error.localizedDescription }
    }

    func saveShortcut(_ binding: LookupKeyBinding, for command: LookupCommand) throws {
        var updated = shortcuts
        updated.overrides[command.rawValue] = binding
        try saveShortcuts(updated)
    }

    func saveShortcuts(_ updated: LookupShortcuts) throws {
        guard shortcutsLoaded, lock != nil else {
            throw EZError(
                "Shortcut storage is unavailable. Restore defaults to replace an unreadable shortcuts file.")
        }
        try LookupShortcutsStore(directory: directory).save(updated)
        shortcuts = updated
        shortcutSettingsError = nil
    }

    func restoreShortcuts() throws {
        guard lock != nil else { throw EZError("Shortcut storage is unavailable.") }
        let defaults = LookupShortcuts()
        try LookupShortcutsStore(directory: directory).save(defaults)
        shortcuts = defaults
        shortcutsLoaded = true
        shortcutSettingsError = nil
    }

    func commandEnabled(_ command: LookupCommand) -> Bool {
        switch command {
        case .send: return canSend
        case .stop: return busy
        case .newLookup: return !busy && !launcherPending
        case .nextRecipe, .previousRecipe, .lastRecipe:
            return !busy && !launcherPending && !configuration.recipes.isEmpty
        default:
            return !busy && !launcherPending && command.recipeIndex! < configuration.recipes.count
        }
    }

    func performLookupCommand(_ command: LookupCommand) {
        guard commandEnabled(command) else { return }
        switch command {
        case .newLookup: newQuery()
        case .send: send()
        case .stop: stop()
        case .nextRecipe: cycleRecipe(by: 1)
        case .previousRecipe: cycleRecipe(by: -1)
        case .lastRecipe: selectRecipe(at: configuration.recipes.count - 1)
        default: selectRecipe(at: command.recipeIndex!)
        }
    }

    func cycleRecipe(by offset: Int) {
        let recipes = configuration.recipes
        guard !recipes.isEmpty else { return }
        let index = replayEntry == nil ? recipes.firstIndex { $0.id == selectedRecipeID } : nil
        let next =
            index.map { ($0 + offset + recipes.count) % recipes.count }
            ?? (offset > 0 ? 0 : recipes.count - 1)
        selectRecipe(at: next)
    }

    private func selectRecipe(at index: Int) {
        guard configuration.recipes.indices.contains(index) else { return }
        let id = configuration.recipes[index].id
        guard replayEntry != nil || selectedRecipeID != id else { return }
        chooseRecipe(id)
    }
    var currentRecipe: Recipe? {
        replayEntry?.recipeSnapshot ?? configuration.recipes.first { $0.id == selectedRecipeID }
    }
    func openSettings(_ section: SettingsSection = .configuration) {
        settingsSection = section
        showSettings = true
    }
    var currentPreset: ModelPreset? {
        if let overridePresetID {
            return configuration.presets.first { $0.id == overridePresetID }
        }
        if let saved = replayEntry?.presetSnapshot { return saved }
        let id = currentRecipe?.presetID
        return configuration.presets.first { $0.id == id }
    }
    var inputFields: [String] { currentRecipe.flatMap { try? PromptTemplate($0.template).fields } ?? [] }
    var query: String {
        get { inputFields.first.flatMap { inputValues[$0] } ?? "" }
        set { if let field = inputFields.first { inputValues[field] = newValue } }
    }
    var selectedModel: String { currentPreset?.model ?? "" }
    var effort: String { currentPreset?.effort ?? "" }
    var fast: Bool { currentPreset?.fast ?? false }
    var configurationLocked: Bool {
        busy || launcherPending || connecting || signingIn || !configurationLoaded
    }
    var requestIssue: String? {
        if !configurationLoaded { return configurationError ?? "Configuration is unavailable." }
        guard let recipe = currentRecipe else { return "Add a recipe in Configuration to start a lookup." }
        guard let preset = currentPreset else { return "Choose a model preset in Configuration." }
        if let issue = preset.availabilityError(in: models) { return issue }
        do { _ = try PromptTemplate(recipe.template).render(inputValues) } catch {
            return error.localizedDescription
        }
        return nil
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
        !offline && signedIn && planEnabled && !busy && !launcherPending && !connecting && !signingIn
            && requestIssue == nil && history != nil && lock != nil
    }
    func connect() async {
        guard !offline, !connecting, !busy, !signingIn, lock != nil else { return }
        connecting = true
        error = nil
        defer { connecting = false }
        do {
            if !loaded {
                try await auth.load()
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
        initializeStarterPreset()
    }
    func initializeStarterPreset() {
        // Only initialize the unassigned starter. Saved choices never silently normalize.
        guard let starterID = configuration.unassignedStarterID,
            let index = configuration.presets.firstIndex(where: { $0.id == starterID && $0.model.isEmpty }),
            let option = models.first(where: { $0.isDefault }) ?? models.first
        else { return }
        var updated = configuration
        updated.presets[index].model = option.model
        updated.presets[index].effort = option.supportedReasoningEfforts.isEmpty ? "" : option.quickEffort
        updated.presets[index].fast = false
        updated.unassignedStarterID = nil
        do {
            try configurationStore?.save(updated)
            configuration = updated
        } catch { configurationError = "Starter preset could not be saved. \(error.localizedDescription)" }
    }
    func chooseRecipe(_ id: UUID?) {
        guard !busy, !launcherPending else { return }
        selectedRecipeID = id
        replayEntry = nil
        overridePresetID = nil
        inputValues = [:]
        selection = nil
        error = nil
        draftRevision += 1
    }
    func choosePreset(_ id: UUID?) {
        guard !busy, !launcherPending, !connecting, !signingIn else { return }
        overridePresetID = id
    }
    func saveConfiguration(_ updated: Configuration) throws {
        guard !configurationLocked, let store = configurationStore else {
            throw EZError(
                "Configuration cannot be changed while a request is active or storage is unavailable.")
        }
        var saved = updated
        if let id = saved.unassignedStarterID,
            !saved.presets.contains(where: { $0.id == id && $0.model.isEmpty })
        {
            saved.unassignedStarterID = nil
        }
        try store.save(saved)
        configuration = saved
        configurationError = nil
        if replayEntry == nil && !saved.recipes.contains(where: { $0.id == selectedRecipeID }) {
            chooseRecipe(saved.recipes.first?.id)
        } else {
            inputValues = inputValues.filter { inputFields.contains($0.key) }
        }
    }
    func prepareLauncher(_ text: String) throws -> Bool {
        guard !busy, !launcherPending, !signingIn else {
            throw EZError("EZ is already preparing or generating a lookup.")
        }
        newQuery()
        guard let recipe = currentRecipe else {
            throw EZError("Add a recipe in Configuration before using Raycast.")
        }
        let prepared = try configuration.preparingLauncherInput(text, recipeID: recipe.id)
        inputValues = prepared.values
        return prepared.submit
    }
    func signIn(newAccount: Bool = false, enablePlan: Bool = false) {
        guard !offline, !busy, !launcherPending, !connecting, !signingIn, lock != nil else { return }
        signingIn = true
        error = nil
        loginTask = Task {
            defer {
                signingIn = false
                loginTask = nil
            }
            do {
                if !loaded {
                    try await auth.load()
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
        guard !offline, !busy, !launcherPending, !connecting, !signingIn, !id.isEmpty else { return }
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
        guard !offline, !busy, !launcherPending, !connecting, !signingIn else { return }
        connecting = true
        defer { connecting = false }
        do {
            error = try await auth.signOut()
            syncAccount()
            models = []
        } catch { self.error = error.localizedDescription }
    }
    func send() {
        guard canSend, let recipe = currentRecipe, let preset = currentPreset, let history else { return }
        error = nil
        let entry: HistoryEntry
        do { entry = try recipe.prepare(values: inputValues, preset: preset, models: models) } catch {
            self.error = error.localizedDescription
            return
        }
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
        guard !busy, !launcherPending else { return }
        selection = nil
        inputValues = [:]
        overridePresetID = nil
        replayEntry = nil
        if !configuration.recipes.contains(where: { $0.id == selectedRecipeID }) {
            selectedRecipeID = configuration.recipes.first?.id
        }
        error = nil
        draftRevision += 1
    }
    func reuse(_ entry: HistoryEntry) {
        guard !busy, !launcherPending else { return }
        var saved = entry
        if saved.recipeSnapshot == nil {
            let preset = ModelPreset(
                name: "Saved", model: entry.model, effort: entry.effort,
                fast: entry.requestedServiceTier != nil)
            saved.recipeSnapshot = Recipe(
                name: entry.mode.rawValue, presetID: preset.id,
                template: entry.mode.instruction + "\n\n{{text}}", legacyMode: entry.mode)
            saved.presetSnapshot = preset
            saved.inputValues = ["text": entry.query]
        }
        replayEntry = saved
        inputValues = saved.inputValues ?? [:]
        overridePresetID = nil
        selection = nil
        draftRevision += 1
    }
    func shutdown() {
        cancelLogin()
        stop()
    }
    var canDeleteLookup: Bool { !busy && !launcherPending && history != nil && lock != nil }
    func deleteLookup(_ id: UUID) {
        guard canDeleteLookup, entries.contains(where: { $0.id == id }), let history else { return }
        do {
            try history.delete(id: id)
            entries.removeAll { $0.id == id }
            if selection == id { selection = nil }
        } catch {
            self.error = "Lookup could not be deleted. \(error.localizedDescription)"
        }
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
