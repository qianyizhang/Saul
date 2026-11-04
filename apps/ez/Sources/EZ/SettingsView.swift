import SwiftUI

struct SettingsView: View {
    @ObservedObject var model: AppModel
    @State private var configurationDirty = false
    @State private var providerKey = "gpt-plan"
    @State private var providerName = ""
    @State private var providerMessage: String?
    @State private var pendingProvider: String?
    private var providerDirty: Bool {
        !providerName.isEmpty
            && providerName != model.configuration.providers.first(where: { $0.key == providerKey })?.name
    }
    private var hasUnsavedChanges: Bool { configurationDirty || providerDirty }
    @State private var confirmDiscard = false
    @State private var confirmSignOut = false
    @State private var confirmRemoveKey = false
    @Environment(\.dismiss) private var dismiss
    private var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Development"
    }
    private var build: String {
        guard let url = Bundle.main.url(forResource: "build-info", withExtension: "json"),
            let data = try? Data(contentsOf: url),
            let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let identity = value["build"] as? String, identity.count == 64
        else { return "Unavailable" }
        return String(identity.prefix(12))
    }
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Settings").font(AppStyle.subject)
                Spacer()
                Button("Done") {
                    if hasUnsavedChanges { confirmDiscard = true } else { dismiss() }
                }.keyboardShortcut(.cancelAction)
            }.padding(22)
            Divider()
            HStack(alignment: .top, spacing: 0) {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(AppModel.SettingsSection.allCases, id: \.self) { section in
                        FullRowButton {
                            model.settingsSection = section
                        } label: {
                            Text(section.title).frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 12).padding(.vertical, 10)
                                .background(
                                    model.settingsSection == section ? AppStyle.accent.opacity(0.12) : .clear,
                                    in: RoundedRectangle(cornerRadius: 6))
                        }
                        .accessibilityAddTraits(model.settingsSection == section ? .isSelected : [])
                    }
                    Spacer()
                    if hasUnsavedChanges {
                        Text("Unsaved edits").font(AppStyle.caption).foregroundStyle(.orange)
                    }
                }.padding(12).frame(width: 150)
                Divider()
                ZStack {
                    // One mounted owner keeps both drafts when navigating between tasks.
                    ConfigurationView(model: model, hasUnsavedChanges: $configurationDirty)
                        .opacity(isConfiguration ? 1 : 0)
                        .allowsHitTesting(isConfiguration)
                        .disabled(!isConfiguration)
                        .accessibilityHidden(!isConfiguration)
                    if model.settingsSection == .shortcuts {
                        ShortcutSettingsView(model: model)
                    } else if model.settingsSection == .account {
                        providersBody
                    } else if model.settingsSection == .overview {
                        overviewBody
                    } else if model.settingsSection == .preferences {
                        preferencesBody
                    }
                }
            }
        }.frame(width: 880, height: 720).tint(AppStyle.accent)
            .labelStyle(EverydayLabelStyle(minimum: model.minimumMode))
            .disclosureGroupStyle(FullRowDisclosureStyle())
            .interactiveDismissDisabled(hasUnsavedChanges)
            .alert("Discard unsaved edits?", isPresented: $confirmDiscard) {
                Button("Keep", role: .cancel) {}
                Button("Discard", role: .destructive) { dismiss() }
            } message: {
                Text(
                    "Your provider, preset or action has unsaved edits. Return to its editor to save them before closing."
                )
            }
    }
    private var isConfiguration: Bool { [.configuration, .actions].contains(model.settingsSection) }

    private var overviewBody: some View {
        VStack(alignment: .leading, spacing: 22) {
            Text("Version \(version) · Build \(build)").font(AppStyle.caption).foregroundStyle(.secondary)
                .textSelection(.enabled)
                .accessibilityLabel("Version \(version) · Build \(build)")
                .accessibilityIdentifier("ez-version")
            if !model.minimumMode { Text("Your current reading choices.").foregroundStyle(.secondary) }
            overviewRow("Action", value: model.currentAction?.name ?? "Unavailable", destination: .actions)
            overviewRow(
                "Preset", value: model.currentPreset?.name ?? "Unavailable", destination: .configuration)
            overviewRow(
                "Provider", value: model.currentProvider?.name ?? "Unavailable", destination: .account)
            Spacer()
        }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func overviewRow(_ label: String, value: String, destination: AppModel.SettingsSection)
        -> some View
    {
        Button {
            model.settingsSection = destination
        } label: {
            HStack {
                Text(label)
                Spacer()
                Text(value).foregroundStyle(.secondary)
                Image(systemName: "chevron.right").accessibilityHidden(true)
            }
            .padding(.vertical, 12).contentShape(Rectangle())
        }.buttonStyle(.plain)
    }

    private var preferencesBody: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Preferences").font(AppStyle.subject)
            Button("Reveal history") { model.revealHistory() }
            Toggle("Min Mode", isOn: $model.minimumMode).toggleStyle(.switch)
            if !model.minimumMode {
                Text(
                    "Everyday controls for familiar users. Reveal guidance and uncommon actions when needed."
                )
                .font(AppStyle.caption).foregroundStyle(.secondary)
            }
            if !model.minimumMode {
                Text("Saves immediately.").font(AppStyle.caption).foregroundStyle(.secondary)
            }
            Spacer()
        }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var providersBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Providers").font(AppStyle.subject)
                HStack(alignment: .top, spacing: 24) {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(model.configuration.providers) { provider in
                            FullRowButton {
                                if providerDirty {
                                    pendingProvider = provider.key
                                } else {
                                    selectProvider(provider.key)
                                }
                            } label: {
                                Text(provider.name).frame(maxWidth: .infinity, alignment: .leading).padding(8)
                                    .background(
                                        providerKey == provider.key ? AppStyle.accent.opacity(0.12) : .clear,
                                        in: RoundedRectangle(cornerRadius: 6))
                            }
                        }
                    }.frame(width: 140)
                    Divider()
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Name").font(AppStyle.caption)
                        TextField("Provider name", text: $providerName).textFieldStyle(.roundedBorder)
                        MetadataRow("Key", value: providerKey)
                        MetadataRow(
                            "Capabilities",
                            value: model.configuration.providers.first(where: { $0.key == providerKey })?
                                .capabilities.map(\.name).joined(separator: " · ") ?? "Unavailable")
                        HStack {
                            Button("Save") { saveProvider() }.disabled(
                                !providerDirty || model.configurationLocked)
                            if let providerMessage {
                                Text(providerMessage).font(AppStyle.caption).foregroundStyle(.secondary)
                            }
                        }
                        Divider()
                        if !model.sharedCredentialsConnected {
                            Button("Connect to Saul") { Task { await model.connectCredentials() } }
                                .buttonStyle(.borderedProminent)
                        } else {
                            if providerKey == "gpt-plan" { planConnection } else { apiConnection }
                            Button("Disconnect app") { model.disconnectCredentials() }
                                .help("Disconnect EZ; keep the shared Saul sign-in and API key.")
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            }.padding(24)
        }
        .onAppear { if providerName.isEmpty { selectProvider(providerKey) } }
        .task(id: providerKey) {
            if providerKey == "gpt-plan" {
                await model.connect(loadAccounts: true)
            } else {
                await model.restoreAPIKey()
            }
        }
        .confirmationDialog(
            "Sign out of Saul in both apps?", isPresented: $confirmSignOut, titleVisibility: .visible
        ) {
            Button("Sign out", role: .destructive) { Task { await model.signOut() } }
        } message: {
            Text("This shared ChatGPT sign-in will be unavailable in Saul and EZ.")
        }
        .confirmationDialog(
            "Remove the API key from both apps?", isPresented: $confirmRemoveKey, titleVisibility: .visible
        ) {
            Button("Remove", role: .destructive) { Task { await model.removeAPIKey() } }
        } message: {
            Text("Saul and EZ will need a new OpenAI API key. ChatGPT sign-in stays connected.")
        }
        .alert(
            "Discard provider edits?",
            isPresented: Binding(get: { pendingProvider != nil }, set: { if !$0 { pendingProvider = nil } })
        ) {
            Button("Keep", role: .cancel) { pendingProvider = nil }
            Button("Discard", role: .destructive) {
                if let key = pendingProvider { selectProvider(key) }
                pendingProvider = nil
            }
        } message: {
            Text("Save the provider name before switching, or discard its edits.")
        }
    }
    private func selectProvider(_ key: String) {
        providerKey = key
        providerName = model.configuration.providers.first { $0.key == key }?.name ?? ""
        providerMessage = nil
    }
    private func saveProvider() {
        var updated = model.configuration
        guard let index = updated.providers.firstIndex(where: { $0.key == providerKey }) else { return }
        updated.providers[index].name = providerName.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try model.saveConfiguration(updated)
            selectProvider(providerKey)
            providerMessage = "Saved"
        } catch { providerMessage = error.localizedDescription }
    }
    private var apiConnection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(model.apiConnected ? "API key saved" : "API key required").font(.callout)
            SecureField(
                model.apiConnected ? "Replacement API key" : "OpenAI API key", text: $model.apiKeyDraft
            )
            .textFieldStyle(.roundedBorder).accessibilityLabel("OpenAI API key")
            .disabled(model.busy || model.apiKeyBusy)
            HStack {
                Button("Save") { Task { await model.saveAPIKey() } }.disabled(model.apiKeyDraft.isEmpty)
                    .accessibilityLabel("Save API key")
                Button("Reload") { Task { await model.restoreAPIKey() } }
                if model.apiConnected {
                    Button("Remove", role: .destructive) { confirmRemoveKey = true }
                }
            }
            .disabled(model.busy || model.apiKeyBusy)
            if let error = model.apiKeyError {
                Text(error).font(AppStyle.caption).foregroundStyle(.red).textSelection(.enabled)
            }
            if !model.minimumMode {
                Text("Shared with Saul through this Mac's Keychain. Saving does not send a model request.")
                    .font(
                        AppStyle.caption
                    ).foregroundStyle(.secondary)
            }
            Text("OpenAI API · billed separately from ChatGPT").font(AppStyle.caption).foregroundStyle(
                .secondary)
        }
    }

    private var planConnection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("ChatGPT account", systemImage: "person.crop.circle").font(.headline)
            if !model.profiles.isEmpty {
                SelectorPicker(
                    "Provider",
                    options: model.profiles.map { .init(value: $0.id, title: $0.label) },
                    selection: Binding(
                        get: { model.accountID },
                        set: { value in Task { await model.selectAccount(value) } })
                )
                .disabled(
                    model.offline || model.busy || model.connecting || model.signingIn
                        || model.launcherPending)
            }
            Text(
                model.signedIn
                    ? (model.planEnabled
                        ? "Using ChatGPT plan" : "Signed in · Plan usage not enabled")
                    : (model.accountsLoaded ? "Not signed in" : "Connection not loaded")
            ).font(.callout)
            if !model.minimumMode {
                Text(
                    "Connect your eligible ChatGPT account and allow Saul to use your plan in both apps. Credentials stay in macOS Keychain. Model availability and limits depend on your account."
                ).font(.caption).foregroundStyle(.secondary)
            }
            if !model.minimumMode {
                DisclosureGroup("Keychain") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(
                            "The signed Saul helper owns the shared sign-in and API key. Neither app receives long-lived credentials from it."
                        )
                        Text(
                            "Allow Once approves this access; Always Allow remembers permission for this app and item. Deny prevents access to the saved sign-in. A local development rebuild may prompt again."
                        )
                        Link(
                            "Permissions",
                            destination: URL(
                                string:
                                    "https://support.apple.com/guide/keychain-access/kyca1243/mac"
                            )!)
                    }.font(.caption).foregroundStyle(.secondary).padding(.top, 6)
                }.font(.caption)
            }
            HStack(spacing: 8) {
                Group {
                    if model.signingIn {
                        ProgressView().controlSize(.small)
                        Text("Finish signing in in your browser.").font(.caption)
                        Button("Cancel") { model.cancelLogin() }
                    } else if model.signedIn {
                        Button("Sign out") { confirmSignOut = true }
                            .help("Sign out of ChatGPT in Saul and EZ").accessibilityLabel(
                                "Sign out of ChatGPT in both apps")
                        if !model.planEnabled {
                            Button(model.minimumMode ? "Enable" : "Enable plan usage") {
                                model.signIn(enablePlan: true)
                            }.help("Enable plan usage").accessibilityLabel("Enable plan usage")
                        }
                        Button(model.minimumMode ? "Add" : "Add account") {
                            model.signIn(newAccount: true)
                        }.help("Add account").accessibilityLabel("Add account")
                    } else {
                        Button(model.minimumMode ? "Connect" : "Continue with ChatGPT") {
                            model.signIn()
                        }.help("Continue with ChatGPT").accessibilityLabel(
                            "Continue with ChatGPT"
                        )
                        .buttonStyle(
                            .borderedProminent)
                        if !model.profiles.isEmpty {
                            Button(model.minimumMode ? "Add" : "Add account") {
                                model.signIn(newAccount: true)
                            }.help("Add account").accessibilityLabel("Add account")
                        }
                    }
                }.disabled(model.offline || model.busy || model.connecting)
                Spacer()
                Link(
                    model.minimumMode ? "Usage" : "Manage usage",
                    destination: URL(string: "https://chatgpt.com/settings/usage")!
                )
                .help("Manage usage").accessibilityLabel("Manage usage")
                .buttonStyle(.bordered)
                Button(
                    model.connecting
                        ? "Loading…" : (model.minimumMode ? "Refresh" : "Refresh models")
                ) {
                    Task { await model.connect(loadAccounts: true) }
                }.help("Refresh models").accessibilityLabel("Refresh models").disabled(
                    model.offline || model.busy || model.connecting || model.signingIn
                        || !model.planEnabled)
            }.controlSize(.regular)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(8)
    }
}
