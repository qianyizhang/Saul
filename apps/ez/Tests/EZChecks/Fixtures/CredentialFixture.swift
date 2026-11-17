import EZCore
import Foundation
import SaulCredentialClient
import SaulCredentialTestSupport
import SaulNativeValues
import SaulTestSupport

/// Runs the shipped client, wire validation and owner with isolated storage and HTTP.
@MainActor func credentialText(
    directory: URL, http: HTTPFixture, key: String? = "synthetic", entry: HistoryEntry,
    onUpdate: @escaping @MainActor (ResponseAccumulator) -> Void
) async throws -> ResponseAccumulator {
    http.installModelCatalog([entry.model])
    let generation = SaulGeneration(
        connection: try credentialConnection(directory: directory, http: http, key: key))
    guard case .text(let output) = try await generation.generate(entry: entry, onUpdate: onUpdate)
    else { throw CredentialStorageError("Expected a text request") }
    return output
}

extension HistoryEntry {
    func withConnection(
        _ connection: ConnectionDefinition = ConnectionDefinition.defaults[1],
        capability: ActionCapability = .write
    ) -> HistoryEntry {
        var entry = self
        entry.connectionSnapshot = connection
        entry.presetSnapshot = ModelPreset(
            name: "Fixture", model: model, effort: effort, fast: requestedServiceTier != nil,
            connectionKey: connection.key, capability: capability)
        return entry
    }
}
