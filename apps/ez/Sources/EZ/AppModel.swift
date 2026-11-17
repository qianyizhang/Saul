import AppKit
import Combine
import EZCore
import SaulCredentialStorage

@MainActor final class AppModel: ObservableObject {
    enum SettingsSection: String, CaseIterable {
        case overview, configuration, actions, preferences, connections, shortcuts
        var title: String {
            switch self {
            case .overview: "Overview"
            case .configuration: "Presets"
            case .actions: "Actions"
            case .preferences: "Preferences"
            case .connections: "Connections"
            case .shortcuts: "Shortcuts"
            }
        }
    }
    @Published var settingsSection: SettingsSection = .overview
    @Published var settingsPresetID: UUID?
    @Published private(set) var configuration = Configuration() {
        didSet {
            connectionChecks.reconcile(configuration.connections)
            if configuration.connections != oldValue.connections
                || draft.preset(in: oldValue)?.connectionKey != currentPreset?.connectionKey
            {
                refreshActiveConnection(preferred: currentConnection)
            }
        }
    }
    @Published private var draft = LookupDraft()
    var selectedActionID: UUID? { draft.selectedActionID }
    var overridePresetID: UUID? { draft.presetOverride }
    var inputValues: [String: String] { draft.values }
    var sketch: SketchDraft { draft.sketch }
    @Published var inputImageError: String?
    @Published var showsMainComposer = false
    struct RetryFailure {
        let entryID: UUID
        let message: String
    }
    @Published private(set) var retryFailure: RetryFailure?
    var outputFormatOverride: String? { draft.formatOverride }
    var outputFormat: String { outputFormatOverride ?? currentPreset?.imageOptions?.outputFormat ?? "png" }
    var draftRevision: Int { draft.revision }
    var replayEntry: HistoryEntry? { draft.reusedEntry }
    @Published var configurationError: String?
    /// Fixtures supply models locally; installed lookups use the bound connection's catalog.
    @Published var models: [ModelOption] = []
    let connectionChecks: ConnectionChecks
    func connectionStatus(_ key: String) -> ConnectionStatus? { connectionChecks.report(key)?.status }
    func connectionCatalog(_ key: String) -> ConnectionCatalog? { connectionChecks.report(key)?.catalog }
    func connectionError(_ key: String) -> String? { connectionChecks.report(key)?.error }
    var checkingConnections: Set<String> { connectionChecks.checkingKeys }
    @Published var entries: [HistoryEntry] = []
    @Published var selection: UUID? {
        didSet {
            if selection != oldValue { showsMainComposer = false }
            loadSelectedImage()
            refreshActiveConnection()
        }
    }
    private lazy var lookupImage = LookupImageLoader(directory: historyDirectory) { [weak self] in
        self?.objectWillChange.send()
    }
    var imageLoading: Bool { lookupImage.isLoading }
    func imageData(for entry: HistoryEntry) -> Data? { lookupImage.data(for: entry) }
    private func loadSelectedImage() { lookupImage.select(selectedEntry) }
    @Published var followUpDrafts: [UUID: String] = [:]
    @Published var followUpTargetID: UUID?
    @Published var search = ""
    @Published var connecting = false
    @Published var signedIn = false
    @Published var planEnabled = false
    @Published var profiles: [SaulAccount] = []
    private var accountRevision = 0
    private enum CredentialOperation {
        case signIn, save, disconnect
    }
    @Published private var credentialOperation: CredentialOperation?
    var signingIn: Bool { credentialOperation == .signIn }
    var credentialBusy: Bool { credentialOperation != nil }
    @Published private(set) var runningAttempt: AttemptExecution.Progress?
    var busy: Bool { runningAttempt != nil }
    @Published private var launcherWork: Task<Void, Never>?
    var launcherPending: Bool { launcherWork != nil }
    @Published var error: String?
    @Published var storageWarning: String?
    @Published var apiConnected = false
    @Published private(set) var sharedCredentialsConnected = true
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
    let historyDirectory: URL
    let offline: Bool
    let auth: SaulConnection
    private var history: HistoryStore?
    private let readHistory: @MainActor () async throws -> [HistoryEntry]
    private var historyRead: Task<Void, Never>?
    private enum HistoryChange {
        case upsert(HistoryEntry)
        case delete
    }
    private var historyChanges: [HistoryStore.RecordID: HistoryChange] = [:]
    private var lock: SessionLock?
    private var attemptExecution: AttemptExecution?
    private var configurationStore: ConfigurationStore?
    private var configurationLoaded = false

    init(
        directory: URL? = nil, historyDirectory: URL? = nil, offline: Bool = false,
        attemptExecution: AttemptExecution? = nil, apiKeyStore: (any OpenAIKeyStorage)? = nil,
        connectionChecks: ConnectionChecks? = nil,
        readHistory: (@MainActor () async throws -> [HistoryEntry])? = nil
    ) {
        let auth = SaulConnection()
        self.auth = auth
        self.connectionChecks =
            connectionChecks
            ?? ConnectionChecks(
                status: { [auth] connection in
                    let reply = try await auth.call([
                        "action": "connection-status", "connectionKey": connection.key,
                    ])
                    guard let raw = reply["connection"] else { throw EZError("Invalid connection status.") }
                    return try JSONDecoder().decode(
                        ConnectionStatus.self, from: JSONSerialization.data(withJSONObject: raw))
                },
                catalog: { [auth] connection, intent in
                    let reply = try await auth.call([
                        "action": "connection-catalog", "connectionKey": connection.key,
                        "intent": intent.rawValue,
                    ])
                    guard let raw = reply["catalog"] else { throw EZError("Invalid model catalog.") }
                    return try JSONDecoder().decode(
                        ConnectionCatalog.self, from: JSONSerialization.data(withJSONObject: raw))
                })
        self.offline = offline
        sharedCredentialsConnected =
            offline || !UserDefaults.standard.bool(forKey: "saulCredentialsDisconnected")
        self.apiKeyStore = apiKeyStore ?? TemporaryAPIKeyStore()
        self.attemptExecution = attemptExecution
        minimumMode = offline ? true : UserDefaults.standard.object(forKey: "minimumMode") as? Bool ?? true
        self.directory =
            directory
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("EZ", isDirectory: true)
        self.historyDirectory = historyDirectory ?? (offline ? self.directory : HistoryStore.defaultDirectory)
        let reader = HistoryReader(directory: self.historyDirectory)
        self.readHistory = readHistory ?? { try await reader.load() }
        self.connectionChecks.onChange = { [weak self] in self?.objectWillChange.send() }
        do {
            lock = try SessionLock(directory: self.directory)
            let store = try HistoryStore(
                directory: self.historyDirectory,
                migrating: offline ? nil : self.directory)
            try store.recoverInterrupted()
            history = store
            if !offline, attemptExecution == nil {
                let generation = SaulGeneration(connection: auth)
                self.attemptExecution = AttemptExecution(
                    generate: generation.generate(entry:onUpdate:), append: { try store.append($0) })
            }
            let configStore = ConfigurationStore(
                directory: self.directory, shared: offline ? nil : SharedPresetsStore())
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
                    configuration = try configStore.save(configuration)
                }
                configurationLoaded = true
                if !offline, (configuration.actionTypesVersion ?? 0) < 2 {
                    var upgraded = configuration
                    upgraded.addSearchAndMeme()
                    configuration = try configStore.save(upgraded)
                }
                draft.reset(actionID: configuration.actions.first?.id)
            } catch {
                configurationError =
                    "Configuration could not be loaded. Original file is preserved. \(error.localizedDescription)"
            }
            do {
                shortcuts = try LookupShortcutsStore(directory: self.directory).load()
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
        try LookupShortcutsStore(directory: self.directory).save(updated)
        shortcuts = updated
        shortcutSettingsError = nil
    }

    func restoreShortcuts() throws {
        guard lock != nil else { throw EZError("Shortcut storage is unavailable.") }
        let defaults = LookupShortcuts()
        try LookupShortcutsStore(directory: self.directory).save(defaults)
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
    var currentAction: Action? { draft.action(in: configuration) }
    var usesSketch: Bool {
        currentAction?.id == Configuration.makeMemeActionID && currentAction?.imageInput != nil
    }
    var inputImage: ImageAttachment? { usesSketch ? sketch.scene.photo?.asset.attachment : draft.attachment }
    var hasImageInput: Bool { usesSketch ? sketch.scene.hasContent : inputImage != nil }
    var hasRetainedDraft: Bool {
        inputValues.values.contains { !$0.isEmpty } || hasImageInput || replayEntry != nil
            || overridePresetID != nil || outputFormatOverride != nil
            || (usesSketch && (sketch.canUndo || sketch.canRedo))
    }
    func openSettings(_ section: SettingsSection = .overview) {
        if !showSettings { refreshConfiguration() }
        settingsSection = section
        showSettings = true
    }
    var currentPreset: ModelPreset? { draft.preset(in: configuration) }
    var inputFields: [String] { currentAction.flatMap { try? PromptTemplate($0.template).fields } ?? [] }

    var query: String {
        get { inputFields.first.flatMap { inputValues[$0] } ?? "" }
        set { if let field = inputFields.first { setInput(newValue, for: field) } }
    }
    func setInput(_ value: String, for field: String) {
        guard !launcherPending, inputFields.contains(field) else { return }
        draft.setValue(value, for: field)
    }
    func chooseOutputFormat(_ format: String) {
        guard !busy, !launcherPending, currentAction?.capability == .draw,
            ImageOptions.formats.contains(format)
        else { return }
        draft.setFormat(format)
    }
    var selectedModel: String { currentPreset?.model ?? "" }
    var effort: String { currentPreset?.effort ?? "" }
    var fast: Bool { currentPreset?.fast ?? false }
    var configurationLocked: Bool {
        busy || launcherPending || credentialBusy || !configurationLoaded
    }
    var requestIssue: String? {
        do {
            _ = try prepareDraftRequest().compile()
            return nil
        } catch { return error.localizedDescription }
    }

    private func resolveRoute(_ preset: ModelPreset) throws -> LookupRoute {
        guard let connection = configuration.connections.first(where: { $0.key == preset.connectionKey })
        else { throw EZError("The preset’s connection is unavailable. Update the preset in Settings.") }
        guard connection.capabilities.contains(preset.capability), preset.capability != .speak else {
            throw EZError("Choose a compatible preset for this action.")
        }
        if let issue = presetIssue(preset) { throw EZError(issue) }
        return LookupRoute(preset: preset, connection: connection, models: modelsForPreset(preset))
    }

    private func prepareDraftRequest() throws -> LookupRequest {
        guard configurationLoaded else {
            throw EZError(configurationError ?? "Configuration is unavailable.")
        }
        guard let action = currentAction else {
            throw EZError("Add an action in Settings → Actions to start a run.")
        }
        guard let preset = currentPreset else { throw EZError("Choose a preset in Settings → Presets.") }
        guard action.capability == preset.capability else {
            throw EZError("Choose a \(action.capability.name) preset for this action.")
        }
        let route = try resolveRoute(preset)
        if let saved = replayEntry?.connectionSnapshot, overridePresetID == nil {
            try route.requireSavedConnection(saved)
        }
        return LookupRequest(
            action: action, route: route, values: inputValues,
            source: usesSketch ? .sketch(sketch.scene) : .attachment(inputImage),
            outputFormat: outputFormat)
    }
    var selectedEntry: HistoryEntry? { entries.first { $0.id == selection } }
    var selectedResponseActivity: ResponseActivity? {
        guard let runningAttempt, runningAttempt.entry.id == selection else { return nil }
        return runningAttempt.activity
    }
    var filteredEntries: [HistoryEntry] {
        search.isEmpty
            ? entries
            : entries.filter {
                $0.query.localizedCaseInsensitiveContains(search)
                    || $0.response.localizedCaseInsensitiveContains(search)
            }
    }
    private var canStartLookup: Bool {
        attemptExecution != nil && history != nil && lock != nil
            && !busy && !launcherPending && !credentialBusy
    }

    var canSend: Bool {
        canStartLookup && connectionIssue == nil && requestIssue == nil
    }

    private func startLookup(_ entry: HistoryEntry) throws {
        guard canStartLookup, let attemptExecution else { return }
        try attemptExecution.start(entry)
        selection = entry.id
        error = nil
    }
    func connect(loadAccounts: Bool = false) async {
        guard !offline, sharedCredentialsConnected, !connecting, !busy, !credentialBusy, lock != nil else {
            return
        }
        connecting = true
        error = nil
        defer { connecting = false }
        if let connection = currentConnection { await refreshConnection(connection) }
        guard loadAccounts else { return }
        do {
            try await loadConnectionAccounts()
        } catch {
            self.error = error.localizedDescription
        }
    }
    func connectCredentials() async {
        guard !offline, !busy, !credentialBusy, !launcherPending else { return }
        sharedCredentialsConnected = true
        UserDefaults.standard.set(false, forKey: "saulCredentialsDisconnected")
        await connect(loadAccounts: true)
    }
    func disconnectCredentials() {
        guard !offline, !busy, !connecting, !credentialBusy, !launcherPending else { return }
        sharedCredentialsConnected = false
        connectionChecks.reset()
        accountRevision += 1
        UserDefaults.standard.set(true, forKey: "saulCredentialsDisconnected")
        profiles = []
        error = nil
    }
    func loadConnectionAccounts() async throws {
        guard !offline, sharedCredentialsConnected else { return }
        let revision = accountRevision
        try await auth.load()
        try Task.checkCancellation()
        guard sharedCredentialsConnected, accountRevision == revision else { return }
        profiles = auth.accounts
    }

    func signInConnection(accountID: String, addingAccount: Bool) async throws -> String? {
        guard !offline, sharedCredentialsConnected else {
            throw EZError("Connect to Saul before signing in.")
        }
        try beginCredentialOperation(.signIn)
        defer { credentialOperation = nil }
        let reply = try await auth.signIn(
            accountID: accountID, addingAccount: addingAccount,
            authorize: { NSWorkspace.shared.open($0) })
        accountRevision += 1
        let signedInID = (reply["account"] as? [String: Any])?["id"] as? String
        if let signedInID {
            connectionChecks.clearLogoutWarning(accountID: signedInID)
            for connection in configuration.connections where connection.accountId == signedInID {
                connectionChecks.invalidate(connection.key)
            }
        }
        try Task.checkCancellation()
        try await loadConnectionAccounts()
        return signedInID
    }

    private func beginCredentialOperation(_ operation: CredentialOperation) throws {
        guard sharedCredentialsConnected else {
            throw EZError("Connect to Saul before changing credentials.")
        }
        guard !credentialBusy, !busy, !launcherPending, !connecting else {
            throw EZError("Wait for the current operation before changing connections.")
        }
        credentialOperation = operation
    }

    func initializeStarterPreset() {
        // Only initialize the unassigned starter. Saved choices never silently normalize.
        guard let starterID = configuration.unassignedStarterID,
            let index = configuration.presets.firstIndex(where: { $0.id == starterID && $0.model.isEmpty })
        else { return }
        let starter = configuration.presets[index]
        guard offline || connectionCatalog(starter.connectionKey)?.isFresh == true else { return }
        let options = modelsForPreset(starter)
        guard let option = options.first(where: \.isDefault) ?? options.first else { return }
        var updated = configuration
        updated.presets[index].model = option.model
        updated.presets[index].effort = option.supportedReasoningEfforts.isEmpty ? "" : option.quickEffort
        updated.presets[index].fast = false
        updated.unassignedStarterID = nil
        guard let store = configurationStore else { return }
        do {
            configuration = try store.save(updated)
        } catch { configurationError = "Starter preset could not be saved. \(error.localizedDescription)" }
    }
    func chooseAction(_ id: UUID?) {
        guard !busy, !launcherPending else { return }
        if !showSettings { refreshConfiguration() }
        guard id == nil || configuration.actions.contains(where: { $0.id == id }) else { return }
        guard replayEntry != nil || selectedActionID != id else { return }
        resetDraft(actionID: id)
    }
    func chooseLookupPreset(_ id: UUID?) {
        guard !busy, !launcherPending, !credentialBusy else { return }
        let preset =
            id.flatMap { id in configuration.presets.first { $0.id == id } }
            ?? (id == nil ? replayEntry?.presetSnapshot : nil)
        guard let preset, lookupPresetChoiceIssue(preset) == nil else { return }
        draft.choosePreset(id)
        refreshActiveConnection(preferred: currentConnection)
    }
    func saveConfiguration(_ updated: Configuration) throws {
        guard !configurationLocked, let store = configurationStore else {
            throw EZError(
                "Configuration cannot be changed while a request is active or storage is unavailable.")
        }
        try persistConfiguration(updated, store: store)
    }

    private func persistConfiguration(_ updated: Configuration, store: ConfigurationStore) throws {
        var saved = updated
        if let id = saved.unassignedStarterID,
            !saved.presets.contains(where: { $0.id == id && $0.model.isEmpty })
        {
            saved.unassignedStarterID = nil
        }
        configuration = try store.save(saved)
        configurationError = nil
        if replayEntry == nil && !configuration.actions.contains(where: { $0.id == selectedActionID }) {
            resetDraft(actionID: configuration.actions.first?.id)
        } else {
            draft.retainFields(inputFields)
            if currentAction?.imageInput == nil {
                clearImageInput()
            }
        }
    }
    func saveConnection(_ connection: ConnectionDefinition, key: String? = nil) async throws {
        guard configurationLoaded, let store = configurationStore else {
            throw EZError("Configuration is unavailable. Reload saved settings first.")
        }
        try beginCredentialOperation(.save)
        defer { credentialOperation = nil }
        var updated = configuration
        if let index = updated.connections.firstIndex(where: { $0.key == connection.key }) {
            let existing = updated.connections[index]
            guard existing.kind == connection.kind, existing.endpoint == connection.endpoint,
                existing.accountId == nil || existing.accountId == connection.accountId
            else { throw EZError("The connection’s account and endpoint are fixed. Add another connection.") }
            updated.connections[index] = connection
        } else {
            updated.connections.append(connection)
        }
        try ConnectionDefinition.validate(updated.connections)
        if let account = connection.accountId,
            updated.connections.contains(where: { $0.key != connection.key && $0.accountId == account })
        {
            throw EZError("This account already has a connection.")
        }
        if let key {
            if offline {
                try await apiKeyStore.write(key)
                apiConnected = !key.isEmpty
            } else {
                _ = try await auth.call([
                    "action": "connection-key-save", "connectionKey": connection.key,
                    "endpoint": connection.endpoint, "key": key,
                ])
            }
        }
        connectionChecks.invalidate(connection.key)
        do { try persistConfiguration(updated, store: store) } catch {
            if key != nil {
                throw EZError(
                    "The key was saved, but the connection settings were not saved. \(error.localizedDescription)"
                )
            }
            throw error
        }
        await refreshConnection(connection, intent: .setup)
    }

    func removeConnectionCredential(_ connection: ConnectionDefinition) async throws {
        guard configuration.connections.contains(where: { $0.matchesRoute(connection) }) else {
            throw EZError("The connection changed. Reload saved settings.")
        }
        try beginCredentialOperation(.disconnect)
        defer { credentialOperation = nil }
        if offline {
            try await apiKeyStore.write(nil)
            apiConnected = false
            return
        }
        if connection.kind == .chatGPTPlan {
            guard let account = connection.accountId else { throw EZError("This connection has no account.") }
            let reply = try await auth.call(["action": "logout", "accountId": account])
            let outcome = try JSONDecoder().decode(
                ConnectionChecks.LogoutOutcome.self, from: JSONSerialization.data(withJSONObject: reply))
            try connectionChecks.didSignOut(outcome, from: connection)
            accountRevision += 1
            if let index = profiles.firstIndex(where: { $0.id == account }) {
                profiles[index] = outcome.account
            }
        } else {
            _ = try await auth.call([
                "action": "connection-key-remove", "connectionKey": connection.key,
                "endpoint": connection.endpoint,
            ])
            connectionChecks.invalidate(connection.key)
        }
        await refreshConnection(connection)
    }

    func refreshConfiguration() {
        guard !busy, !launcherPending, !credentialBusy, let store = configurationStore else { return }
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
        guard !busy, !launcherPending, !credentialBusy, !showSettings,
            selection == nil, !hasRetainedDraft,
            let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            text.utf8.count <= 16_384, let field = inputFields.first
        else { return }
        draft.setValues([field: text])
    }

    func prepareSelectedText(_ text: String) throws {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            text.utf8.count <= 16_384
        else {
            throw EZError("Select 1–16,384 UTF-8 bytes of text for EZ.")
        }
        guard !busy, !launcherPending, !credentialBusy else {
            throw EZError(
                "EZ is already preparing a lookup, generating an answer, or signing in. Try again when it finishes."
            )
        }
        guard !showSettings else {
            throw EZError("Close EZ Settings before looking up selected text.")
        }
        guard !hasRetainedDraft else {
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
        resetDraft(actionID: action.id)
        draft.setValues(prepared.values)
        // Services prepares only a draft, even for single-field actions and after sign-in.
    }

    /// Launcher inputs use the normal draft; only complete actions wait for the initial connection.
    func submitLauncher(_ text: String, after connection: Task<Void, Never>) throws {
        guard !busy, !launcherPending, !credentialBusy, !showSettings else {
            throw EZError("EZ is already preparing or generating a lookup, signing in, or editing Settings.")
        }
        let action = configuration.actions.first { $0.id == selectedActionID } ?? configuration.actions.first
        guard let action else {
            throw EZError("Add an action in Settings → Actions before using Raycast.")
        }
        let prepared = try configuration.preparingLauncherInput(text, recipeID: action.id)
        resetDraft(actionID: action.id)
        draft.setValues(prepared.values)
        guard prepared.submit else { return }
        launcherWork = Task { [weak self] in
            await connection.value
            guard !Task.isCancelled, let self else { return }
            self.launcherWork = nil
            self.send()
            if !self.busy, self.error == nil {
                self.error =
                    self.storageWarning ?? self.connectionIssue ?? self.requestIssue
                    ?? "Query not sent. Your draft is ready to submit with Run."
            }
        }
    }
    func send() {
        guard canStartLookup else { return }
        let shownAction = currentAction
        let shownPreset = currentPreset
        let shownConnection = currentConnection
        refreshConfiguration()
        do {
            guard shownAction == currentAction, shownPreset == currentPreset,
                shownConnection.map({ shown in currentConnection?.matchesRoute(shown) == true })
                    ?? (currentConnection == nil)
            else {
                throw EZError("Lookup setup changed. Review the action and preset, then choose Run again.")
            }
            let request = try prepareDraftRequest()
            if let issue = connectionIssue(for: request.route.preset) { throw EZError(issue) }
            try startLookup(request.freeze())
        } catch { self.error = error.localizedDescription }
    }

    func stop() { attemptExecution?.stop() }

    var canFollowUp: Bool {
        canStartLookup && !connecting && selectedEntry?.capability == .write
            && selectedEntry?.sourceID == nil && selectedEntry?.status == "completed"
    }

    func followUp(_ id: UUID) {
        guard canFollowUp, let parent = selectedEntry, parent.id == id else { return }
        refreshConfiguration()
        do {
            guard configurationLoaded else {
                throw EZError(configurationError ?? "Configuration is unavailable.")
            }
            let preset =
                parent.presetSnapshot
                ?? ModelPreset(
                    name: "Saved", model: parent.model, effort: parent.effort,
                    fast: parent.requestedServiceTier != nil)
            let route = try resolveRoute(preset)
            if let issue = connectionIssue(for: preset) { throw EZError(issue) }
            try startLookup(route.followUp(to: parent, question: followUpDrafts[id] ?? ""))
            followUpDrafts[id] = nil
            if followUpTargetID == id { followUpTargetID = nil }
        } catch { self.error = error.localizedDescription }
    }
    func canRetry(_ entry: HistoryEntry) -> Bool {
        entry.isRetryable && canStartLookup && !connecting
    }
    func retry(_ id: UUID) {
        guard let original = entries.first(where: { $0.id == id }), canRetry(original),
            let history
        else { return }
        retryFailure = nil
        refreshConfiguration()
        do {
            guard configurationLoaded else {
                throw EZError(configurationError ?? "Configuration is unavailable. Open Settings.")
            }
            guard let preset = original.presetSnapshot else {
                throw EZError("The saved preset is unavailable. Review the saved request.")
            }
            let route = try resolveRoute(preset)
            if let issue = connectionIssue(for: preset) { throw EZError(issue) }
            try startLookup(
                original.prepareRetry(
                    connection: route.connection, image: history.inputImage(for: original)))
        } catch {
            retryFailure = RetryFailure(entryID: id, message: error.localizedDescription)
        }
    }
    func newQuery() {
        guard !busy, !launcherPending else { return }
        let action = configuration.actions.first { $0.id == selectedActionID } ?? configuration.actions.first
        resetDraft(actionID: action?.id)
    }
    private func resetDraft(actionID: UUID?) {
        draft.reset(actionID: actionID)
        inputImageError = nil
        selection = nil
        error = nil
    }
    func canReuse(_ entry: HistoryEntry) -> Bool {
        entry.sourceID == nil && !["pending", "unsaved"].contains(entry.status) && !busy && !launcherPending
    }
    func reuse(_ entry: HistoryEntry) {
        if entry.sourceID != nil {
            error = "Open this saved request in Saul to run it again."
            return
        }
        guard canReuse(entry) else { return }
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
        draft.reuse(saved)
        inputImageError = nil
        do {
            let attachment = try history?.inputImage(for: saved)
            try draft.attach(attachment, asSketch: usesSketch, restoring: true)
        } catch {
            inputImageError = "The saved input image is unavailable. Attach it again."
        }
        selection = nil
    }
    func shutdown() {
        launcherWork?.cancel()
        launcherWork = nil
        connectionChecks.reset()
        cancelHistoryRead()
        lookupImage.select(nil)
        attemptExecution?.interrupt()
    }
    var canDeleteLookup: Bool { !busy && !launcherPending && history != nil && lock != nil }
    func deleteLookup(_ id: HistoryStore.RecordID) {
        guard canDeleteLookup, let entry = entries.first(where: { $0.recordID == id }), let history
        else { return }
        do {
            try history.delete(id)
            if historyRead != nil { historyChanges[id] = .delete }
            entries.removeAll { $0.recordID == id }
            followUpDrafts[entry.id] = nil
            if selection == entry.id { selection = nil }
        } catch {
            self.error = "Lookup could not be deleted. \(error.localizedDescription)"
        }
    }

    private func cancelHistoryRead() {
        historyRead?.cancel()
        historyRead = nil
        historyChanges.removeAll()
    }

    @discardableResult func refreshHistory() -> Task<Void, Never>? {
        guard history != nil else { return nil }
        cancelHistoryRead()
        historyRead = Task { [weak self, readHistory] in
            defer {
                if !Task.isCancelled {
                    self?.historyRead = nil
                    self?.historyChanges.removeAll()
                }
            }
            do {
                var saved = try await readHistory()
                guard !Task.isCancelled, let self else { return }
                // A concurrent local write is newer than this snapshot. Retain it
                // without dropping unrelated rows, including on the first startup load.
                var changes = historyChanges
                if let active = runningAttempt?.entry { changes[active.recordID] = .upsert(active) }
                if !changes.isEmpty {
                    saved.removeAll { changes[$0.recordID] != nil }
                    for case .upsert(let entry) in changes.values {
                        let position =
                            saved.firstIndex {
                                $0.createdAt < entry.createdAt
                                    || ($0.createdAt == entry.createdAt
                                        && $0.id.uuidString < entry.id.uuidString)
                            } ?? saved.endIndex
                        saved.insert(entry, at: position)
                    }
                }
                entries = saved
                storageWarning = nil
                if let selection, !entries.contains(where: { $0.id == selection }) {
                    self.selection = nil
                } else {
                    loadSelectedImage()
                }
            } catch {
                if !Task.isCancelled { self?.storageWarning = error.localizedDescription }
            }
        }
        return historyRead
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
        let entry: HistoryEntry
        switch update {
        case .running(let progress):
            runningAttempt = progress
            entry = progress.entry
        case .saved(let saved):
            entry = saved
        case .saveFailed(var unsaved, let message):
            unsaved.status = "unsaved"
            let failure = "Could not save this lookup. \(message)"
            unsaved.error = unsaved.error.map { "\($0)\n\(failure)" } ?? failure
            if selection != unsaved.id { error = failure }
            entry = unsaved
        }
        if let index = entries.firstIndex(where: { $0.id == entry.id }) {
            entries[index] = entry
        } else {
            entries.insert(entry, at: 0)
        }
        if selection == entry.id && entry.hasImage { loadSelectedImage() }
        if case .running = update { return }
        if historyRead != nil { historyChanges[entry.recordID] = .upsert(entry) }
        runningAttempt = nil
    }
}

extension AppModel {
    var canEditSketch: Bool { usesSketch && !busy && !launcherPending }

    func commitSketch(_ scene: SketchScene) { updateSketch { $0.commit(scene) } }
    func undoSketch() { updateSketch { $0.undo() } }
    func redoSketch() { updateSketch { $0.redo() } }

    func setImageInput(_ attachment: ImageAttachment) throws {
        guard !busy, !launcherPending, currentAction?.imageInput != nil else { return }
        try draft.attach(attachment, asSketch: usesSketch)
    }

    private func clearImageInput() {
        draft.clearImage()
        inputImageError = nil
    }

    func removeImageInput() {
        guard !busy, !launcherPending else { return }
        if usesSketch {
            beginImageImport()
            inputImageError = nil
            commitSketch(SketchScene())
        } else {
            clearImageInput()
        }
    }

    @discardableResult func beginImageImport() -> UUID { draft.beginImageImport() }

    func finishImageImport(_ id: UUID, apply: () -> Void) {
        guard draft.acceptsImageImport(id), !busy, !launcherPending, currentAction?.imageInput != nil
        else { return }
        apply()
    }

    private func updateSketch(_ update: (inout SketchDraft) -> Void) {
        guard canEditSketch else { return }
        draft.updateSketch(update)
    }
}
