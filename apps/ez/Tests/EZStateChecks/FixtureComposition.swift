import EZCore
import Foundation
import SaulNativeValues

@testable import EZApplication

/// Disposable input to the real connection status and preset admission path.
@MainActor final class FixtureConnections {
    var planConnected = true
    var apiConnected = true
    var models: [ConnectionModel] = [
        ConnectionModel(
            id: "fixture", capabilities: [.write], efforts: ["low", "medium"], fastTier: "priority"),
        ConnectionModel(id: "gpt-image-2.6-flare", capabilities: [.draw]),
        ConnectionModel(id: "gpt-image-2.6-fixture", capabilities: [.draw]),
        ConnectionModel(id: "fixture-audio", capabilities: [.speak]),
    ]

    func status(_ connection: ConnectionDefinition) -> ConnectionStatus {
        let plan = connection.kind == .chatGPTPlan
        return ConnectionStatus(
            connected: plan ? planConnected : apiConnected,
            identity: connection.accountId, signedIn: plan ? planConnected : nil)
    }

    func catalog(_ connection: ConnectionDefinition) -> ConnectionCatalog {
        ConnectionCatalog(
            models: models.filter { !$0.capabilities.filter(connection.capabilities.contains).isEmpty },
            fetchedAt: Date().timeIntervalSince1970)
    }

    func checks() -> ConnectionChecks {
        ConnectionChecks(
            status: { self.status($0) },
            catalog: { connection, _ in self.catalog(connection) },
            cached: {
                let status = self.status($0)
                return .init(status: status, catalog: status.connected ? self.catalog($0) : nil, error: nil)
            })
    }
}

@MainActor func fixtureModel(
    directory: URL, historyDirectory: URL? = nil, attemptExecution: AttemptExecution? = nil,
    connections: FixtureConnections? = nil, connectionChecks: ConnectionChecks? = nil,
    client: ConnectionSession.Client? = nil,
    readHistory: (@MainActor () async throws -> [HistoryEntry])? = nil,
    historyPreparation: HistoryCollection.Preparation? = nil
) -> AppModel {
    let historyDirectory = historyDirectory ?? directory
    let reader = HistoryReader(directory: historyDirectory)
    let writer = HistoryWriter(directory: historyDirectory)
    var config = Configuration.starters(model: "", effort: "low", fast: false)
    config.bindFixtureAccount()
    let preparation: HistoryCollection.Preparation
    if let historyPreparation {
        preparation = historyPreparation
    } else {
        do {
            try HistoryStore(directory: historyDirectory).recoverInterrupted()
            preparation = .ready
        } catch { preparation = .unavailable(error.localizedDescription) }
    }
    return AppModel(
        directory: directory, historyDirectory: historyDirectory,
        session: ConnectionSession(
            checks: connectionChecks ?? (connections ?? FixtureConnections()).checks(),
            client: client ?? .init()),
        configurationStore: ConfigurationStore(directory: directory), initialConfiguration: config,
        historyPreparation: preparation, attemptExecution: attemptExecution,
        readHistory: readHistory ?? { try await reader.load() },
        deleteHistory: { try await writer.delete($0) })
}

extension Configuration {
    mutating func bindFixtureAccount() {
        if let index = connections.firstIndex(where: { $0.kind == .chatGPTPlan }) {
            connections[index].accountId = "fixture-account"
        }
    }
}
