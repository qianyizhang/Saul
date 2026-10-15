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
            SettingsSectionPicker(selection: $model.settingsSection).frame(width: 400, height: 24)
                .padding(.horizontal, 24).padding(.bottom, 16)
            Divider()
            ZStack {
                // Keep editor drafts and scroll position while visiting another section.
                ConfigurationView(model: model, hasUnsavedChanges: $hasUnsavedChanges)
                    .opacity(model.settingsSection == .configuration ? 1 : 0)
                    .allowsHitTesting(model.settingsSection == .configuration)
                    .disabled(model.settingsSection != .configuration)
                    .accessibilityHidden(model.settingsSection != .configuration)
                if model.settingsSection == .shortcuts {
                    ShortcutSettingsView(model: model)
                } else if model.settingsSection == .account {
                    accountBody
                }
            }
        }.frame(width: 760, height: 720).tint(AppStyle.accent)
            .interactiveDismissDisabled(hasUnsavedChanges)
            .alert("Discard unsaved edits?", isPresented: $confirmDiscard) {
                Button("Keep editing", role: .cancel) {}
                Button("Discard edits", role: .destructive) { dismiss() }
            } message: {
                Text(
                    "Your preset or recipe has unsaved edits. Return to Configuration to save them before closing."
                )
            }
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
                        Text(
                            "Connect your eligible ChatGPT account and allow EZ to use your plan. Credentials stay in macOS Keychain. Model availability and limits depend on your account."
                        ).font(.caption).foregroundStyle(.secondary)
                        DisclosureGroup("Why does macOS ask for Keychain access?") {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(
                                    "EZ saves sign-in tokens in its own Keychain record so you can stay signed in. It does not store your ChatGPT password or read other apps’ passwords."
                                )
                                Text(
                                    "Allow Once approves this access; Always Allow remembers permission for this app and item. Deny prevents access to the saved sign-in. A local development rebuild may prompt again."
                                )
                                Link(
                                    "About Keychain permissions",
                                    destination: URL(
                                        string: "https://support.apple.com/guide/keychain-access/kyca1243/mac"
                                    )!)
                            }.font(.caption).foregroundStyle(.secondary).padding(.top, 6)
                        }.font(.caption)
                        HStack {
                            if model.signingIn {
                                ProgressView().controlSize(.small)
                                Text("Finish signing in in your browser.").font(.caption)
                                Button("Cancel") { model.cancelLogin() }
                            } else if model.signedIn {
                                Button("Sign out of EZ") { Task { await model.signOut() } }
                                if !model.planEnabled {
                                    Button("Enable plan usage") { model.signIn(enablePlan: true) }
                                }
                                Button("Add account") { model.signIn(newAccount: true) }
                            } else {
                                Button("Continue with ChatGPT") { model.signIn() }.buttonStyle(
                                    .borderedProminent)
                                if !model.profiles.isEmpty {
                                    Button("Add account") { model.signIn(newAccount: true) }
                                }
                            }
                        }.disabled(model.offline || model.busy || model.connecting)
                        HStack {
                            Link(
                                "Manage usage",
                                destination: URL(string: "https://chatgpt.com/settings/usage")!)
                            Spacer()
                            Button(model.connecting ? "Loading…" : "Refresh models") {
                                Task { await model.connect() }
                            }.disabled(
                                model.offline || model.busy || model.connecting || model.signingIn
                                    || !model.planEnabled)
                        }.font(.caption)
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(8)
                }
                GroupBox {
                    VStack(alignment: .leading, spacing: 10) {
                        Label("Local history", systemImage: "externaldrive").font(.headline)
                        Text(
                            "Queries and answers are saved as plain-text JSONL on this Mac. Your query is sent to OpenAI to generate an answer; previous lookups are not included."
                        ).font(.caption).foregroundStyle(.secondary)
                        Text(model.directory.appendingPathComponent("history.jsonl").path).font(
                            .system(size: 10, design: .monospaced)
                        ).textSelection(.enabled)
                        Button("Show in Finder") { model.revealHistory() }.disabled(model.offline)
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(8)
                }
                if let error = model.error {
                    Text(error).font(.caption).foregroundStyle(.red).textSelection(.enabled)
                }
                HStack {
                    Text("EZ \(version)")
                    Spacer()
                    Link(
                        "Sign-in documentation",
                        destination: URL(
                            string: "https://developers.openai.com/siwc/token-sharing-open-source")!)
                }.font(.caption).foregroundStyle(.secondary)
            }.padding(26)
        }
    }
}
