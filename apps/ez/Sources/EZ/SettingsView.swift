import SwiftUI

struct SettingsView: View {
    @ObservedObject var model: AppModel
    @State private var configurationDirty = false
    @State private var connectionDirty = false
    @State private var viewingPresetID: UUID?
    private var hasUnsavedChanges: Bool { configurationDirty || connectionDirty }
    @State private var confirmDiscard = false
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
            ForEach(
                model.configuration.presets.filter { preset in
                    if model.settingsSection == .configuration && preset.id == viewingPresetID {
                        return false
                    }
                    guard let catalog = model.connectionCatalogs[preset.connectionKey],
                        catalog.fetchedAt > 0,
                        !preset.model.isEmpty
                    else { return false }
                    return !catalog.models.contains { $0.id == preset.model }
                }.prefix(1)
            ) { preset in
                HStack {
                    Text("‘\(preset.name)’: model ‘\(preset.model)’ is no longer available.")
                        .foregroundStyle(.red)
                    Spacer()
                    Button("Edit preset") {
                        model.settingsPresetID = preset.id
                        model.settingsSection = .configuration
                    }
                }.padding(.horizontal, 22).padding(.bottom, 8)
            }
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
                    ConfigurationView(
                        model: model, hasUnsavedChanges: $configurationDirty,
                        viewingPresetID: $viewingPresetID
                    )
                    .opacity(isConfiguration ? 1 : 0)
                    .allowsHitTesting(isConfiguration)
                    .disabled(!isConfiguration)
                    .accessibilityHidden(!isConfiguration)
                    ConnectionsView(
                        model: model, hasUnsavedChanges: $connectionDirty,
                        visible: model.settingsSection == .connections
                    )
                    .opacity(model.settingsSection == .connections ? 1 : 0)
                    .allowsHitTesting(model.settingsSection == .connections)
                    .accessibilityHidden(model.settingsSection != .connections)
                    if model.settingsSection == .shortcuts {
                        ShortcutSettingsView(model: model)

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
            .task {
                for connection in model.configuration.connections {
                    guard !Task.isCancelled else { return }
                    await model.refreshConnection(connection)
                }
            }
            .interactiveDismissDisabled(hasUnsavedChanges)
            .alert("Discard unsaved edits?", isPresented: $confirmDiscard) {
                Button("Keep", role: .cancel) {}
                Button("Discard", role: .destructive) { dismiss() }
            } message: {
                Text(
                    "Your connection, preset or action has unsaved edits. Return to its editor to save them before closing."
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
                "Connection", value: model.currentConnection?.name ?? "Unavailable", destination: .connections
            )
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
            DisclosureGroup("Integrations") {
                VStack(alignment: .leading, spacing: 10) {
                    Text("The signed credential helper manages shared sign-in and keys.").font(
                        AppStyle.caption)
                    Button(model.sharedCredentialsConnected ? "Disconnect app" : "Connect to Saul") {
                        if model.sharedCredentialsConnected {
                            model.disconnectCredentials()
                        } else {
                            Task { await model.connectCredentials() }
                        }
                    }
                }.padding(.top, 8)
            }
            Spacer()
        }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

}
