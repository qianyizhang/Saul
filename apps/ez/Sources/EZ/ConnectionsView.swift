import AppKit
import EZCore
import SaulCredentialClient
import SaulNativeValues
import SwiftUI

struct ConnectionsView: View {
    private struct Registration {
        let name: String
        var accountID: String?
        var confirmed = false
    }

    @ObservedObject var model: AppModel
    @Binding var hasUnsavedChanges: Bool
    let visible: Bool
    let otherDraftIsDirty: Bool
    @State private var editing = false
    @State private var target: ConnectionDefinition?
    @State private var management:
        (connection: ConnectionDefinition, action: ConnectionManagementView.Action)?
    @State private var kind = "plan"
    @State private var name = ""
    @State private var endpoint = "https://api.openai.com/v1"
    @State private var key = ""
    @State private var account = ""
    @State private var registration: Registration?
    @State private var newID = ""
    private var busy: Bool { model.credentialBusy }
    @State private var error: String?
    @State private var removing: ConnectionDefinition?
    @State private var loginTask: Task<Void, Never>?
    @State private var recoveryID: UUID?
    @State private var remoteSetups: [SharedConnectionSetup] = []
    @State private var releasing: SharedConnectionSetup?
    private var recovery: ConnectionSetup? {
        model.session.pendingSetups.first { $0.id == recoveryID } ?? model.pendingConnectionSetup
    }
    private var eligibleProfiles: [SaulAccount] {
        model.profiles.filter { profile in
            !model.configuration.connections.contains { $0.accountId == profile.id && $0.key != target?.key }
        }
    }
    private var selectedProfile: SaulAccount? { eligibleProfiles.first { $0.id == account } }
    private var planReady: Bool { selectedProfile?.signedIn == true && selectedProfile?.planEnabled == true }
    private var needsPlanPermission: Bool {
        selectedProfile?.signedIn == true && selectedProfile?.planEnabled == false
    }
    private var editorOpen: Bool { editing || management != nil }
    private var managementDisabled: Bool { model.configurationLocked || otherDraftIsDirty }
    private var defaultPlanName: String {
        ConnectionDefinition.nextName("ChatGPT plan", among: model.configuration.connections)
    }
    private func connectionName(_ key: String) -> String {
        model.configuration.connections.first { $0.key == key }?.name ?? key
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text("Connections").font(.headline)
                    Spacer()
                    if !editorOpen {
                        Menu("Add connection", systemImage: "plus") {
                            Button("ChatGPT plan") { open(nil, type: "plan") }
                            Button("OpenAI API") { open(nil, type: "api") }
                            Button("Custom endpoint") { open(nil, type: "custom") }
                        }
                        .disabled(
                            busy || loginTask != nil || model.configurationLocked
                                || !model.sharedCredentialsConnected
                                || model.configuration.connections.count >= 32)
                    }
                }
                if let error { Text(error).foregroundStyle(.red).textSelection(.enabled) }
                if loginTask != nil {
                    Button("Cancel sign-in") {
                        loginTask?.cancel()
                    }
                }
                if !editorOpen {
                    ForEach(remoteSetups.filter { $0.origin == "saul" }) { reservation in
                        HStack {
                            Text("Saul setup for \(connectionName(reservation.connectionKey))")
                            Spacer()
                            if reservation.active {
                                Button("Active in Saul · Check again") {
                                    Task { await refreshReservations() }
                                }
                            } else {
                                Button("Release setup") { releasing = reservation }
                                    .disabled(managementDisabled)
                            }
                        }
                    }
                    if let pending = recovery {
                        setupRecovery(pending)
                        ForEach(model.session.pendingSetups.filter { $0.id != pending.id }, id: \.id) {
                            record in
                            Button("Review setup for \(record.definition.name)") {
                                key = ""
                                recoveryID = record.id
                            }
                        }
                    }
                }
                if let management {
                    ConnectionManagementView(
                        action: management.action, connection: management.connection,
                        configuration: model.configuration,
                        disabled: managementDisabled,
                        commit: { try model.manageConnection(management.connection, $0) },
                        close: { self.management = nil },
                        openMove: { self.management = (management.connection, .move) }
                    ).id(management.action)
                } else if editing {
                    setupForm
                } else {
                    ForEach(model.configuration.connections) { connection in
                        connectionRow(connection)
                        Divider()
                    }
                }
            }.padding(24)
        }
        .task(id: visible) {
            guard visible else { return }
            await refreshReservations()
            for connection in model.configuration.connections {
                guard !Task.isCancelled else { return }
                await model.refreshConnection(connection)
            }
        }
        .onChange(of: recovery?.phase) { _, phase in
            if phase == .settings { key = "" }
        }
        .onChange(of: editorOpen, initial: true) { _, value in hasUnsavedChanges = value }
        .onDisappear {
            loginTask?.cancel()
            loginTask = nil
        }
        .confirmationDialog(
            releasing.map { "Release the setup for \(connectionName($0.connectionKey)) from Saul?" }
                ?? "Release setup from Saul?",
            isPresented: Binding(get: { releasing != nil }, set: { if !$0 { releasing = nil } }),
            titleVisibility: .visible,
            presenting: releasing
        ) { reservation in
            Button("Release setup") {
                Task {
                    do {
                        try await model.session.releaseSharedSetup(reservation)
                        await refreshReservations()
                    } catch { self.error = error.localizedDescription }
                }
            }
        } message: { _ in
            Text(
                "The credential may already have changed. Releasing keeps the current credential and saved connection."
            )
        }
        .confirmationDialog(
            "Disconnect this account or key in both Saul and EZ?",
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            titleVisibility: .visible
        ) {
            Button("Disconnect", role: .destructive) {
                guard let connection = removing else { return }
                removing = nil
                error = nil
                Task {
                    do { try await model.removeConnectionCredential(connection) } catch {
                        self.error = error.localizedDescription
                    }
                }
            }
        } message: {
            Text(
                "Presets keep this connection and show that setup is required. Other connections stay available."
            )
        }
    }
    private func refreshReservations() async {
        do {
            remoteSetups = try await model.session.sharedSetups()
        } catch {
            // The signed helper can be absent before the user opts in.
            remoteSetups = []
        }
    }

    private func setupRecovery(_ pending: ConnectionSetup) -> some View {
        let repair = model.session.repairChoice(for: pending.id)
        let requestingKey =
            pending.definition.kind == .openAIAPI && (pending.phase == .credential || repair == .replaceKey)
        return VStack(alignment: .leading, spacing: 8) {
            Text("Finish setting up \(pending.definition.name)").font(.headline)
            Text(pending.definition.accountId ?? pending.definition.endpoint).textSelection(.enabled)
            if pending.phase == .credential {
                Text("The credential change was not confirmed. Review before submitting it again.")
            } else if repair == nil {
                Text(
                    pending.definition.kind == .openAIAPI
                        ? "The helper accepted the key. Finish setup checks it and saves the connection."
                        : "The credential step finished. Finish setup checks plan access and saves the connection."
                )
            }
            if requestingKey { SecureField("API key", text: $key) }
            HStack {
                Button(pending.phase == .settings ? "Finish setup" : "Submit again") {
                    continueSetup(pending, requiresKey: pending.phase == .credential)
                }
                if let repair {
                    Button(repair.title) {
                        continueSetup(pending, requiresKey: requestingKey, repair: repair)
                    }
                }
                Button("Discard setup") {
                    Task {
                        do {
                            try await model.discardConnectionSetup(pending.id, phase: pending.phase)
                            closeEditor()
                        } catch { self.error = error.localizedDescription }
                    }
                }
            }
        }.disabled(managementDisabled || !model.sharedCredentialsConnected)
    }

    private func continueSetup(
        _ pending: ConnectionSetup, requiresKey: Bool, repair: ConnectionSession.SetupRepairChoice? = nil
    ) {
        let suppliedKey = requiresKey ? key : nil
        let signingIn = repair == .signIn || repair == .enablePlan
        error = nil
        let task = Task {
            defer { if signingIn { loginTask = nil } }
            do {
                if let repair {
                    try await model.repairConnectionSetup(pending.id, choice: repair, key: suppliedKey)
                } else {
                    try await model.resumeConnectionSetup(pending.id, phase: pending.phase, key: suppliedKey)
                }
                closeEditor()
            } catch {
                if !Task.isCancelled { self.error = error.localizedDescription }
            }
        }
        if signingIn { loginTask = task }
    }

    private func connectionRow(_ connection: ConnectionDefinition) -> some View {
        let presetCount = model.configuration.presets(using: connection.key).count
        let pending = model.session.pendingSetups.contains { $0.definition.key == connection.key }
        let status = model.connectionStatus(connection.key)
        let checking = model.checkingConnections.contains(connection.key)
        let checkingExplicitly = model.connectionChecks.isCheckingExplicitly(connection.key)
        let problem = model.connectionError(connection.key)
        let warning = model.connectionChecks.logoutWarning(for: connection)
        let connected = status?.connected == true
        let canCheck =
            model.allowsExternalServices
            && (connected
                || (status == nil && (connection.kind == .openAIAPI || connection.accountId != nil)))
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(connection.name).font(.headline)
                if !model.minimumMode {
                    Text(presetCount == 1 ? "1 preset" : "\(presetCount) presets")
                        .font(AppStyle.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Menu {
                    Button("Rename connection") { openManagement(.rename, for: connection) }
                        .disabled(managementDisabled)
                    if presetCount > 0 {
                        Button("Move presets") { openManagement(.move, for: connection) }
                            .disabled(managementDisabled)
                    }
                    Button(connection.kind == .chatGPTPlan ? "Sign in again" : "Replace key") {
                        open(connection)
                    }
                    if connection.kind == .chatGPTPlan {
                        Link("Usage", destination: URL(string: "https://chatgpt.com/settings/usage")!)
                    }
                    Button(connection.kind == .chatGPTPlan ? "Sign out" : "Remove key", role: .destructive) {
                        removing = connection
                    }
                    Button("Delete connection", role: .destructive) {
                        openManagement(.delete, for: connection)
                    }
                    .disabled(managementDisabled)
                } label: {
                    Image(systemName: "ellipsis").frame(width: 28, height: 24)
                }
                .menuStyle(.borderlessButton).fixedSize().accessibilityLabel("More for \(connection.name)")
                .disabled(busy || pending || model.configurationLocked)
            }
            HStack(spacing: 8) {
                ForEach(connection.capabilities, id: \.self) { capability in
                    Text(capability.name)
                        .font(AppStyle.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 5).padding(.vertical, 2)
                        .background(DesignTokens.subtle, in: RoundedRectangle(cornerRadius: 4))
                }
            }
            let accountIdentity = identity(connection, status: status)
            if accountIdentity != connection.name {
                Text(accountIdentity).font(AppStyle.caption).textSelection(.enabled)
            }
            HStack {
                if checking { ProgressView().controlSize(.small) }
                Text(
                    !model.sharedCredentialsConnected
                        ? "Helper disconnected"
                        : status?.signedIn == false
                            ? "Signed out"
                            : checking
                                ? "Checking…"
                                : problem != nil
                                    ? "Needs attention" : connected ? "✓ Connected" : "Not set up"
                )
                .font(.callout).foregroundStyle(problem != nil ? Color.red : .primary)
                Spacer()
                if !model.sharedCredentialsConnected {
                    Button("Open Integrations") { model.settingsSection = .preferences }
                } else if canCheck {
                    Button("Check") { Task { await model.refreshConnection(connection, intent: .check) } }
                        .disabled(checkingExplicitly || busy)
                } else {
                    Button(
                        connection.kind == .chatGPTPlan && connection.accountId != nil
                            ? "Sign in again" : "Set up"
                    ) {
                        open(connection)
                    }.disabled(busy)
                }
            }
            if let problem {
                Text(problem).font(AppStyle.caption).foregroundStyle(.red).textSelection(.enabled)
            }
            if let warning {
                Text(warning).font(AppStyle.caption).foregroundStyle(.orange).textSelection(.enabled)
            }
        }.padding(.vertical, 8)
    }
    private func openManagement(
        _ action: ConnectionManagementView.Action, for connection: ConnectionDefinition
    ) {
        error = nil
        management = (connection, action)
    }
    private func identity(_ connection: ConnectionDefinition, status: ConnectionStatus?) -> String {
        if connection.kind == .chatGPTPlan {
            return status?.identity
                ?? (connection.accountId == nil ? "No account selected" : "Loading account…")
        }
        return connection.endpoint + (status?.keySuffix.map { " · sk-***\($0)" } ?? "")
    }
    private func open(_ connection: ConnectionDefinition?, type: String = "plan") {
        if let pending = model.session.pendingSetups.first(where: { $0.definition.key == connection?.key }) {
            recoveryID = pending.id
            return
        }
        target = connection
        editing = true
        key = ""
        error = nil
        name = connection?.name ?? ""
        account = connection?.accountId ?? ""
        registration = nil
        endpoint = connection?.endpoint ?? "https://api.openai.com/v1"
        kind =
            connection?.kind == .openAIAPI
            ? (endpoint == "https://api.openai.com/v1" ? "api" : "custom") : type
        newID = "connection-" + UUID().uuidString.lowercased()
        guard kind == "plan", model.allowsExternalServices else { return }
        Task {
            do {
                try await model.loadConnectionAccounts()
            } catch { self.error = error.localizedDescription }
        }
    }
    private var setupForm: some View {
        VStack(alignment: .leading, spacing: 16) {
            if kind == "plan" {
                if let registration, registration.accountID == nil {
                    registrationForm(registration.name)
                } else {
                    planForm
                }
            } else {
                Text(
                    target.map { "Set up \($0.name)" }
                        ?? (kind == "api" ? "Add OpenAI API" : "Add custom endpoint")
                )
                .font(.headline)
                if target == nil { connectionNameField }
                if kind == "custom" {
                    Text("Endpoint").font(AppStyle.caption)
                    TextField("https://example.com/v1", text: $endpoint).textFieldStyle(.roundedBorder)
                        .disabled(target?.baseUrl != nil)
                }
                Text("API key").font(AppStyle.caption)
                SecureField(kind == "custom" ? "Optional for localhost" : "API key", text: $key)
                    .textFieldStyle(.roundedBorder)
                Text(
                    kind == "api"
                        ? "OpenAI API billing is separate from your ChatGPT plan."
                        : "Uses this endpoint's billing. Keys stay bound to this endpoint."
                )
                .font(AppStyle.caption).foregroundStyle(.secondary)
                HStack {
                    Button("Save connection") { save() }.buttonStyle(.borderedProminent)
                    Button("Cancel") { closeEditor() }
                }
            }
            if loginTask != nil { ProgressView("Waiting for ChatGPT…").controlSize(.small) }
        }
        .frame(maxWidth: 480, alignment: .leading)
        .disabled(busy || loginTask != nil || model.configurationLocked)
    }

    private var connectionNameField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Connection name").font(AppStyle.caption)
            TextField("Connection name", text: $name, prompt: Text(kind == "plan" ? defaultPlanName : "Name"))
                .textFieldStyle(.roundedBorder)
        }
    }

    private var planForm: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(
                registration?.accountID != nil
                    ? "Finish ChatGPT setup" : (target.map { "Set up \($0.name)" } ?? "Add ChatGPT plan")
            ).font(.headline)
            if target?.accountId != nil || registration?.accountID != nil {
                LabeledContent("Account", value: selectedProfile?.label ?? "Loading…")
            } else {
                Picker(
                    "Saved account",
                    selection: Binding(
                        get: { account },
                        set: { id in
                            account = id
                            if registration?.accountID != id { registration = nil }
                            error = nil
                        }
                    )
                ) {
                    Text("Choose an account").tag("")
                    ForEach(
                        eligibleProfiles
                    ) { profile in Text(profile.label).tag(profile.id) }
                }
            }
            if target?.accountId == nil && planReady {
                if let name = registration?.name {
                    Toggle(
                        "I used \(name) in ChatGPT",
                        isOn: Binding(
                            get: { registration?.confirmed ?? false },
                            set: { registration?.confirmed = $0 }
                        ))
                }
                if target == nil { connectionNameField }
            }
            HStack {
                if target?.accountId == nil && planReady {
                    Button("Save connection") { save() }.buttonStyle(.borderedProminent)
                } else if selectedProfile != nil || target?.accountId != nil {
                    Button(needsPlanPermission ? "Enable plan use" : "Sign in again") { signIn() }
                        .buttonStyle(.borderedProminent)
                        .disabled(!model.allowsExternalServices)
                }
                Button("Cancel") { closeEditor() }
            }
            if target?.accountId == nil && registration == nil {
                Divider()
                Button("Register a new app") {
                    let suffix = UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(12)
                    registration = Registration(name: "Saul \(suffix)")
                    error = nil
                }.disabled(!model.allowsExternalServices)
            }
        }
    }

    private func registrationForm(_ name: String) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Register with ChatGPT").font(.headline)
            VStack(alignment: .leading, spacing: 8) {
                Text("Name to paste in ChatGPT").font(AppStyle.caption).foregroundStyle(.secondary)
                Text(name).font(.body.monospaced()).textSelection(.enabled)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(DesignTokens.subtle, in: RoundedRectangle(cornerRadius: 8))
            Text("ChatGPT starts with Saul. Replace it with the copied name before you approve.")
                .font(.callout).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                Button("Copy name and open ChatGPT") {
                    guard TextClipboard.write(name) else {
                        error = "Could not copy the app name. Try again."
                        return
                    }
                    signIn(suggestedAppName: name)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!model.allowsExternalServices)
                Button("Back") {
                    registration = nil
                    error = nil
                }
            }
        }
    }

    private func closeEditor() {
        editing = false
        registration = nil
        key = ""
        error = nil
    }

    private func signIn(suggestedAppName: String? = nil) {
        error = nil
        let consent = suggestedAppName == nil && needsPlanPermission
        let previous = target
        let accountID = previous?.accountId ?? account
        loginTask = Task {
            defer { loginTask = nil }
            do {
                guard
                    let id = try await model.signInConnection(
                        accountID: accountID, previous: previous, suggestedAppName: suggestedAppName,
                        consent: consent)
                else { return }
                if let suggestedAppName {
                    registration = Registration(name: suggestedAppName, accountID: id)
                }
                account = id
                if let target, target.accountId != nil, planReady {
                    closeEditor()
                    await model.refreshConnection(target)
                } else if !planReady {
                    error = "ChatGPT plan use is still disabled for this account."
                }
            } catch {
                if suggestedAppName != nil { registration = nil }
                if !Task.isCancelled {
                    self.error = error.localizedDescription
                    try? await model.loadConnectionAccounts()
                }
            }
        }
    }

    private func save() {
        error = nil
        let previous = target
        let suppliedKey = kind == "plan" ? nil : key
        let confirmedName = registration?.confirmed == true ? registration?.name : nil
        let definition: ConnectionDefinition
        if kind == "plan" {
            guard let profile = selectedProfile, profile.signedIn, profile.planEnabled else {
                error = "Sign in and allow plan use before saving this connection."
                return
            }
            let enteredName = name.trimmingCharacters(in: .whitespacesAndNewlines)
            definition = ConnectionDefinition(
                key: previous?.key ?? newID,
                name: previous?.name ?? (enteredName.isEmpty ? defaultPlanName : enteredName),
                kind: .chatGPTPlan, accountId: profile.id)
        } else {
            definition = ConnectionDefinition(
                key: previous?.key ?? newID, name: previous?.name ?? name,
                kind: .openAIAPI,
                baseUrl: kind == "api"
                    ? "https://api.openai.com/v1"
                    : endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
        }
        Task {
            do {
                try await model.saveConnection(
                    definition, previous: previous, key: suppliedKey, confirmedAppName: confirmedName)
                closeEditor()
            } catch {
                if let pending = model.session.pendingSetups.first(where: {
                    $0.definition.key == definition.key
                }) {
                    closeEditor()
                    recoveryID = pending.id
                }
                self.error = error.localizedDescription
            }
        }
    }
}
