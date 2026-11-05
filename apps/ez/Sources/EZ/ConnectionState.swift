import AppKit
import EZCore
import Foundation

extension AppModel {
    func refreshActiveConnection() {
        let previous = activeConnectionRefresh
        previous?.cancel()
        let selectedConnection = selectedEntry.flatMap { entry in
            configuration.connections.first { $0.key == entry.presetSnapshot?.connectionKey }
        }
        guard !offline, let connection = selectedConnection ?? currentConnection,
            connectionCatalogs[connection.key]?.isFresh != true
        else { return }
        activeConnectionRefresh = Task {
            await previous?.value
            guard !Task.isCancelled else { return }
            await refreshConnection(connection)
        }
    }
    func refreshConnection(_ connection: ConnectionDefinition, force: Bool = false) async {
        guard !offline, sharedCredentialsConnected, !checkingConnections.contains(connection.key) else {
            return
        }
        checkingConnections.insert(connection.key)
        defer { checkingConnections.remove(connection.key) }
        do {
            let reply = try await auth.call(["action": "connection-status", "connectionKey": connection.key])
            guard let raw = reply["connection"] else { throw EZError("Invalid connection status.") }
            let status = try JSONDecoder().decode(
                ConnectionStatus.self, from: JSONSerialization.data(withJSONObject: raw))
            guard configuration.connections.contains(connection), !Task.isCancelled else { return }
            connectionStatuses[connection.key] = status
            connectionErrors[connection.key] = nil
            guard status.connected else { return }
            let response = try await auth.call([
                "action": "connection-catalog", "connectionKey": connection.key, "force": force,
            ])
            guard let raw = response["catalog"] else { throw EZError("Invalid model catalog.") }
            let catalog = try JSONDecoder().decode(
                ConnectionCatalog.self, from: JSONSerialization.data(withJSONObject: raw))
            guard configuration.connections.contains(connection), !Task.isCancelled else { return }
            connectionCatalogs[connection.key] = catalog
            connectionErrors[connection.key] = catalog.error
            if currentConnection?.key == connection.key, connection.kind == .chatGPTPlan,
                let preset = currentPreset
            {
                models = modelsForPreset(preset)
                initializeStarterPreset()
            }
        } catch {
            if !Task.isCancelled { connectionErrors[connection.key] = error.localizedDescription }
        }
    }
    func modelsForPreset(_ preset: ModelPreset) -> [ModelOption] {
        if offline { return models }
        return (connectionCatalogs[preset.connectionKey]?.models ?? []).compactMap { model in
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
        guard let catalog = connectionCatalogs[connection.key] else {
            return connectionErrors[connection.key] ?? "Loading models for ‘\(connection.name)’…"
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
    func saveConnection(_ connection: ConnectionDefinition, key: String? = nil) async throws {
        if let existing = configuration.connections.first(where: { $0.key == connection.key }),
            existing.accountId != nil && existing.accountId != connection.accountId
        {
            throw EZError("This connection is bound to another account. Add another connection.")
        }
        if let account = connection.accountId,
            configuration.connections.contains(where: { $0.key != connection.key && $0.accountId == account })
        {
            throw EZError("This account already has a connection.")
        }
        if let key {
            if offline {
                try await apiKeyStore.write(key)
                apiConnected = !key.isEmpty
            } else {
                _ = try await auth.call([
                    "action": "connection-key-save", "connectionKey": connection.key,
                    "endpoint": connection.endpoint, "key": key,
                ])
            }
        }
        var updated = configuration
        if let index = updated.connections.firstIndex(where: { $0.key == connection.key }) {
            updated.connections[index] = connection
        } else {
            updated.connections.append(connection)
        }
        try saveConfiguration(updated)
        connectionCatalogs[connection.key] = nil
        await refreshConnection(connection, force: true)
    }
    func removeConnectionCredential(_ connection: ConnectionDefinition) async throws {
        if offline {
            try await apiKeyStore.write(nil)
            apiConnected = false
            return
        }
        if connection.kind == .chatGPTPlan {
            guard let account = connection.accountId else { throw EZError("This connection has no account.") }
            _ = try await auth.call(["action": "logout", "accountId": account])
        } else {
            _ = try await auth.call([
                "action": "connection-key-remove", "connectionKey": connection.key,
                "endpoint": connection.endpoint,
            ])
        }
        connectionCatalogs[connection.key] = nil
        await refreshConnection(connection)
    }
}
