import SwiftUI

struct SettingsView: View {
    @ObservedObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    private var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Development"
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                HStack {
                    Text("Make yourself at home.").font(.system(size: 23, weight: .semibold, design: .serif))
                    Spacer()
                    Button("Done") { dismiss() }.keyboardShortcut(.cancelAction)
                }
                GroupBox {
                    VStack(alignment: .leading, spacing: 12) {
                        Label("ChatGPT account", systemImage: "person.crop.circle").font(.headline)
                        if !model.profiles.isEmpty {
                            Picker(
                                "Account",
                                selection: Binding(
                                    get: { model.accountID },
                                    set: { value in Task { await model.selectAccount(value) } })
                            ) {
                                ForEach(model.profiles) { Text($0.label).tag($0.id) }
                            }.disabled(model.busy || model.connecting || model.signingIn)
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
                        }.disabled(model.busy || model.connecting)
                        HStack {
                            Link(
                                "Manage usage",
                                destination: URL(string: "https://chatgpt.com/settings/usage")!)
                            Spacer()
                            Button(model.connecting ? "Loading…" : "Refresh models") {
                                Task { await model.connect() }
                            }.disabled(
                                model.busy || model.connecting || model.signingIn || !model.planEnabled)
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
                        Button("Show in Finder") { model.revealHistory() }
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
        }.frame(width: 580, height: 600).tint(AppStyle.accent)
    }
}
