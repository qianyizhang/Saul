import AppKit
import Combine
import EZCore
import SaulCredentialClient
import SaulNativeValues

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
    private let session: ConnectionSession
    var connectionChecks: ConnectionChecks { session.checks }
    func connectionStatus(_ key: String) -> ConnectionStatus? { connectionChecks.report(key)?.status }
    func connectionCatalog(_ key: String) -> ConnectionCatalog? { connectionChecks.report(key)?.catalog }
    func connectionError(_ key: String) -> String? { connectionChecks.report(key)?.error }
    var checkingConnections: Set<String> { connectionChecks.checkingKeys }
    var entries: [HistoryRow] { historyCollection.entries }
    func showHistory(_ entries: [HistoryEntry]) { historyCollection.show(entries) }
    var historyLoading: Bool { historyCollection.loading }
    var historyHasMore: Bool { historyCollection.hasMore }
    var historyTotal: Int { historyCollection.total }
    var historyDetailLoading: Bool { historyCollection.detailLoading }
    var historyDetailError: String? { historyCollection.detailError }
    @Published var selection: UUID? {
        didSet {
            if selection != oldValue { showsMainComposer = false }
            historyCollection.select(selection)
        }
    }
    private var selectedHistoryConnectionKey: String?
    private lazy var lookupImage = LookupImageLoader(directory: historyDirectory) { [weak self] in
        self?.objectWillChange.send()
    }
    var imageLoading: Bool { lookupImage.isLoading }
    func imageData(for entry: HistoryEntry) -> Data? { lookupImage.data(for: entry) }
    private func loadSelectedImage() { lookupImage.select(selectedEntry) }
    @Published var followUpDrafts: [UUID: String] = [:]
    @Published var followUpTargetID: UUID?
    @Published var search = "" {
        didSet { if search != oldValue { refreshHistory() } }
    }
    var connecting: Bool { session.connecting }
    var profiles: [SaulAccount] { session.profiles }
    var signingIn: Bool { session.operation == .signIn }
    var credentialBusy: Bool { session.operation != nil }
    @Published private(set) var runningAttempt: AttemptExecution.Progress?
    var busy: Bool { runningAttempt != nil }
    var canStop: Bool { runningAttempt.map { $0.phase != .saving } == true && !quitting }
    var preparingAttempt: Bool { runningAttempt?.phase == .preparing }
    var savingAttempt: Bool { runningAttempt?.phase == .saving }
    private(set) var quitting = false
    @Published private var launcherWork: Task<Void, Never>?
    var launcherPending: Bool { launcherWork != nil }
    @Published var error: String?
    @Published var storageWarning: String?
    var sharedCredentialsConnected: Bool { session.connected }
    @Published var showSettings = false
    @Published var minimumMode: Bool {
        didSet { setMinimumMode(minimumMode) }
    }
    private let setMinimumMode: @MainActor (Bool) -> Void
    @Published private(set) var shortcuts = LookupShortcuts()
    @Published var shortcutSettingsError: String?
    private var shortcutsLoaded = false
    let directory: URL
    let historyDirectory: URL
    let allowsExternalServices: Bool
    let speak: (@MainActor (ModelPreset, String) async throws -> Data)?
    private let historyCollection: HistoryCollection
    private enum Submission {
        case lookup
        case retry(UUID)
        case followUp(UUID)
    }
    private var submitting: (id: UUID, previousSelection: UUID?, source: Submission)?
    private var lock: SessionLock?
    private var attemptExecution: AttemptExecution?
    private var configurationStore: ConfigurationStore?
    private var configurationLoaded = false

    init(
        directory: URL, historyDirectory: URL, session: ConnectionSession,
        configurationStore configStore: ConfigurationStore, initialConfiguration: Configuration,
        historyPreparation: HistoryCollection.Preparation, upgradeActions: Bool = false,
        minimumMode: Bool = true, setMinimumMode: @escaping @MainActor (Bool) -> Void = { _ in },
        attemptExecution: AttemptExecution? = nil,
        readHistory: @escaping @MainActor (String, HistoryCursor?) async throws -> HistoryPage,
        countHistory: @escaping @MainActor (String, [HistoryStore.RecordID]) async throws -> Int,
        readHistoryEntry: @escaping @MainActor (HistoryStore.RecordID) async throws -> HistoryEntry?,
        deleteHistory: @escaping @MainActor (HistoryStore.RecordID) async throws -> Void,
        speak: (@MainActor (ModelPreset, String) async throws -> Data)? = nil,
        allowsExternalServices: Bool = false
    ) {
        self.session = session
        self.allowsExternalServices = allowsExternalServices
        self.speak = speak
        self.attemptExecution = attemptExecution
        self.minimumMode = minimumMode
        self.setMinimumMode = setMinimumMode
        self.directory = directory
        self.historyDirectory = historyDirectory
        historyCollection = HistoryCollection(
            read: readHistory, count: countHistory, entry: readHistoryEntry, delete: deleteHistory)
        historyCollection.onChange = { [weak self] in
            guard let self else { return }
            objectWillChange.send()
            loadSelectedImage()
            // Selection can precede hydration. Only change focus when the
            // selected detail reveals a different saved connection.
            let key = selectedEntry?.presetSnapshot?.connectionKey
            if selectedHistoryConnectionKey != key {
                selectedHistoryConnectionKey = key
                refreshActiveConnection()
            }
        }
        historyCollection.onMissingSelection = { [weak self] in self?.selection = nil }
        session.onChange = { [weak self] in self?.objectWillChange.send() }
        connectionChecks.onChange = { [weak self] in self?.objectWillChange.send() }
        do {
            lock = try SessionLock(directory: directory)
            historyCollection.prepare(historyPreparation) { [weak self] in self?.storageWarning = $0 }
            configurationStore = configStore
            do {
                configuration = try configStore.load() ?? configStore.save(initialConfiguration)
                configurationLoaded = true
                if upgradeActions, (configuration.actionTypesVersion ?? 0) < 2 {
                    var upgraded = configuration
                    upgraded.addSearchAndMeme()
                    configuration = try configStore.save(upgraded)
                }
                connectionChecks.reconcile(configuration.connections)
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
        case .stop: return canStop
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
    var selectedEntry: HistoryEntry? { historyCollection.selected }
    var selectedResponseActivity: ResponseActivity? {
        guard let runningAttempt, runningAttempt.phase == .generating,
            runningAttempt.entry.id == selection
        else { return nil }
        return runningAttempt.activity
    }
    var filteredEntries: [HistoryRow] { entries }
    @discardableResult func loadMoreHistory() -> Task<Void, Never>? {
        guard !quitting else { return nil }
        return historyCollection.more { [weak self] result in
            if case .failure(let error) = result { self?.storageWarning = error.localizedDescription }
        }
    }
    func waitForHistorySelection() async { await historyCollection.waitForSelection() }
    func reloadHistorySelection() { historyCollection.select(selection, force: true) }

    private var canStartLookup: Bool {
        attemptExecution != nil && historyCollection.ready && lock != nil && historyCollection.deleting == nil
            && !quitting && !busy && !launcherPending && !credentialBusy
    }

    var canSend: Bool {
        canStartLookup && connectionIssue == nil && requestIssue == nil
    }

    private func startLookup(_ entry: HistoryEntry, source: Submission = .lookup) throws {
        guard canStartLookup, let attemptExecution else { return }
        submitting = (entry.id, selection, source)
        do {
            try attemptExecution.start(entry)
            error = nil
        } catch {
            submitting = nil
            throw error
        }
    }
    func connect(loadAccounts: Bool = false) async {
        guard !quitting, !busy, lock != nil else { return }
        await session.connect {
            error = nil
            if let connection = currentConnection { await refreshConnection(connection) }
            guard loadAccounts else { return }
            do { try await session.loadAccounts() } catch {
                if !quitting && !Task.isCancelled { self.error = error.localizedDescription }
            }
        }
    }

    func connectCredentials() async {
        guard allowsExternalServices, !quitting, !busy, !credentialBusy, !launcherPending else { return }
        session.setConnected(true)
        await connect(loadAccounts: true)
    }

    func disconnectCredentials() {
        guard allowsExternalServices, !quitting, !busy, !connecting, !credentialBusy, !launcherPending else {
            return
        }
        session.setConnected(false)
        error = nil
    }

    func loadConnectionAccounts() async throws { try await session.loadAccounts() }

    func signInConnection(accountID: String, suggestedAppName: String?, consent: Bool) async throws -> String?
    {
        try session.begin(.signIn, blocked: busy || launcherPending)
        defer { session.endOperation() }
        return try await session.signIn(
            accountID, suggestedAppName: suggestedAppName, consent: consent,
            connections: configuration.connections)
    }

    func initializeStarterPreset() {
        // Only initialize the unassigned starter. Saved choices never silently normalize.
        guard let starterID = configuration.unassignedStarterID,
            let index = configuration.presets.firstIndex(where: { $0.id == starterID && $0.model.isEmpty })
        else { return }
        let starter = configuration.presets[index]
        guard connectionCatalog(starter.connectionKey)?.isFresh == true else { return }
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
    func saveConnection(
        _ connection: ConnectionDefinition, key: String? = nil, confirmedAppName: String? = nil
    ) async throws {
        guard configurationLoaded, let store = configurationStore else {
            throw EZError("Configuration is unavailable. Reload saved settings first.")
        }
        try session.begin(.save, blocked: busy || launcherPending)
        defer { session.endOperation() }
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
        if let key { try await session.client.saveKey(connection, key) }
        if let account = connection.accountId, let confirmedAppName {
            try await session.client.confirmAppName(account, confirmedAppName)
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

    func manageConnection(_ key: String, _ change: ConnectionChange) throws {
        var updated = configuration
        try updated.changeConnection(key, change)
        try saveConfiguration(updated)
    }

    func removeConnectionCredential(_ connection: ConnectionDefinition) async throws {
        guard configuration.connections.contains(where: { $0.matchesRoute(connection) }) else {
            throw EZError("The connection changed. Reload saved settings.")
        }
        try session.begin(.disconnect, blocked: busy || launcherPending)
        defer { session.endOperation() }
        try await session.removeCredential(connection)
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
        guard !quitting, !busy, !launcherPending, !credentialBusy, !showSettings else {
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

    func stop() { if canStop { attemptExecution?.stop() } }

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
            try startLookup(
                route.followUp(to: parent, question: followUpDrafts[id] ?? ""), source: .followUp(id))
        } catch { self.error = error.localizedDescription }
    }
    func canRetry(_ entry: HistoryEntry) -> Bool {
        entry.isRetryable && canStartLookup && !connecting
    }
    func retry(_ id: UUID) {
        guard let original = historyCollection.knownDetail(id), canRetry(original),
            historyCollection.ready
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
                    connection: route.connection,
                    image: HistoryStore.readInputImage(for: original, directory: historyDirectory)),
                source: .retry(id))
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
            let attachment = try HistoryStore.readInputImage(for: saved, directory: historyDirectory)
            try draft.attach(attachment, asSketch: usesSketch, restoring: true)
        } catch {
            inputImageError = "The saved input image is unavailable. Attach it again."
        }
        selection = nil
    }
    /// Cancels producers immediately and leaves any decided storage outcome to settle.
    @discardableResult func shutdown() -> Bool {
        if !quitting {
            quitting = true
            launcherWork?.cancel()
            launcherWork = nil
            session.close()
            historyCollection.cancelRead()
            lookupImage.select(nil)
            attemptExecution?.beginShutdown()
        }
        return busy || historyCollection.settling
    }

    func waitForPersistence() async {
        await attemptExecution?.waitForSettlement()
        await historyCollection.waitForSettlement()
    }

    var canDeleteLookup: Bool {
        !quitting && !busy && !launcherPending && historyCollection.ready && lock != nil
            && historyCollection.deleting == nil
    }
    @discardableResult func deleteLookup(_ id: HistoryStore.RecordID) -> Task<Void, Never>? {
        guard canDeleteLookup,
            let entry = entries.first(where: { $0.recordID == id })
                ?? selectedEntry.flatMap({ $0.recordID == id ? HistoryRow($0) : nil })
        else { return nil }
        return historyCollection.remove(id) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success:
                followUpDrafts[entry.id] = nil
                if selection == entry.id { selection = nil }
            case .failure(let error):
                self.error = "Lookup could not be deleted. \(error.localizedDescription)"
            }
        }
    }

    @discardableResult func refreshHistory() -> Task<Void, Never>? {
        guard !quitting else { return nil }
        return historyCollection.refresh(search: search) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success:
                storageWarning = nil
                loadSelectedImage()
            case .failure(let error):
                storageWarning = error.localizedDescription
            }
        }
    }

    func waitForHistory() async { await historyCollection.waitForPreparation() }

    func revealHistory() {
        NSWorkspace.shared.activateFileViewerSelecting([
            historyCollection.ready ? historyDirectory.appendingPathComponent("history.sqlite3") : directory
        ])
    }
    func copy(_ text: String, using write: @MainActor (String) -> Bool = { TextClipboard.write($0) }) {
        if !write(text) { error = TextClipboard.failure }
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
        switch update {
        case .running(let progress):
            runningAttempt = progress
            guard progress.phase != .preparing else { return }
            historyCollection.record(progress.entry, active: true)
            if let submission = submitting, submission.id == progress.entry.id {
                submitting = nil
                if selection == submission.previousSelection { selection = submission.id }
                if progress.phase == .generating, case .followUp(let parent) = submission.source {
                    followUpDrafts[parent] = nil
                    if followUpTargetID == parent { followUpTargetID = nil }
                }
            }
        case .notSent(let id, let message):
            if let submission = submitting, submission.id == id {
                if case .retry(let original) = submission.source {
                    retryFailure = RetryFailure(entryID: original, message: message)
                } else {
                    error = message
                }
                submitting = nil
            } else {
                error = message
            }
            runningAttempt = nil
        case .saved(let saved):
            receiveTerminal(saved)
        case .saveFailed(var unsaved, let message):
            unsaved.status = "unsaved"
            let failure = "Could not save this lookup. \(message)"
            unsaved.error = unsaved.error.map { "\($0)\n\(failure)" } ?? failure
            if selection != unsaved.id { error = failure }
            receiveTerminal(unsaved)
        }
    }

    private func receiveTerminal(_ entry: HistoryEntry) {
        historyCollection.record(entry, active: false)
        if !quitting && selection == entry.id && entry.hasImage { loadSelectedImage() }
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
