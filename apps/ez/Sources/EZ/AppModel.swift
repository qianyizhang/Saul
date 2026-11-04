import AppKit
import Combine
import EZCore

@MainActor final class AppModel: ObservableObject {
    enum SettingsSection: String, CaseIterable {
        case overview, configuration, actions, preferences, account, shortcuts
        var title: String {
            switch self {
            case .overview: "Overview"
            case .configuration: "Presets"
            case .actions: "Actions"
            case .preferences: "Preferences"
            case .account: "Providers"
            case .shortcuts: "Shortcuts"
            }
        }
    }
    @Published var settingsSection: SettingsSection = .overview
    @Published private(set) var configuration = Configuration()
    @Published var selectedActionID: UUID?
    @Published var overridePresetID: UUID?
    @Published var inputValues: [String: String] = [:]
    var imageImportID = UUID()
    @Published var inputImage: ImageAttachment? { didSet { imageImportID = UUID() } }
    @Published var inputImageError: String?
    @Published private(set) var draftRevision = 0
    @Published private(set) var replayEntry: HistoryEntry?
    @Published var configurationError: String?
    @Published var models: [ModelOption] = []
    @Published var entries: [HistoryEntry] = []
    @Published var selection: UUID? { didSet { loadSelectedImage() } }
    @Published var selectedImageData: Data?
    @Published var imageLoading = false
    var imageLoadTask: Task<Void, Never>?
    @Published var followUpDrafts: [UUID: String] = [:]
    @Published var followUpTargetID: UUID?
    @Published var search = ""
    @Published var connecting = false
    @Published var signedIn = false
    @Published var planEnabled = false
    @Published var profiles: [AccountProfile] = []
    @Published var accountID = ""
    @Published var signingIn = false
    @Published var busy = false
    @Published var responseActivity: ResponseActivity = .waiting
    @Published var launcherPending = false
    @Published var error: String?
    @Published var storageWarning: String?
    @Published var apiKeyDraft = ""
    @Published var apiConnected = false
    @Published var apiKeyBusy = false
    @Published var apiKeyError: String?
    let apiKeyStore: any OpenAIKeyStorage
    @Published var showSettings = false
    @Published var minimumMode = true {
        didSet {
            if !offline { UserDefaults.standard.set(minimumMode, forKey: "minimumMode") }
        }
    }
    @Published private(set) var shortcuts = LookupShortcuts()
    @Published var shortcutSettingsError: String?
    private var shortcutsLoaded = false
    let directory: URL
    let offline: Bool
    private let auth = ChatGPTAuth()
    private let responses = ResponsesClient()
    private var history: HistoryStore?
    private var lock: SessionLock?
    private var attemptExecution: AttemptExecution?
    private var loginTask: Task<Void, Never>?
    private var loaded = false
    private var configurationStore: ConfigurationStore?
    private var configurationLoaded = false

    init(
        historyDirectory: URL? = nil, offline: Bool = false,
        attemptExecution: AttemptExecution? = nil, apiKeyStore: (any OpenAIKeyStorage)? = nil
    ) {
        self.offline = offline
        self.apiKeyStore = apiKeyStore ?? (offline ? TemporaryAPIKeyStore() : OpenAIKeyStore())
        self.attemptExecution = attemptExecution
        minimumMode = offline ? true : UserDefaults.standard.object(forKey: "minimumMode") as? Bool ?? true
        directory =
            historyDirectory
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("EZ", isDirectory: true)
        do {
            lock = try SessionLock(directory: directory)
            let store = try HistoryStore(directory: directory)
            history = store
            if !offline, attemptExecution == nil {
                let auth = self.auth
                let responses = self.responses
                let provider = GenerationProvider.chatGPTPlan(
                    accessToken: { [weak self] in
                        defer { self?.syncAccount() }
                        return try await auth.accessToken()
                    }, responses: responses)
                let api = GenerationProvider.openAIAPI(keyStore: self.apiKeyStore)
                self.attemptExecution = AttemptExecution(
                    generate: { entry, update in
                        guard let preset = entry.presetSnapshot, let connection = entry.providerSnapshot
                        else { throw EZError("The action's provider snapshot is missing.") }
                        let selected = connection.kind == .chatGPTPlan ? provider : api
                        guard preset.capability != .speak else {
                            throw EZError("Speak previews run in Saul.")
                        }
                        if preset.capability == .draw {
                            let options = preset.imageOptions ?? ImageOptions()
                            let output = try await selected.generateImage(
                                ImageGenerationRequest(
                                    prompt: entry.query,
                                    model: preset.model, size: options.size, quality: options.quality,
                                    image: entry.inputImage))
                            return .image(output)
                        }
                        return .text(try await selected.streamText(entry: entry, onUpdate: update))
                    },
                    append: { try store.append($0) })
            }
            let loaded = try store.load()
            entries = loaded.entries
            if loaded.damagedLines > 0 {
                storageWarning =
                    "Skipped \(loaded.damagedLines) damaged history lines. Original bytes are preserved."
            }
            let configStore = ConfigurationStore(
                directory: directory, shared: offline ? nil : SharedPresetsStore())
            configurationStore = configStore
            do {
                if let saved = try configStore.load() {
                    configuration = saved
                } else {
                    let oldModel = offline ? "" : UserDefaults.standard.string(forKey: "model") ?? ""
                    configuration = .starters(
                        model: oldModel,
                        effort: offline ? "low" : UserDefaults.standard.string(forKey: "effort") ?? "low",
                        fast: !offline && UserDefaults.standard.bool(forKey: "fast"))
                    try configStore.save(configuration)
                    configuration = try configStore.load() ?? configuration
                }
                configurationLoaded = true
                if !offline, (configuration.actionTypesVersion ?? 0) < 2 {
                    var upgraded = configuration
                    upgraded.addSearchAndMeme()
                    try configStore.save(upgraded)
                    configuration = try configStore.load() ?? upgraded
                }
                selectedActionID = configuration.actions.first?.id
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
        self.attemptExecution?.onChange = { [weak self] update in
            self?.receiveAttempt(update)
        }
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
        case .send:
            if let id = followUpTargetID {
                let draft = followUpDrafts[id] ?? ""
                return canFollowUp && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    && draft.utf16.count <= 2_000
            }
            return canSend
        case .stop: return busy
        case .newLookup: return !busy && !launcherPending
        case .nextRecipe, .previousRecipe, .lastRecipe:
            return !busy && !launcherPending && !configuration.actions.isEmpty
        default:
            return !busy && !launcherPending && command.recipeIndex! < configuration.actions.count
        }
    }

    func performLookupCommand(_ command: LookupCommand) {
        guard commandEnabled(command) else { return }
        switch command {
        case .newLookup: newQuery()
        case .send:
            if let id = followUpTargetID { followUp(id) } else { send() }
        case .stop: stop()
        case .nextRecipe: cycleRecipe(by: 1)
        case .previousRecipe: cycleRecipe(by: -1)
        case .lastRecipe: selectRecipe(at: configuration.actions.count - 1)
        default: selectRecipe(at: command.recipeIndex!)
        }
    }

    func cycleRecipe(by offset: Int) {
        let actions = configuration.actions
        guard !actions.isEmpty else { return }
        let index = replayEntry == nil ? actions.firstIndex { $0.id == selectedActionID } : nil
        let next =
            index.map { ($0 + offset + actions.count) % actions.count }
            ?? (offset > 0 ? 0 : actions.count - 1)
        selectRecipe(at: next)
    }

    private func selectRecipe(at index: Int) {
        guard configuration.actions.indices.contains(index) else { return }
        let id = configuration.actions[index].id
        guard replayEntry != nil || selectedActionID != id else { return }
        chooseAction(id)
    }
    var currentAction: Action? {
        replayEntry?.actionSnapshot ?? configuration.actions.first { $0.id == selectedActionID }
    }
    func openSettings(_ section: SettingsSection = .overview) {
        if !showSettings { refreshConfiguration() }
        settingsSection = section
        showSettings = true
    }
    var currentPreset: ModelPreset? {
        if let overridePresetID {
            return configuration.presets.first { $0.id == overridePresetID }
        }
        if let saved = replayEntry?.presetSnapshot { return saved }
        let id = currentAction?.presetID
        return configuration.presets.first { $0.id == id }
    }
    var inputFields: [String] { currentAction.flatMap { try? PromptTemplate($0.template).fields } ?? [] }
    var query: String {
        get { inputFields.first.flatMap { inputValues[$0] } ?? "" }
        set { if let field = inputFields.first { inputValues[field] = newValue } }
    }
    var selectedModel: String { currentPreset?.model ?? "" }
    var effort: String { currentPreset?.effort ?? "" }
    var fast: Bool { currentPreset?.fast ?? false }
    var configurationLocked: Bool {
        busy || launcherPending || signingIn || !configurationLoaded
    }
    var requestIssue: String? {
        if !configurationLoaded { return configurationError ?? "Configuration is unavailable." }
        guard let action = currentAction else { return "Add an action in Settings → Actions to start a run." }
        guard let preset = currentPreset else { return "Choose a preset in Settings → Presets." }
        guard action.capability == preset.capability else {
            return "Choose a \(action.capability.name) preset for this action."
        }
        if let issue = preset.availabilityError(in: models) { return issue }
        if action.webSearch && currentProvider?.kind != .openAIAPI {
            return "Web search needs an OpenAI API Write preset."
        }
        if action.imageInput != nil && inputImage == nil { return "Attach an image before running." }
        do {
            try action.validateInputs()
            _ = try PromptTemplate(action.template).render(inputValues)
        } catch {
            return error.localizedDescription
        }
        return nil
    }
    var currentModel: ModelOption? { models.first { $0.model == selectedModel } }
    var selectedEntry: HistoryEntry? { entries.first { $0.id == selection } }
    var selectedResponseActivity: ResponseActivity? {
        guard busy, let entry = selectedEntry, entry.status == "pending" else { return nil }
        if let activeID = attemptExecution?.activeID, activeID != entry.id { return nil }
        return responseActivity
    }
    var filteredEntries: [HistoryEntry] {
        search.isEmpty
            ? entries
            : entries.filter {
                $0.query.localizedCaseInsensitiveContains(search)
                    || $0.response.localizedCaseInsensitiveContains(search)
            }
    }
    var canSend: Bool {
        attemptExecution != nil && providerIssue == nil && !apiKeyBusy && !busy && !launcherPending
            && !(needsPlan && connecting)
            && !signingIn
            && requestIssue == nil && history != nil && lock != nil
    }
    func connect() async {
        guard !offline, !connecting, !busy, !signingIn, lock != nil else { return }
        connecting = true
        error = nil
        defer { connecting = false }
        await restoreAPIKey()
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
            configuration = try configurationStore?.load() ?? updated
        } catch { configurationError = "Starter preset could not be saved. \(error.localizedDescription)" }
    }
    func chooseAction(_ id: UUID?) {
        guard !busy, !launcherPending else { return }
        if !showSettings { refreshConfiguration() }
        selectedActionID = id
        replayEntry = nil
        overridePresetID = nil
        inputValues = [:]
        inputImage = nil
        inputImageError = nil
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
        configuration = try store.load() ?? saved
        configurationError = nil
        if replayEntry == nil && !saved.actions.contains(where: { $0.id == selectedActionID }) {
            chooseAction(saved.actions.first?.id)
        } else {
            inputValues = inputValues.filter { inputFields.contains($0.key) }
            if currentAction?.imageInput == nil {
                inputImage = nil
                inputImageError = nil
            }
        }
    }
    func refreshConfiguration() {
        guard !busy, !launcherPending, let store = configurationStore else { return }
        do {
            if let saved = try store.load() { configuration = saved }
            configurationLoaded = true
            configurationError = nil
        } catch {
            configurationLoaded = false
            configurationError = "Shared presets could not be loaded. \(error.localizedDescription)"
        }
    }
    func fillQuickLookupSelection(_ text: String?) {
        guard !busy, !launcherPending, !signingIn, !showSettings,
            selection == nil, inputImage == nil, inputValues.values.allSatisfy({ $0.isEmpty }),
            let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            text.utf8.count <= 16_384, let field = inputFields.first
        else { return }
        inputValues = [field: text]
    }

    func prepareSelectedText(_ text: String) throws {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            text.utf8.count <= 16_384
        else {
            throw EZError("Select 1–16,384 UTF-8 bytes of text for EZ.")
        }
        guard !busy, !launcherPending, !signingIn else {
            throw EZError(
                "EZ is already preparing a lookup, generating an answer, or signing in. Try again when it finishes."
            )
        }
        guard !showSettings else {
            throw EZError("Close EZ Settings before looking up selected text.")
        }
        guard inputImage == nil, inputValues.values.allSatisfy({ $0.isEmpty }) else {
            throw EZError(
                "EZ has a draft. Finish it, then choose New lookup before looking up selected text.")
        }
        guard configurationLoaded else {
            throw EZError(configurationError ?? storageWarning ?? "Configuration is unavailable.")
        }
        // Validate everything before clearing a selection or changing the workspace.
        let action = configuration.actions.first { $0.id == selectedActionID } ?? configuration.actions.first
        guard let action else {
            throw EZError("Add an action in Settings → Actions before looking up selected text.")
        }
        let prepared = try configuration.preparingLauncherInput(text, recipeID: action.id)
        newQuery()
        inputValues = prepared.values
        // Services prepares only a draft, even for single-field actions and after sign-in.
    }

    func prepareLauncher(_ text: String) throws -> Bool {
        guard !busy, !launcherPending, !signingIn else {
            throw EZError("EZ is already preparing or generating a lookup.")
        }
        newQuery()
        guard let action = currentAction else {
            throw EZError("Add an action in Settings → Actions before using Raycast.")
        }
        let prepared = try configuration.preparingLauncherInput(text, recipeID: action.id)
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
        refreshConfiguration()
        guard canSend, let action = currentAction, let preset = currentPreset, let attemptExecution else {
            return
        }
        error = nil
        var entry: HistoryEntry
        do {
            entry = try action.prepare(values: inputValues, preset: preset, models: models, image: inputImage)
        } catch {
            self.error = error.localizedDescription
            return
        }
        entry.providerSnapshot = currentProvider
        do { try attemptExecution.start(entry) } catch {
            self.error = error.localizedDescription
            return
        }
        selection = entry.id
    }
    func stop() {
        attemptExecution?.stop()
    }
    var canFollowUp: Bool {
        let key = selectedEntry?.presetSnapshot?.providerKey ?? "gpt-plan"
        let provider = configuration.providers.first { $0.key == key }
        return provider != nil && selectedEntry?.capability != .draw
            && (provider?.kind == .chatGPTPlan ? signedIn && planEnabled : apiConnected)
            && attemptExecution != nil && !busy && !launcherPending && !connecting
            && !signingIn && history != nil && lock != nil
    }
    func followUp(_ id: UUID) {
        guard canFollowUp, let parent = entries.first(where: { $0.id == id }), let attemptExecution else {
            return
        }
        do {
            var entry = try parent.prepareFollowUp(followUpDrafts[id] ?? "", models: models)
            let key = entry.presetSnapshot?.providerKey ?? "gpt-plan"
            entry.providerSnapshot = configuration.providers.first { $0.key == key }
            guard let provider = entry.providerSnapshot,
                provider.kind == .chatGPTPlan ? signedIn && planEnabled : apiConnected
            else { throw EZError("Connect the saved action's provider before sending a follow-up.") }
            try attemptExecution.start(entry)
            followUpDrafts[id] = nil
            if followUpTargetID == id { followUpTargetID = nil }
            selection = entry.id
            error = nil
        } catch { self.error = error.localizedDescription }
    }
    func saveError(for id: UUID) -> String? { attemptExecution?.saveError(for: id) }
    var canSaveAgain: Bool { canDeleteLookup }
    func saveAgain(_ id: UUID) {
        guard canSaveAgain, entries.contains(where: { $0.id == id }) else { return }
        attemptExecution?.saveAgain(id)
    }
    func newQuery() {
        guard !busy, !launcherPending else { return }
        selection = nil
        inputValues = [:]
        inputImage = nil
        inputImageError = nil
        overridePresetID = nil
        replayEntry = nil
        if !configuration.actions.contains(where: { $0.id == selectedActionID }) {
            selectedActionID = configuration.actions.first?.id
        }
        error = nil
        draftRevision += 1
    }
    func reuse(_ entry: HistoryEntry) {
        guard !busy, !launcherPending else { return }
        var saved = entry
        if saved.actionSnapshot == nil {
            let preset = ModelPreset(
                name: "Saved", model: entry.model, effort: entry.effort,
                fast: entry.requestedServiceTier != nil)
            saved.actionSnapshot = Action(
                name: entry.mode.rawValue, presetID: preset.id,
                template: entry.mode.instruction + "\n\n{{text}}", legacyMode: entry.mode)
            saved.presetSnapshot = preset
            saved.inputValues = ["text": entry.query]
        }
        do {
            inputImage = try history?.inputImage(for: saved)
            inputImageError = nil
        } catch {
            inputImage = nil
            inputImageError = "The saved input image is unavailable. Attach it again."
        }
        replayEntry = saved
        inputValues = saved.inputValues ?? [:]
        overridePresetID = nil
        selection = nil
        draftRevision += 1
    }
    func shutdown() {
        imageLoadTask?.cancel()
        cancelLogin()
        stop()
    }
    var canDeleteLookup: Bool { !busy && !launcherPending && history != nil && lock != nil }
    func deleteLookup(_ id: UUID) {
        guard canDeleteLookup, entries.contains(where: { $0.id == id }), let history else { return }
        do {
            try history.delete(id: id)
            attemptExecution?.forget(id)
            entries.removeAll { $0.id == id }
            followUpDrafts[id] = nil
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
        if entry.capability == .draw {
            downloadImage(entry)
            return
        }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "EZ-\(entry.id.uuidString.prefix(8)).md"
        if panel.runModal() == .OK, let url = panel.url {
            do { try entry.markdown.write(to: url, atomically: true, encoding: .utf8) } catch {
                self.error = error.localizedDescription
            }
        }
    }
    private func receiveAttempt(_ update: AttemptExecution.Update) {
        if let index = entries.firstIndex(where: { $0.id == update.entry.id }) {
            entries[index] = update.entry
        } else {
            entries.insert(update.entry, at: 0)
        }
        responseActivity = update.activity
        if selection == update.entry.id && update.entry.hasImage { loadSelectedImage() }
        busy = attemptExecution?.activeID != nil
        if !update.isActive, !offline { syncAccount() }
    }
}
