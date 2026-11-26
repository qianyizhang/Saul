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
    @Published private var reuseImageWork: Task<Void, Never>?
    private var needsSavedImageRecovery = false
    var restoringSavedImage: Bool { reuseImageWork != nil }
    var canContinueWithoutSavedImage: Bool {
        needsSavedImageRecovery && currentAction?.imageInput == nil
    }
    @Published private var retryWork: Task<Void, Never>?
    @Published private(set) var retryPreparingID: UUID?
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
            if selection != oldValue {
                showsMainComposer = false
                cancelRetryPreparation()
                cancelSavedImageRestore(needsRecovery: true)
            }
            historyCollection.select(selection)
        }
    }
    private var selectedHistoryConnectionKey: String?
    var imageLoading: Bool { historyCollection.image.isLoading }
    func imageData(for entry: HistoryEntry) -> Data? { historyCollection.image.data(for: entry) }
    func waitForSelectedImage() async { await historyCollection.image.wait() }
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
    var canStop: Bool {
        !quitting
            && (retryWork != nil
                || runningAttempt.map { $0.phase == .preparing || $0.phase == .generating } == true)
    }
    var preparingAttempt: Bool { runningAttempt?.phase == .preparing }
    var savingAttempt: Bool { runningAttempt?.phase == .saving }
    var discardingAttempt: Bool { runningAttempt?.phase == .discarding }
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
    let library: LibraryMaintenance?
    var canMaintainLibrary: Bool {
        !quitting && !busy && !launcherPending && historyCollection.ready && lock != nil
    }
    private let readInputImage: @MainActor (HistoryEntry) async throws -> ImageAttachment?
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
        readInputImage: @escaping @MainActor (HistoryEntry) async throws -> ImageAttachment?,
        readOutputImage: @escaping @MainActor (HistoryEntry) async throws -> Data?,
        deleteHistory: @escaping @MainActor (HistoryStore.RecordID, Bool, Int64?) async throws -> Void,
        library: LibraryMaintenance? = nil,
        speak: (@MainActor (ModelPreset, String) async throws -> Data)? = nil,
        allowsExternalServices: Bool = false
    ) {
        self.session = session
        self.allowsExternalServices = allowsExternalServices
        self.speak = speak
        self.library = library
        self.attemptExecution = attemptExecution
        self.minimumMode = minimumMode
        self.setMinimumMode = setMinimumMode
        self.directory = directory
        self.historyDirectory = historyDirectory
        self.readInputImage = readInputImage
        historyCollection = HistoryCollection(
            read: readHistory, count: countHistory, entry: readHistoryEntry,
            readImage: readOutputImage, delete: deleteHistory)
        historyCollection.onChange = { [weak self] in
            guard let self else { return }
            objectWillChange.send()
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
            do { try session.loadSetup(in: directory) } catch {
                storageWarning =
                    "Unfinished connection setup could not be read. \(error.localizedDescription)"
            }
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
        cancelRetryPreparation()
        draft.setValue(value, for: field)
    }
    func chooseOutputFormat(_ format: String) {
        guard !busy, !launcherPending, currentAction?.capability == .draw,
            ImageOptions.formats.contains(format)
        else { return }
        cancelRetryPreparation()
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
        if restoringSavedImage { throw EZError("Loading saved input image…") }
        if needsSavedImageRecovery {
            throw EZError("Resolve the saved input image before running.")
        }
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
        cancelRetryPreparation()
        var entry = entry
        switch source {
        case .retry(let previous):
            if historyCollection.knownDetail(previous)?.transientFailure != true {
                entry.admissionSourceID = previous.uuidString.lowercased()
            }
        case .followUp(let previous):
            entry.admissionSourceID = previous.uuidString.lowercased()
        case .lookup:
            if let reused = draft.reusedEntry, !reused.transientFailure {
                entry.admissionSourceID = reused.id.uuidString.lowercased()
            }
        }
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

    func signInConnection(
        accountID: String, previous: ConnectionDefinition?, suggestedAppName: String?, consent: Bool
    ) async throws -> String? {
        guard !configurationLocked else { throw EZError("Wait for the current operation.") }
        let latest = try readCurrentConfiguration()
        if let previous {
            try validateConnectionTarget(previous, in: latest)
            if let bound = previous.accountId, bound != accountID || suggestedAppName != nil {
                throw EZError("Use the saved account to sign in again.")
            }
        }
        if suggestedAppName == nil
            && latest.connections.contains(where: {
                $0.accountId == accountID && $0.key != previous?.key
            })
        {
            throw EZError("This account already has a connection. Reopen its settings to sign in.")
        }
        return try await session.signIn(
            accountID, suggestedAppName: suggestedAppName, consent: consent,
            connections: latest.connections, blocked: busy || launcherPending)
    }

    func initializeStarterPreset() {
        // Only initialize the unassigned starter. Saved choices never silently normalize.
        guard let starterID = configuration.unassignedStarterID,
            let index = configuration.presets.firstIndex(where: { $0.id == starterID && $0.model.isEmpty })
        else { return }
        let starter = configuration.presets[index]
        guard connectionCatalog(starter.connectionKey)?.isFresh == true else { return }
        let options = modelsForPreset(starter)
        guard let option = options.first(where: { $0.isDefault == true }) ?? options.first else { return }
        var updated = configuration
        updated.presets[index].model = option.id
        updated.presets[index].effort = option.quickEffort
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
        cancelRetryPreparation()
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
        _ connection: ConnectionDefinition, previous: ConnectionDefinition?, key: String? = nil,
        confirmedAppName: String? = nil
    ) async throws {
        try await saveConnectionSetup(
            .start(connection, previous: previous, confirmedName: confirmedAppName), key: key)
    }

    var pendingConnectionSetup: ConnectionSetup? { session.pendingSetup }
    var connectionSetupRepairChoice: ConnectionSession.SetupRepairChoice? { session.setupRepairChoice }

    func resumeConnectionSetup(_ id: UUID, phase: ConnectionSetup.Phase, key: String? = nil) async throws {
        try await saveConnectionSetup(.resume(id, phase: phase), key: key)
    }

    func repairConnectionSetup(
        _ id: UUID, choice: ConnectionSession.SetupRepairChoice, key: String? = nil
    ) async throws {
        try await saveConnectionSetup(.repair(id, choice: choice), key: key)
    }

    private func saveConnectionSetup(_ command: ConnectionSession.SetupCommand, key: String?) async throws {
        guard configurationLoaded, let store = configurationStore else {
            throw EZError("Configuration is unavailable. Reload saved settings first.")
        }
        try await session.save(
            command, key: key, directory: directory, blocked: busy || launcherPending,
            readLatest: readCurrentConfiguration,
            commit: { try self.persistConfiguration($0, store: store) })
        if !quitting && sharedCredentialsConnected { initializeStarterPreset() }
    }

    func discardConnectionSetup(_ id: UUID, phase: ConnectionSetup.Phase) throws {
        guard !credentialBusy, !quitting else { throw EZError("Wait for connection setup to finish.") }
        try session.discardSetup(id, phase: phase, in: directory)
    }

    private func readCurrentConfiguration() throws -> Configuration {
        guard let store = configurationStore, let latest = try store.load() else {
            throw EZError("Configuration is unavailable. Reload saved settings first.")
        }
        if configuration != latest { configuration = latest }
        return latest
    }

    private func validateConnectionTarget(
        _ connection: ConnectionDefinition, in configuration: Configuration
    ) throws {
        guard configuration.connections.contains(connection) else {
            throw EZError("The connection changed. Reopen its settings and review the current connection.")
        }
    }

    func manageConnection(_ connection: ConnectionDefinition, _ change: ConnectionChange) throws {
        guard !configurationLocked else { throw EZError("Wait for the current operation.") }
        var updated = try readCurrentConfiguration()
        try validateConnectionTarget(connection, in: updated)
        try updated.changeConnection(connection.key, change)
        try saveConfiguration(updated)
    }

    func removeConnectionCredential(_ connection: ConnectionDefinition) async throws {
        guard !configurationLocked else { throw EZError("Wait for the current operation.") }
        try validateConnectionTarget(connection, in: readCurrentConfiguration())
        try await session.removeCredential(connection, blocked: busy || launcherPending)
        if !quitting && sharedCredentialsConnected { initializeStarterPreset() }
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

    func stop() {
        guard canStop else { return }
        if retryWork != nil {
            cancelRetryPreparation()
        } else {
            attemptExecution?.stop()
        }
    }

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
        entry.isRetryable && canStartLookup && !connecting && retryWork == nil
    }

    @discardableResult func retry(_ id: UUID) -> Task<Void, Never>? {
        guard let original = historyCollection.knownDetail(id), canRetry(original) else { return nil }
        retryFailure = nil
        refreshConfiguration()
        do {
            let route = try retryRoute(for: original)
            guard original.inputImage != nil else {
                try startLookup(
                    original.prepareRetry(connection: route.connection, image: nil), source: .retry(id))
                return nil
            }

            try route.requireSavedConnection(original.connectionSnapshot)
            let connection = route.connection
            retryPreparingID = id
            let task = Task { [weak self, readInputImage] in
                do {
                    let image: ImageAttachment?
                    if original.transientFailure {
                        image = original.inputImage
                    } else {
                        image = try await readInputImage(original)
                    }
                    try Task.checkCancellation()
                    let preparation = Task.detached {
                        try Task.checkCancellation()
                        return try original.prepareRetry(connection: connection, image: image)
                    }
                    let prepared = try await withTaskCancellationHandler {
                        try await preparation.value
                    } onCancel: {
                        preparation.cancel()
                    }
                    try Task.checkCancellation()
                    guard let self else { return }
                    clearRetryPreparation()
                    guard canRetry(original) else {
                        throw EZError("Retry could not start. Wait for current work to finish and try again.")
                    }
                    refreshConfiguration()
                    let current = try retryRoute(for: original)
                    try current.requireSavedConnection(connection)
                    try startLookup(prepared, source: .retry(id))
                } catch {
                    guard !Task.isCancelled, let self else { return }
                    cancelRetryPreparation()
                    retryFailure = RetryFailure(entryID: id, message: error.localizedDescription)
                }
            }
            retryWork = task
            return task
        } catch {
            retryFailure = RetryFailure(entryID: id, message: error.localizedDescription)
            return nil
        }
    }

    private func retryRoute(for entry: HistoryEntry) throws -> LookupRoute {
        guard configurationLoaded else {
            throw EZError(configurationError ?? "Configuration is unavailable. Open Settings.")
        }
        guard let preset = entry.presetSnapshot else {
            throw EZError("The original preset is unavailable. Review the request.")
        }
        let route = try resolveRoute(preset)
        if let issue = connectionIssue(for: preset) { throw EZError(issue) }
        return route
    }

    private func cancelRetryPreparation() {
        retryWork?.cancel()
        clearRetryPreparation()
    }

    private func clearRetryPreparation() {
        guard retryPreparingID != nil else { return }
        retryWork = nil
        retryPreparingID = nil
    }

    func newQuery() {
        guard !busy, !launcherPending else { return }
        let action = configuration.actions.first { $0.id == selectedActionID } ?? configuration.actions.first
        resetDraft(actionID: action?.id)
    }
    private func resetDraft(actionID: UUID?) {
        cancelRetryPreparation()
        cancelSavedImageRestore()
        draft.reset(actionID: actionID)
        inputImageError = nil
        selection = nil
        error = nil
    }
    func canReuse(_ entry: HistoryEntry) -> Bool {
        entry.sourceID == nil && !["pending", "unsaved"].contains(entry.status)
            && !quitting && !busy && !launcherPending
    }
    @discardableResult func reuse(_ entry: HistoryEntry) -> Task<Void, Never>? {
        if entry.sourceID != nil {
            error = "Open this saved request in Saul to run it again."
            return nil
        }
        guard canReuse(entry) else { return nil }
        if let library, !entry.transientFailure {
            let originalDraftRevision = draftRevision
            return Task { [weak self] in
                do {
                    guard let current = try await library.reader.get(entry.recordID)?.value, let self else {
                        self?.error = "The saved lookup is unavailable. Refresh History."
                        return
                    }
                    guard !Task.isCancelled, canReuse(current), selection == entry.id,
                        draftRevision == originalDraftRevision
                    else { return }
                    await reuseVisible(current)?.value
                } catch {
                    guard !Task.isCancelled else { return }
                    self?.error = error.localizedDescription
                }
            }
        }
        return reuseVisible(entry)
    }

    private func reuseVisible(_ entry: HistoryEntry) -> Task<Void, Never>? {
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
        cancelRetryPreparation()
        cancelSavedImageRestore()
        draft.reuse(saved)
        inputImageError = nil
        selection = nil
        guard saved.inputImage != nil else { return nil }

        let restoreAsSketch = usesSketch
        let task = Task { [weak self, readInputImage, saved] in
            do {
                let restored: ImageAttachment?
                if saved.transientFailure {
                    restored = saved.inputImage
                } else {
                    restored = try await readInputImage(saved)
                }
                guard let attachment = restored else {
                    throw EZError("The saved input image is unavailable.")
                }
                try Task.checkCancellation()
                let photo = restoreAsSketch ? try await SketchPhoto.prepareRestoration(attachment) : nil
                guard !Task.isCancelled, let self else { return }
                draft.restoreImage(attachment, sketchPhoto: photo)
                reuseImageWork = nil
            } catch {
                guard !Task.isCancelled, let self else { return }
                cancelSavedImageRestore(needsRecovery: true)
            }
        }
        reuseImageWork = task
        return task
    }

    private func cancelSavedImageRestore(needsRecovery: Bool = false) {
        if let reuseImageWork {
            reuseImageWork.cancel()
            self.reuseImageWork = nil
            needsSavedImageRecovery = needsRecovery
            if needsRecovery {
                inputImageError =
                    currentAction?.imageInput != nil
                    ? "The saved input image is unavailable. Attach it again."
                    : "The saved input image is unavailable."
            }
        } else if !needsRecovery {
            needsSavedImageRecovery = false
        }
    }

    func continueWithoutSavedImage() {
        guard canContinueWithoutSavedImage else { return }
        cancelSavedImageRestore()
        inputImageError = nil
    }

    /// Cancels producers immediately and leaves any decided storage outcome to settle.
    @discardableResult func shutdown() -> Bool {
        if !quitting {
            quitting = true
            launcherWork?.cancel()
            launcherWork = nil
            session.close()
            historyCollection.cancelRead()
            historyCollection.image.close()
            cancelRetryPreparation()
            cancelSavedImageRestore()
            attemptExecution?.beginShutdown()
        }
        return busy || historyCollection.settling
    }

    func waitForPersistence() async {
        await attemptExecution?.waitForSettlement()
        await historyCollection.waitForSettlement()
    }

    func isTransientFailure(_ entry: HistoryEntry) -> Bool {
        historyCollection.isTransientFailure(entry.recordID)
    }

    func canStopAndDeleteLookup(_ id: HistoryStore.RecordID) -> Bool {
        guard canStop, let active = runningAttempt?.entry else { return false }
        if active.recordID == id { return true }
        guard case .native(let uuid) = id else { return false }
        return active.admissionSourceID == uuid.uuidString.lowercased()
    }

    @discardableResult func stopAndDeleteLookup(_ id: HistoryStore.RecordID) -> Task<Void, Never>? {
        guard canStopAndDeleteLookup(id) else { return nil }
        attemptExecution?.stop()
        return Task { [weak self] in
            guard let self else { return }
            await attemptExecution?.waitForSettlement()
            await deleteLookup(id)?.value
        }
    }

    func canDeleteLookup(_ id: HistoryStore.RecordID) -> Bool {
        !quitting && !busy && !launcherPending && historyCollection.ready && lock != nil
            && historyCollection.deleting == nil && !historyCollection.isTransientFailure(id)
    }
    @discardableResult func deleteLookup(
        _ id: HistoryStore.RecordID, expectedRevision: Int64? = nil
    ) -> Task<Void, Never>? {
        guard canDeleteLookup(id),
            let entry = entries.first(where: { $0.recordID == id })
                ?? selectedEntry.flatMap({ $0.recordID == id ? HistoryRow($0) : nil })
        else { return nil }
        let revision = expectedRevision ?? entry.revision
        return historyCollection.remove(
            id, settledPending: entry.status == "unsaved", expectedRevision: revision
        ) {
            [weak self] result in
            guard let self else { return }
            switch result {
            case .success:
                followUpDrafts[entry.id] = nil
                if selection == entry.id { selection = nil }
                if retryPreparingID == entry.id { cancelRetryPreparation() }
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
        case .discarded(let failed):
            if selection != failed.id { error = failed.error }
            historyCollection.discardFailed(failed)
            runningAttempt = nil
        case .discardFailed(let failed, let message):
            receiveStorageFailure(failed, message: "Could not remove the pending lookup. \(message)")
        case .saveFailed(let unsaved, let message):
            receiveStorageFailure(unsaved, message: "Could not save this lookup. \(message)")
        }
    }

    private func receiveStorageFailure(_ entry: HistoryEntry, message: String) {
        var unsaved = entry
        unsaved.status = "unsaved"
        unsaved.inputImage?.data = nil
        unsaved.error = entry.error.map { "\($0)\n\(message)" } ?? message
        if selection != entry.id { error = message }
        receiveTerminal(unsaved)
    }

    private func receiveTerminal(_ entry: HistoryEntry) {
        historyCollection.record(entry, active: false)
        runningAttempt = nil
    }
}

extension AppModel {
    var canEditSketch: Bool { usesSketch && !busy && !launcherPending }

    func beginSketchEdit() {
        cancelRetryPreparation()
        cancelSavedImageRestore(needsRecovery: true)
    }

    func commitSketch(_ scene: SketchScene) { updateSketch { $0.commit(scene) } }
    func undoSketch() { updateSketch { $0.undo() } }
    func redoSketch() { updateSketch { $0.redo() } }

    func setImageInput(_ attachment: ImageAttachment) throws {
        guard !busy, !launcherPending, currentAction?.imageInput != nil else { return }
        cancelRetryPreparation()
        try draft.attach(attachment, asSketch: usesSketch)
        cancelSavedImageRestore()
        inputImageError = nil
    }

    private func clearImageInput() {
        cancelSavedImageRestore()
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

    @discardableResult func beginImageImport() -> UUID {
        cancelRetryPreparation()
        cancelSavedImageRestore(needsRecovery: true)
        return draft.beginImageImport()
    }

    func finishImageImport(_ id: UUID, apply: () -> Void) {
        guard draft.acceptsImageImport(id), !busy, !launcherPending, currentAction?.imageInput != nil
        else { return }
        apply()
    }

    private func updateSketch(_ update: (inout SketchDraft) -> Void) {
        guard canEditSketch else { return }
        let previous = draft.sketch.scene
        draft.updateSketch(update)
        if draft.sketch.scene != previous {
            cancelRetryPreparation()
            cancelSavedImageRestore()
            inputImageError = nil
        }
    }
}
