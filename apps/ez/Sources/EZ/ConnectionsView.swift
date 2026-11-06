import AppKit
import EZCore
import SwiftUI

struct ConnectionsView: View {
    @ObservedObject var model: AppModel
    @Binding var hasUnsavedChanges: Bool
    let visible: Bool
    @State private var editing = false
    @State private var target: ConnectionDefinition?
    @State private var kind = "plan"
    @State private var name = ""
    @State private var endpoint = "https://api.openai.com/v1"
    @State private var key = ""
    @State private var account = ""
    @State private var newID = ""
    @State private var busy = false
    @State private var error: String?
    @State private var removing: ConnectionDefinition?
    @State private var loginTask: Task<Void, Never>?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text("Connections").font(AppStyle.subject)
                    Spacer()
                    Button("Add", systemImage: "plus") { open(nil) }
                        .disabled(
                            busy || model.configurationLocked || !model.sharedCredentialsConnected
                                || model.configuration.connections.count >= 32)
                }
                if let error { Text(error).foregroundStyle(.red).textSelection(.enabled) }
                if loginTask != nil {
                    Button("Cancel sign-in") {
                        loginTask?.cancel()
                        loginTask = nil
                        busy = false
                    }
                }
                if editing {
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
            for connection in model.configuration.connections {
                guard !Task.isCancelled else { return }
                await model.refreshConnection(connection)
            }
        }
        .onChange(of: editing, initial: true) { _, value in hasUnsavedChanges = value }
        .onDisappear {
            loginTask?.cancel()
            loginTask = nil
        }
        .confirmationDialog(
            "Disconnect this account or key in both Saul and EZ?",
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            titleVisibility: .visible
        ) {
            Button("Disconnect", role: .destructive) {
                guard let connection = removing else { return }
                removing = nil
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
    private func connectionRow(_ connection: ConnectionDefinition) -> some View {
        let status = model.connectionStatuses[connection.key]
        let checking = model.checkingConnections.contains(connection.key)
        let problem = model.connectionErrors[connection.key]
        let connected =
            model.offline
            ? (connection.kind == .chatGPTPlan ? model.signedIn : model.apiConnected)
            : status?.connected == true
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(connection.name).font(.headline)
                Spacer()
                Menu {
                    Button(connection.kind == .chatGPTPlan ? "Sign in again" : "Replace key") {
                        open(connection)
                    }
                    if connection.kind == .chatGPTPlan {
                        Link("Usage", destination: URL(string: "https://chatgpt.com/settings/usage")!)
                    }
                    Button(connection.kind == .chatGPTPlan ? "Sign out" : "Remove key", role: .destructive) {
                        removing = connection
                    }
                } label: {
                    Image(systemName: "ellipsis").frame(width: 28, height: 24)
                }
                .menuStyle(.borderlessButton).fixedSize().accessibilityLabel("More for \(connection.name)")
                .disabled(busy || model.configurationLocked)
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
            Text(identity(connection, status: status)).font(AppStyle.caption).textSelection(.enabled)
            HStack {
                if checking { ProgressView().controlSize(.small) }
                Text(
                    !model.sharedCredentialsConnected
                        ? "Helper disconnected"
                        : checking
                            ? "Checking…"
                            : problem != nil ? "Needs attention" : connected ? "✓ Connected" : "Not set up"
                )
                .font(.callout).foregroundStyle(problem != nil ? Color.red : .primary)
                Spacer()
                if !model.sharedCredentialsConnected {
                    Button("Open Integrations") { model.settingsSection = .preferences }
                } else if connected {
                    Button("Check") { Task { await model.refreshConnection(connection, force: true) } }
                        .disabled(checking || busy)
                } else {
                    Button("Set up") { open(connection) }.disabled(busy)
                }
            }
            if let problem {
                Text(problem).font(AppStyle.caption).foregroundStyle(.red).textSelection(.enabled)
            }
        }.padding(.vertical, 8)
    }
    private func identity(_ connection: ConnectionDefinition, status: ConnectionStatus?) -> String {
        if connection.kind == .chatGPTPlan {
            return status?.identity
                ?? (connection.accountId == nil ? "No account selected" : "Loading account…")
        }
        return connection.endpoint + (status?.keySuffix.map { " · sk-***\($0)" } ?? "")
    }
    private func open(_ connection: ConnectionDefinition?) {
        target = connection
        editing = true
        key = ""
        error = nil
        name = connection?.name ?? ""
        account = connection?.accountId ?? ""
        endpoint = connection?.endpoint ?? "https://api.openai.com/v1"
        kind =
            connection?.kind == .openAIAPI
            ? (endpoint == "https://api.openai.com/v1" ? "api" : "custom") : "plan"
        newID = "connection-" + UUID().uuidString.lowercased()
        guard !model.offline else { return }
        Task {
            do {
                try await model.auth.load()
                model.profiles = model.auth.accounts
            } catch { self.error = error.localizedDescription }
        }
    }
    private var setupForm: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(target.map { "Set up \($0.name)" } ?? "Add connection").font(.headline)
            if target == nil {
                Picker("Type", selection: $kind) {
                    Text("ChatGPT plan").tag("plan")
                    Text("OpenAI API").tag("api")
                    Text("Custom endpoint").tag("custom")
                }
                Text("Name").font(AppStyle.caption)
                TextField("Connection name", text: $name).textFieldStyle(.roundedBorder)
            }
            if kind == "plan" {
                Picker("Account", selection: $account) {
                    Text("Choose an account").tag("")
                    ForEach(model.profiles) { profile in Text(profile.label).tag(profile.id) }
                }.disabled(target?.accountId != nil)
                Button("Sign in and allow plan use") { signIn() }.disabled(model.offline || account.isEmpty)
                if target?.accountId == nil {
                    Button("Add another account") { signIn(addingAccount: true) }.disabled(model.offline)
                }
            } else {
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
            }
            HStack {
                Button("Save") { save() }.buttonStyle(.borderedProminent)
                Button("Cancel") {
                    editing = false
                    key = ""
                    error = nil
                }
                if busy { ProgressView().controlSize(.small) }
            }
        }.disabled(busy || model.configurationLocked)
    }
    private func signIn(addingAccount: Bool = false) {
        model.signingIn = true
        busy = true
        error = nil
        loginTask = Task {
            defer {
                model.signingIn = false
                busy = false
                loginTask = nil
            }
            do {
                let reply = try await model.auth.signIn(
                    accountID: target?.accountId ?? account, addingAccount: addingAccount,
                    authorize: { NSWorkspace.shared.open($0) })
                try await model.auth.load()
                model.profiles = model.auth.accounts
                if let profile = reply["account"] as? [String: Any], let id = profile["id"] as? String {
                    account = id
                }
            } catch { self.error = error.localizedDescription }
        }
    }
    private func save() {
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                let definition: ConnectionDefinition
                if kind == "plan" {
                    guard let profile = model.profiles.first(where: { $0.id == account }), profile.signedIn,
                        profile.planEnabled
                    else {
                        throw EZError("Sign in and allow plan use before saving this connection.")
                    }
                    definition = ConnectionDefinition(
                        key: target?.key ?? newID,
                        name: target?.name ?? (name.isEmpty ? String(profile.label.prefix(80)) : name),
                        kind: .chatGPTPlan, accountId: profile.id)
                } else {
                    definition = ConnectionDefinition(
                        key: target?.key ?? newID, name: target?.name ?? name,
                        kind: .openAIAPI,
                        baseUrl: kind == "api"
                            ? "https://api.openai.com/v1"
                            : endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
                }
                try ConnectionDefinition.validate([definition])
                try await model.saveConnection(definition, key: kind == "plan" ? nil : key)
                editing = false
                key = ""
            } catch { self.error = error.localizedDescription }
        }
    }
}
