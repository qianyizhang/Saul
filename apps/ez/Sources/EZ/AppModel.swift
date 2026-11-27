import AppKit
import Combine
import EZCore
import SaulCredentialClient
import SaulNativeValues

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

@MainActor final class AppModel: ObservableObject {
    private final class LookupApplication {
        weak var model: AppModel?
    }

    @Published var settingsSection: SettingsSection = .overview
    @Published var settingsPresetID: UUID?
    @Published private(set) var configuration = Configuration() {
        didSet {
            lookup.objectWillChange.send()
            connectionChecks.reconcile(configuration.connections)
            if configuration.connections != oldValue.connections
                || lookup.preset(in: oldValue)?.connectionKey != lookup.currentPreset?.connectionKey
            {
                refreshActiveConnection(preferred: lookup.currentConnection)
            }
        }
    }
    @Published var configurationError: String? {
        didSet { lookup.objectWillChange.send() }
    }
    let session: ConnectionSession
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
    private var selectedHistoryConnectionKey: String?
    var imageLoading: Bool { historyCollection.image.isLoading }
    func imageData(for entry: HistoryEntry) -> Data? { historyCollection.image.data(for: entry) }
    func waitForSelectedImage() async { await historyCollection.image.wait() }
    @Published var search = "" {
        didSet { if search != oldValue { refreshHistory() } }
    }
    var connecting: Bool { session.connecting }
    var profiles: [SaulAccount] { session.profiles }
    var signingIn: Bool { session.operation == .signIn }
    var credentialBusy: Bool { session.operation != nil }
    private(set) var quitting = false {
        didSet { lookup.objectWillChange.send() }
    }
    @Published var error: String? {
        didSet { lookup.objectWillChange.send() }
    }
    @Published var storageWarning: String? {
        didSet { lookup.objectWillChange.send() }
    }
    var sharedCredentialsConnected: Bool { session.connected }
    @Published var showSettings = false {
        didSet { lookup.objectWillChange.send() }
    }
    @Published var minimumMode: Bool {
        didSet { setMinimumMode(minimumMode) }
    }
    private let setMinimumMode: @MainActor (Bool) -> Void
    @Published private(set) var shortcuts = LookupShortcuts()
    @Published var shortcutSettingsError: String?
    private var shortcutsLoaded = false
    let directory: URL
    private let historyURL: URL
    let lookup: LookupSession
    let allowsExternalServices: Bool
    let speak: (@MainActor (ModelPreset, String) async throws -> Data)?
    private let historyCollection: HistoryCollection
    private var lookupObservation: AnyCancellable?
    let library: LibraryMaintenance?
    var canMaintainLibrary: Bool {
        !quitting && !lookup.busy && !lookup.launcherPending && historyCollection.ready && lock != nil
    }
    private var lock: SessionLock?
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
        self.minimumMode = minimumMode
        self.setMinimumMode = setMinimumMode
        self.directory = directory
        historyURL = HistoryStore.databaseURL(in: historyDirectory)
        historyCollection = HistoryCollection(
            read: readHistory, count: countHistory, entry: readHistoryEntry,
            readImage: readOutputImage, delete: deleteHistory)
        let application = LookupApplication()
        lookup = LookupSession(
            history: historyCollection, connections: session, execution: attemptExecution,
            readInputImage: readInputImage,
            readSavedEntry: library.map { library in
                { try await library.reader.get($0)?.value }
            },
            application: .init(
                read: { application.model?.lookupEnvironment ?? .init() },
                refreshConfiguration: { application.model?.refreshConfiguration() },
                focusConnection: { application.model?.refreshActiveConnection(preferred: $0) },
                setError: { application.model?.error = $0 }))
        application.model = self
        lookupObservation = lookup.objectWillChange.sink { [weak self] in self?.objectWillChange.send() }
        historyCollection.onChange = { [weak self] in
            guard let self else { return }
            lookup.objectWillChange.send()
            // Selection can precede hydration. Only change focus when the
            // selected detail reveals a different saved connection.
            let key = lookup.selectedEntry?.presetSnapshot?.connectionKey
            if selectedHistoryConnectionKey != key {
                selectedHistoryConnectionKey = key
                refreshActiveConnection()
            }
        }
        historyCollection.onMissingSelection = { [weak self] in self?.lookup.selection = nil }
        session.onChange = { [weak self] in self?.connectionChanged() }
        connectionChecks.onChange = { [weak self] in self?.connectionChanged() }
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
                lookup.initializeDraft(actionID: configuration.actions.first?.id)
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
    }

    private var lookupEnvironment: LookupSession.Environment {
        .init(
            configuration: configuration, configurationLoaded: configurationLoaded,
            configurationError: configurationError, storageWarning: storageWarning,
            settingsVisible: showSettings, hasStorage: lock != nil, quitting: quitting,
            error: error)
    }

    private func connectionChanged() {
        lookup.objectWillChange.send()
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

    func openSettings(_ section: SettingsSection = .overview) {
        if !showSettings { refreshConfiguration() }
        settingsSection = section
        showSettings = true
    }
    var configurationLocked: Bool {
        lookup.busy || lookup.launcherPending || credentialBusy || !configurationLoaded
    }
    var filteredEntries: [HistoryRow] { entries }
    @discardableResult func loadMoreHistory() -> Task<Void, Never>? {
        guard !quitting else { return nil }
        return historyCollection.more { [weak self] result in
            if case .failure(let error) = result { self?.storageWarning = error.localizedDescription }
        }
    }
    func waitForHistorySelection() async { await historyCollection.waitForSelection() }
    func reloadHistorySelection() { historyCollection.select(lookup.selection, force: true) }

    func connect(loadAccounts: Bool = false) async {
        guard !quitting, !lookup.busy, lock != nil else { return }
        await session.connect {
            error = nil
            if let connection = lookup.currentConnection { await refreshConnection(connection) }
            guard loadAccounts else { return }
            do { try await session.loadAccounts() } catch {
                if !quitting && !Task.isCancelled { self.error = error.localizedDescription }
            }
        }
    }

    func connectCredentials() async {
        guard allowsExternalServices, !quitting, !lookup.busy, !credentialBusy, !lookup.launcherPending else {
            return
        }
        session.setConnected(true)
        await connect(loadAccounts: true)
    }

    func disconnectCredentials() {
        guard allowsExternalServices, !quitting, !lookup.busy, !connecting, !credentialBusy,
            !lookup.launcherPending
        else {
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
            connections: latest.connections, blocked: lookup.busy || lookup.launcherPending)
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
    func saveConfiguration(_ updated: Configuration) throws {
        guard !configurationLocked, let store = configurationStore else {
            throw EZError(
                "Configuration cannot be changed while a request is active or storage is unavailable.")
        }
        try persistConfiguration(updated, store: store)
    }

    private func persistConfiguration(
        _ updated: Configuration, store: ConfigurationStore, fence: ConnectionFence? = nil
    ) throws {
        var saved = updated
        if let id = saved.unassignedStarterID,
            !saved.presets.contains(where: { $0.id == id && $0.model.isEmpty })
        {
            saved.unassignedStarterID = nil
        }
        configuration = try store.save(saved, fence: fence)
        configurationError = nil
        lookup.reconcileDraft()
    }
    func saveConnection(
        _ connection: ConnectionDefinition, previous: ConnectionDefinition?, key: String? = nil,
        confirmedAppName: String? = nil
    ) async throws {
        try await saveConnectionSetup(
            .start(connection, previous: previous, confirmedName: confirmedAppName), key: key)
    }

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
            command, key: key, directory: directory, blocked: lookup.busy || lookup.launcherPending,
            readLatest: readCurrentConfiguration,
            commit: { try self.persistConfiguration($0, store: store, fence: $1) })
        if !quitting && sharedCredentialsConnected { initializeStarterPreset() }
    }

    func discardConnectionSetup(_ id: UUID, phase: ConnectionSetup.Phase) async throws {
        guard !credentialBusy, !quitting else { throw EZError("Wait for connection setup to finish.") }
        try await session.discardSetup(id, phase: phase, in: directory)
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
        try await session.removeCredential(connection, blocked: lookup.busy || lookup.launcherPending)
        if !quitting && sharedCredentialsConnected { initializeStarterPreset() }
    }

    func refreshConfiguration() {
        guard !lookup.busy, !lookup.launcherPending, !credentialBusy, let store = configurationStore else {
            return
        }
        do {
            if let saved = try store.load() { configuration = saved }
            configurationLoaded = true
            configurationError = nil
        } catch {
            configurationLoaded = false
            configurationError = "Shared presets could not be loaded. \(error.localizedDescription)"
        }
    }
    /// Cancels producers immediately and leaves any decided storage outcome to settle.
    @discardableResult func shutdown() -> Bool {
        if !quitting {
            quitting = true
            session.close()
            historyCollection.cancelRead()
            historyCollection.image.close()
            lookup.beginShutdown()
        }
        return lookup.busy || historyCollection.settling
    }

    func waitForPersistence() async {
        await lookup.waitForPersistence()
        await historyCollection.waitForSettlement()
    }

    func isTransientFailure(_ entry: HistoryEntry) -> Bool {
        historyCollection.isTransientFailure(entry.recordID)
    }

    func canStopAndDeleteLookup(_ id: HistoryStore.RecordID) -> Bool {
        guard lookup.canStop, let active = lookup.runningAttempt?.entry else { return false }
        if active.recordID == id { return true }
        guard case .native(let uuid) = id else { return false }
        return active.admissionSourceID == uuid.uuidString.lowercased()
    }

    @discardableResult func stopAndDeleteLookup(_ id: HistoryStore.RecordID) -> Task<Void, Never>? {
        guard canStopAndDeleteLookup(id) else { return nil }
        lookup.stop()
        return Task { [weak self] in
            guard let self else { return }
            await lookup.waitForPersistence()
            await deleteLookup(id)?.value
        }
    }

    func canDeleteLookup(_ id: HistoryStore.RecordID) -> Bool {
        !quitting && !lookup.busy && !lookup.launcherPending && historyCollection.ready && lock != nil
            && historyCollection.deleting == nil && !historyCollection.isTransientFailure(id)
    }
    @discardableResult func deleteLookup(
        _ id: HistoryStore.RecordID, expectedRevision: Int64? = nil
    ) -> Task<Void, Never>? {
        guard canDeleteLookup(id),
            let entry = entries.first(where: { $0.recordID == id })
                ?? lookup.selectedEntry.flatMap({ $0.recordID == id ? HistoryRow($0) : nil })
        else { return nil }
        let revision = expectedRevision ?? entry.revision
        return historyCollection.remove(
            id, settledPending: entry.status == "unsaved", expectedRevision: revision
        ) {
            [weak self] result in
            guard let self else { return }
            switch result {
            case .success:
                lookup.historyDeleted(entry.id)
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
            historyCollection.ready ? historyURL : directory
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

}
