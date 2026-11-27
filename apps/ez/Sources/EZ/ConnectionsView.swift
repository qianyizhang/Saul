import AppKit
import SaulNativeValues
import SwiftUI

struct ConnectionsView: View {
    @ObservedObject var model: AppModel
    @Binding var hasUnsavedChanges: Bool
    let visible: Bool
    let otherDraftIsDirty: Bool
    @StateObject private var editor = ConnectionEditor()
    @State private var management:
        (connection: ConnectionDefinition, action: ConnectionManagementView.Action)?
    private var busy: Bool { model.credentialBusy }
    @State private var removing: ConnectionDefinition?
    @State private var remoteSetups: [SharedConnectionSetup] = []
    @State private var releasing: SharedConnectionSetup?
    private var recovery: ConnectionSetup? {
        editor.recovery(in: model.session.pendingSetups)
    }
    private var editorOpen: Bool { editor.isOpen || management != nil }
    private var managementDisabled: Bool { model.configurationLocked || otherDraftIsDirty }
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
                            Button("ChatGPT plan") { editor.open(nil, using: model) }
                            Button("OpenAI API") { editor.open(nil, kind: .openAIAPI, using: model) }
                            Button("Custom endpoint") {
                                editor.open(nil, kind: .customEndpoint, using: model)
                            }
                        }
                        .disabled(
                            busy || editor.isSigningIn || model.configurationLocked
                                || !model.sharedCredentialsConnected
                                || model.configuration.connections.count >= 32)
                    }
                }
                if let error = editor.error { Text(error).foregroundStyle(.red).textSelection(.enabled) }
                if editor.isSigningIn {
                    Button("Cancel sign-in") { editor.cancelSignIn() }
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
                                editor.review(record)
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
                } else if let draft = editor.draft {
                    setupForm(draft)
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
        .onChange(of: model.session.pendingSetups) { previous, current in
            editor.setupsChanged(from: previous, to: current)
        }
        .onChange(of: editorOpen, initial: true) { _, value in hasUnsavedChanges = value }
        .onDisappear { editor.close() }
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
                    } catch { editor.error = error.localizedDescription }
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
                editor.error = nil
                Task {
                    do { try await model.removeConnectionCredential(connection) } catch {
                        editor.error = error.localizedDescription
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
            if requestingKey { SecureField("API key", text: $editor.recoveryKey) }
            HStack {
                Button(pending.phase == .settings ? "Finish setup" : "Submit again") {
                    editor.continueSetup(
                        pending, requiresKey: pending.phase == .credential, repair: nil, using: model)
                }
                if let repair {
                    Button(repair.title) {
                        editor.continueSetup(
                            pending, requiresKey: requestingKey, repair: repair, using: model)
                    }
                }
                Button("Discard setup") {
                    Task {
                        do {
                            try await model.discardConnectionSetup(pending.id, phase: pending.phase)
                            editor.close()
                        } catch { editor.error = error.localizedDescription }
                    }
                }
            }
        }.disabled(managementDisabled || !model.sharedCredentialsConnected)
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
                        editor.open(connection, using: model)
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
                        editor.open(connection, using: model)
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
        editor.error = nil
        management = (connection, action)
    }
    private func identity(_ connection: ConnectionDefinition, status: ConnectionStatus?) -> String {
        if connection.kind == .chatGPTPlan {
            return status?.identity
                ?? (connection.accountId == nil ? "No account selected" : "Loading account…")
        }
        return connection.endpoint + (status?.keySuffix.map { " · sk-***\($0)" } ?? "")
    }
    private func setupForm(_ draft: ConnectionEditor.Draft) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            if draft.kind == .plan {
                if let registration = draft.registration, registration.accountID == nil {
                    registrationForm(registration.name)
                } else {
                    planForm(draft)
                }
            } else {
                Text(
                    draft.target.map { "Set up \($0.name)" }
                        ?? (draft.kind == .openAIAPI ? "Add OpenAI API" : "Add custom endpoint")
                )
                .font(.headline)
                if draft.target == nil { connectionNameField(draft.kind) }
                if draft.kind == .customEndpoint {
                    Text("Endpoint").font(AppStyle.caption)
                    TextField("https://example.com/v1", text: $editor.endpoint).textFieldStyle(.roundedBorder)
                        .disabled(draft.target?.baseUrl != nil)
                }
                Text("API key").font(AppStyle.caption)
                SecureField(
                    draft.kind == .customEndpoint ? "Optional for localhost" : "API key", text: $editor.key
                )
                .textFieldStyle(.roundedBorder)
                Text(
                    draft.kind == .openAIAPI
                        ? "OpenAI API billing is separate from your ChatGPT plan."
                        : "Uses this endpoint's billing. Keys stay bound to this endpoint."
                )
                .font(AppStyle.caption).foregroundStyle(.secondary)
                HStack {
                    saveButton
                    Button("Cancel") { editor.close() }
                }
            }
            if editor.isSigningIn { ProgressView("Waiting for ChatGPT…").controlSize(.small) }
        }
        .frame(maxWidth: 480, alignment: .leading)
        .disabled(busy || editor.isSigningIn || model.configurationLocked)
    }

    private func connectionNameField(_ kind: ConnectionEditor.Kind) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Connection name").font(AppStyle.caption)
            TextField(
                "Connection name", text: $editor.name,
                prompt: Text(kind == .plan ? editor.defaultPlanName(in: model) : "Name")
            )
            .textFieldStyle(.roundedBorder)
        }
    }

    private func planForm(_ draft: ConnectionEditor.Draft) -> some View {
        let target = draft.target
        let registration = draft.registration
        let profiles = editor.eligibleProfiles(in: model)
        let selectedProfile = profiles.first { $0.id == draft.accountID }
        let planReady = selectedProfile?.signedIn == true && selectedProfile?.planEnabled == true
        let needsPlanPermission = selectedProfile?.signedIn == true && selectedProfile?.planEnabled == false
        return VStack(alignment: .leading, spacing: 16) {
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
                        get: { editor.draft?.accountID ?? "" },
                        set: { editor.selectAccount($0) }
                    )
                ) {
                    Text("Choose an account").tag("")
                    ForEach(profiles) { profile in Text(profile.label).tag(profile.id) }
                }
            }
            if target?.accountId == nil && planReady {
                if let name = registration?.name {
                    Toggle("I used \(name) in ChatGPT", isOn: $editor.registrationConfirmed)
                }
                if target == nil { connectionNameField(draft.kind) }
            }
            HStack {
                if target?.accountId == nil && planReady {
                    saveButton
                } else if selectedProfile != nil || target?.accountId != nil {
                    Button(needsPlanPermission ? "Enable plan use" : "Sign in again") {
                        editor.signIn(using: model)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!model.allowsExternalServices)
                }
                Button("Cancel") { editor.close() }
            }
            if target?.accountId == nil && registration == nil {
                Divider()
                Button("Register a new app") {
                    editor.prepareRegistration()
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
                        editor.error = "Could not copy the app name. Try again."
                        return
                    }
                    editor.signIn(using: model, suggestedAppName: name)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!model.allowsExternalServices)
                Button("Back") { editor.discardRegistration() }
            }
        }
    }

    private var saveButton: some View {
        Button("Save connection") {
            Task { await editor.save(using: model) }
        }.buttonStyle(.borderedProminent)
    }
}
