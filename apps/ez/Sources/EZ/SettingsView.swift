import SwiftUI

struct SettingsView: View {
    @ObservedObject var model: AppModel
    @State private var hasUnsavedChanges = false
    @State private var confirmDiscard = false
    @Environment(\.dismiss) private var dismiss
    private var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Development"
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
                        Button {
                            model.settingsSection = section
                        } label: {
                            Text(section.title).frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 12).padding(.vertical, 10)
                                .background(
                                    model.settingsSection == section ? AppStyle.accent.opacity(0.12) : .clear,
                                    in: RoundedRectangle(cornerRadius: 6))
                        }.buttonStyle(.plain)
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
                    ConfigurationView(model: model, hasUnsavedChanges: $hasUnsavedChanges)
                        .opacity(isConfiguration ? 1 : 0)
                        .allowsHitTesting(isConfiguration)
                        .disabled(!isConfiguration)
                        .accessibilityHidden(!isConfiguration)
                    if model.settingsSection == .shortcuts {
                        ShortcutSettingsView(model: model)
                    } else if model.settingsSection == .account {
                        accountBody
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
                    "Your preset or recipe has unsaved edits. Return to Models or Recipes to save them before closing."
                )
            }
    }
    private var isConfiguration: Bool { [.configuration, .recipes].contains(model.settingsSection) }

    private var overviewBody: some View {
        VStack(alignment: .leading, spacing: 22) {
            if !model.minimumMode { Text("Your current reading choices.").foregroundStyle(.secondary) }
            overviewRow("Recipe", value: model.currentRecipe?.name ?? "Unavailable", destination: .recipes)
            overviewRow(
                "Preset", value: model.currentPreset?.name ?? "Unavailable", destination: .configuration)
            overviewRow(
                "Account",
                value: model.signedIn
                    ? (model.planEnabled ? "Connected" : "Plan access needed") : "Not connected",
                destination: .account)
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

    private var accountBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                GroupBox {
                    VStack(alignment: .leading, spacing: 12) {
                        Label("ChatGPT account", systemImage: "person.crop.circle").font(.headline)
                        if !model.profiles.isEmpty {
                            SelectorPicker(
                                "Account",
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
                                : "Not signed in"
                        ).font(.callout)
                        if !model.minimumMode {
                            Text(
                                "Connect your eligible ChatGPT account and allow EZ to use your plan. Credentials stay in macOS Keychain. Model availability and limits depend on your account."
                            ).font(.caption).foregroundStyle(.secondary)
                        }
                        if !model.minimumMode {
                            DisclosureGroup("Keychain") {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(
                                        "EZ saves sign-in tokens in its own Keychain record so you can stay signed in. It does not store your ChatGPT password or read other apps’ passwords."
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
                                    Button(model.minimumMode ? "Disconnect" : "Sign out") {
                                        Task { await model.signOut() }
                                    }.help("Sign out").accessibilityLabel("Sign out")
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
                                Task { await model.connect() }
                            }.help("Refresh models").accessibilityLabel("Refresh models").disabled(
                                model.offline || model.busy || model.connecting || model.signingIn
                                    || !model.planEnabled)
                        }.controlSize(.regular)
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(8)
                }
                GroupBox {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Label(
                                model.minimumMode ? "History" : "Local history", systemImage: "externaldrive"
                            ).font(.headline)
                            Spacer()
                            Button(model.minimumMode ? "Reveal" : "Show in Finder") { model.revealHistory() }
                                .help("Show in Finder").accessibilityLabel("Show in Finder").disabled(
                                    model.offline)
                        }
                        if !model.minimumMode {
                            DisclosureGroup("Details") {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(
                                        "Queries and answers are saved as plain text on this Mac. Each new query is sent to OpenAI; previous lookups are not included."
                                    )
                                    Text(model.directory.appendingPathComponent("history.jsonl").path)
                                        .font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                                }.font(.caption).foregroundStyle(.secondary).padding(.top, 6)
                            }.font(.caption)
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(8)
                }
                if let error = model.error {
                    Text(error).font(.caption).foregroundStyle(.red).textSelection(.enabled)
                }
                if !model.minimumMode {
                    HStack {
                        Text("EZ \(version)")
                        Spacer()
                        Link(
                            "Sign-in documentation",
                            destination: URL(
                                string: "https://developers.openai.com/siwc/token-sharing-open-source")!)
                    }.font(.caption).foregroundStyle(.secondary)
                }
            }.padding(26)
        }
    }
}
