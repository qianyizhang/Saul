import AppKit
import EZCore
import Foundation

extension AppModel {
    func refreshActiveConnection(preferred: ConnectionDefinition? = nil) {
        guard !offline, sharedCredentialsConnected else { return }
        let historyConnection = selectedEntry.flatMap { entry in
            configuration.connections.first { $0.key == entry.presetSnapshot?.connectionKey }
        }
        connectionChecks.focus(preferred ?? historyConnection ?? currentConnection) { [weak self] in
            self?.adoptSelectedModels()
        }
    }

    func refreshConnection(_ connection: ConnectionDefinition, force: Bool = false) async {
        guard !offline, sharedCredentialsConnected,
            configuration.connections.contains(where: { $0.matchesRoute(connection) })
        else { return }
        await connectionChecks.refresh(connection, force: force)
        if !Task.isCancelled && sharedCredentialsConnected { adoptSelectedModels() }
    }

    private func adoptSelectedModels() {
        guard currentConnection?.kind == .chatGPTPlan, let currentPreset,
            connectionCatalog(currentPreset.connectionKey) != nil
        else { return }
        models = modelsForPreset(currentPreset)
        initializeStarterPreset()
    }
    func modelsForPreset(_ preset: ModelPreset) -> [ModelOption] {
        if offline { return models }
        return (connectionCatalog(preset.connectionKey)?.models ?? []).compactMap { model in
            ModelOption(catalog: [
                "visibility": "list", "slug": model.id, "display_name": model.name,
                "default_reasoning_level": model.defaultEffort,
                "supported_reasoning_levels": model.efforts.map { ["effort": $0] },
                "additional_speed_tiers": model.fastTier.map { [$0] } ?? [],
            ])
        }
    }
    func presetIssue(_ preset: ModelPreset) -> String? {
        if offline {
            let provider =
                configuration.connections.first { $0.key == preset.connectionKey }?.kind ?? .chatGPTPlan
            return preset.capability == .speak
                ? nil : preset.availabilityError(in: models, provider: provider)
        }
        guard let connection = configuration.connections.first(where: { $0.key == preset.connectionKey })
        else {
            return "The preset's connection is unavailable. Update the preset in Settings."
        }
        guard let catalog = connectionCatalog(connection.key) else {
            return connectionError(connection.key) ?? "Loading models for ‘\(connection.name)’…"
        }
        if let issue = catalog.issue(model: preset.model) { return issue }
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
        if offline || connectionCatalog(preset.connectionKey)?.isFresh == true { return presetIssue(preset) }
        return nil
    }
    var needsPlan: Bool { currentConnection?.kind == .chatGPTPlan }
    var connectionIssue: String? {
        connectionIssue(for: currentPreset)
    }
    func connectionIssue(for preset: ModelPreset?) -> String? {
        if !offline, !sharedCredentialsConnected {
            return "Connect to Saul in Settings → Preferences → Integrations."
        }
        guard let preset else { return nil }
        guard let connection = configuration.connections.first(where: { $0.key == preset.connectionKey })
        else {
            return "The selected preset's connection is unavailable. Open Connections."
        }
        guard connection.capabilities.contains(preset.capability) else {
            return
                "Connection ‘\(connection.name)’ cannot \(preset.capability.rawValue). Choose a compatible preset."
        }
        if !offline {
            if connection.kind == .chatGPTPlan && connection.accountId == nil {
                return "Choose an account for this connection in Settings → Connections."
            }
            if let error = connectionError(connection.key), connectionStatus(connection.key) == nil {
                return error
            }
            if connectionStatus(connection.key)?.connected != true {
                return "Set up ‘\(connection.name)’ in Connections."
            }
            return nil
        }
        if connection.kind == .chatGPTPlan {
            if !signedIn { return "Connect ‘\(connection.name)’ in Connections." }
            if !planEnabled { return "Enable plan usage in Connections." }
        } else if !apiConnected {
            return "Save an API key for ‘\(connection.name)’ in Connections."
        }
        return nil
    }
}
