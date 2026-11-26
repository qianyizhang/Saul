import AppKit
import Combine
import EZCore
import SaulNativeValues

@MainActor final class LookupSession: ObservableObject {
    struct Environment {
        var configuration = Configuration()
        var configurationLoaded = false
        var configurationError: String?
        var storageWarning: String?
        var settingsVisible = false
        var hasStorage = false
        var quitting = false
        var error: String?

    }

    struct Application {
        let read: @MainActor () -> Environment
        let refreshConfiguration: @MainActor () -> Void
        let focusConnection: @MainActor (ConnectionDefinition?) -> Void
        let setError: @MainActor (String?) -> Void
    }

    private let application: Application
    private let historyCollection: HistoryCollection
    let connections: ConnectionSession
    private let attemptExecution: AttemptExecution?
    private let readSavedEntry: (@MainActor (HistoryStore.RecordID) async throws -> HistoryEntry?)?
    private let attemptChange = PassthroughSubject<AttemptExecution.Progress?, Never>()
    var attemptChanges: AnyPublisher<AttemptExecution.Progress?, Never> {
        attemptChange.eraseToAnyPublisher()
    }

    init(
        history: HistoryCollection, connections: ConnectionSession, execution: AttemptExecution?,
        readInputImage: @escaping @MainActor (HistoryEntry) async throws -> ImageAttachment?,
        readSavedEntry: (@MainActor (HistoryStore.RecordID) async throws -> HistoryEntry?)?,
        application: Application
    ) {
        self.historyCollection = history
        self.connections = connections
        self.attemptExecution = execution
        self.readInputImage = readInputImage
        self.readSavedEntry = readSavedEntry
        self.application = application
        execution?.onChange = { [weak self] update in self?.receiveAttempt(update) }
    }

    private var environment: Environment { application.read() }
    var configuration: Configuration { environment.configuration }
    private var configurationLoaded: Bool { environment.configurationLoaded }
    private var configurationError: String? { environment.configurationError }
    private var storageWarning: String? { environment.storageWarning }
    private var showSettings: Bool { environment.settingsVisible }
    private var quitting: Bool { environment.quitting }
    private var error: String? {
        get { environment.error }
        set { application.setError(newValue) }
    }
    var credentialBusy: Bool { connections.operation != nil }
    private var connecting: Bool { connections.connecting }
    private func refreshConfiguration() { application.refreshConfiguration() }
    private func refreshActiveConnection(preferred: ConnectionDefinition?) {
        application.focusConnection(preferred)
    }

    func initializeDraft(actionID: UUID?) { draft.reset(actionID: actionID) }

    func reconcileDraft() {
        if replayEntry == nil && !configuration.actions.contains(where: { $0.id == selectedActionID }) {
            resetDraft(actionID: configuration.actions.first?.id)
        } else {
            draft.retainFields(inputFields)
            if currentAction?.imageInput == nil { clearImageInput() }
        }
    }

    func preset(in configuration: Configuration) -> ModelPreset? { draft.preset(in: configuration) }

    func beginShutdown() {
        launcherWork?.cancel()
        launcherWork = nil
        cancelRetryPreparation()
        cancelSavedImageRestore()
        attemptExecution?.beginShutdown()
    }

    func waitForPersistence() async { await attemptExecution?.waitForSettlement() }

    func historyDeleted(_ id: UUID) {
        followUpDrafts[id] = nil
        if selection == id { selection = nil }
        if retryPreparingID == id { cancelRetryPreparation() }
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
    @Published var followUpDrafts: [UUID: String] = [:]
    @Published var followUpTargetID: UUID?
    var runningAttempt: AttemptExecution.Progress? { attemptExecution?.progress }
    var busy: Bool { runningAttempt != nil }
    var canStop: Bool {
        !quitting
            && (retryWork != nil
                || runningAttempt.map { $0.phase == .preparing || $0.phase == .generating } == true)
    }
    var preparingAttempt: Bool { runningAttempt?.phase == .preparing }
    var savingAttempt: Bool { runningAttempt?.phase == .saving }
    var discardingAttempt: Bool { runningAttempt?.phase == .discarding }
    @Published private var launcherWork: Task<Void, Never>?
    var launcherPending: Bool { launcherWork != nil }
    private let readInputImage: @MainActor (HistoryEntry) async throws -> ImageAttachment?
    private enum Submission {
        case lookup
        case retry(UUID)
        case followUp(UUID)
    }
    private var submitting: (id: UUID, previousSelection: UUID?, source: Submission)?
    var selection: UUID? {
        get { historyCollection.selectedID }
        set {
            if newValue != selection {
                showsMainComposer = false
                cancelRetryPreparation()
                cancelSavedImageRestore(needsRecovery: true)
            }
            historyCollection.select(newValue)
        }
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
    private var canStartLookup: Bool {
        attemptExecution != nil && historyCollection.ready && environment.hasStorage
            && historyCollection.deleting == nil
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
        if let readSavedEntry, !entry.transientFailure {
            let originalDraftRevision = draftRevision
            return Task { [weak self] in
                do {
                    guard let current = try await readSavedEntry(entry.recordID), let self else {
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

    private func receiveAttempt(_ update: AttemptExecution.Update) {
        defer {
            objectWillChange.send()
            attemptChange.send(runningAttempt)
        }
        switch update {
        case .running(let progress):

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

        case .saved(let saved):
            receiveTerminal(saved)
        case .discarded(let failed):
            if selection != failed.id { error = failed.error }
            historyCollection.discardFailed(failed)

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

    }
}

extension LookupSession {
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
