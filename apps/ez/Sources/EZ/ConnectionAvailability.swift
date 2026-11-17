import AppKit
import EZCore
import Foundation
import SaulNativeValues

extension AppModel {
    struct ConnectionGuidance {
        let message: String
        let section: SettingsSection?
    }

    static func setupLabel(for section: SettingsSection) -> String {
        section == .preferences ? "Open Integrations" : "Open \(section.title)"
    }

    func refreshActiveConnection(preferred: ConnectionDefinition? = nil) {
        guard !quitting, sharedCredentialsConnected else { return }
        let historyConnection = selectedEntry.flatMap { entry in
            configuration.connections.first { $0.key == entry.presetSnapshot?.connectionKey }
        }
        connectionChecks.focus(preferred ?? historyConnection ?? currentConnection) { [weak self] in
            self?.initializeStarterPreset()
        }
    }

    func refreshConnection(_ connection: ConnectionDefinition, intent: ConnectionChecks.Intent = .passive)
        async
    {
        guard !quitting, sharedCredentialsConnected,
            configuration.connections.contains(where: { $0.matchesRoute(connection) })
        else { return }
        await connectionChecks.refresh(connection, intent: intent)
        if !Task.isCancelled && sharedCredentialsConnected { initializeStarterPreset() }
    }

    func modelsForPreset(_ preset: ModelPreset) -> [ModelOption] {
        return (connectionCatalog(preset.connectionKey)?.options(for: preset.capability) ?? [])
            .map(ModelOption.init(connectionModel:))
    }
    func presetIssue(_ preset: ModelPreset) -> String? {
        guard let connection = configuration.connections.first(where: { $0.key == preset.connectionKey })
        else {
            return "The preset's connection is unavailable. Update the preset in Settings."
        }
        guard let catalog = connectionCatalog(connection.key) else {
            return connectionError(connection.key) ?? "Loading models for ‘\(connection.name)’…"
        }
        if let issue = catalog.issue(model: preset.model, capability: preset.capability) { return issue }
        if connection.kind == .chatGPTPlan,
            let model = catalog.models.first(where: { $0.id == preset.model })
        {
            if !preset.effort.isEmpty && !model.efforts.contains(preset.effort) {
                return "This model no longer supports the preset's effort. Update the preset."
            }
            if preset.fast && model.fastTier == nil {
                return "Fast is unavailable for this model. Update the preset."
            }
        }
        return nil
    }
}

extension AppModel {
    var currentConnection: ConnectionDefinition? {
        configuration.connections.first { $0.key == currentPreset?.connectionKey }
    }
    func lookupPresetChoiceIssue(_ preset: ModelPreset) -> String? {
        guard let action = currentAction else { return "Choose an action first." }
        guard preset.capability != .speak else { return "Speak previews run in Settings → Presets." }
        guard preset.capability == action.capability else {
            return "This action needs a \(action.capability.name) preset."
        }
        guard let connection = configuration.connections.first(where: { $0.key == preset.connectionKey })
        else {
            return "The preset’s connection is unavailable. Update the preset in Settings."
        }
        if action.webSearch && connection.kind != .openAIAPI {
            return "Web search needs an OpenAI API Write preset."
        }
        guard connection.capabilities.contains(preset.capability) else {
            return "This connection does not support \(preset.capability.name)."
        }
        if preset.model.isEmpty { return "Choose a model in Settings → Presets." }
        // An unopened connection can load its catalog when selected. Only block on known model evidence.
        if connectionCatalog(preset.connectionKey)?.isFresh == true { return presetIssue(preset) }
        return nil
    }
    var connectionIssue: String? {
        connectionIssue(for: currentPreset)
    }
    func connectionIssue(for preset: ModelPreset?) -> String? {
        connectionGuidance(for: preset)?.message
    }
    func connectionGuidance(for preset: ModelPreset?) -> ConnectionGuidance? {
        func setup(_ message: String) -> ConnectionGuidance {
            ConnectionGuidance(message: message, section: .connections)
        }
        if !sharedCredentialsConnected {
            return ConnectionGuidance(
                message: "Connect to Saul in Settings → Preferences → Integrations.",
                section: .preferences)
        }
        guard let preset else { return nil }
        guard let connection = configuration.connections.first(where: { $0.key == preset.connectionKey })
        else {
            return setup("The selected preset's connection is unavailable. Open Connections.")
        }
        guard connection.capabilities.contains(preset.capability) else {
            return ConnectionGuidance(
                message:
                    "Connection ‘\(connection.name)’ cannot \(preset.capability.rawValue). Choose a compatible preset.",
                section: .configuration)
        }
        if connection.kind == .chatGPTPlan && connection.accountId == nil {
            return setup("Choose an account for this connection in Settings → Connections.")
        }
        guard let status = connectionStatus(connection.key) else {
            if let error = connectionError(connection.key) { return setup(error) }
            return ConnectionGuidance(
                message: "Checking ‘\(connection.name)’…", section: nil)
        }
        if status.connected { return nil }
        if connection.kind == .chatGPTPlan {
            if status.signedIn == false {
                return setup("Sign in to ‘\(connection.name)’ in Connections.")
            }
            if status.signedIn == true {
                return setup("Allow plan use for ‘\(connection.name)’ in Connections.")
            }
        }
        return setup("Set up ‘\(connection.name)’ in Connections.")
    }
    var currentConnectionWarning: String? {
        guard let key = currentPreset?.connectionKey, connectionStatus(key)?.connected == true else {
            return nil
        }
        return connectionError(key)
    }

    var currentConnectionSetupSection: SettingsSection? {
        if let guidance = connectionGuidance(for: currentPreset) { return guidance.section }
        return currentConnectionWarning == nil ? nil : .connections
    }
}
