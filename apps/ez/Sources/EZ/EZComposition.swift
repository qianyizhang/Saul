import AppKit
import EZCore
import SaulCredentialClient
import SaulNativeValues

/// Assembles installed adapters. Offline previews and tests supply their own stores and clients.
@MainActor enum EZComposition {
    static func installed() -> AppModel {
        let prefs = UserDefaults.standard
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("EZ", isDirectory: true)
        let historyDirectory = HistoryStore.defaultDirectory
        let auth = SaulConnection()
        let generation = SaulGeneration(connection: auth)
        let speech = SpeechPreviewClient(connection: auth)
        let checks = ConnectionChecks(
            status: { connection in
                let reply = try await auth.call([
                    "action": "connection-status", "connectionKey": connection.key,
                ])
                return try decode(ConnectionStatus.self, from: reply["connection"], name: "connection status")
            },
            catalog: { connection, intent in
                let reply = try await auth.call([
                    "action": "connection-catalog", "connectionKey": connection.key,
                    "intent": intent.rawValue,
                ])
                return try decode(ConnectionCatalog.self, from: reply["catalog"], name: "model catalog")
            })
        let session = ConnectionSession(
            checks: checks,
            client: .init(
                accounts: {
                    try await auth.load()
                    return auth.accounts
                },
                signIn: { account, suggestedAppName in
                    let reply = try await auth.signIn(
                        accountID: account, suggestedAppName: suggestedAppName,
                        authorize: { NSWorkspace.shared.open($0) })
                    return (reply["account"] as? [String: Any])?["id"] as? String
                },
                saveKey: { connection, key in
                    _ = try await auth.call([
                        "action": "connection-key-save", "connectionKey": connection.key,
                        "endpoint": connection.endpoint, "key": key,
                    ])
                },
                removeKey: { connection in
                    _ = try await auth.call([
                        "action": "connection-key-remove", "connectionKey": connection.key,
                        "endpoint": connection.endpoint,
                    ])
                },
                signOut: { account in
                    let reply = try await auth.call(["action": "logout", "accountId": account])
                    return try decode(
                        ConnectionChecks.LogoutOutcome.self, from: reply, name: "sign-out result")
                }),
            connected: !prefs.bool(forKey: "saulCredentialsDisconnected"),
            setPreference: { prefs.set(!$0, forKey: "saulCredentialsDisconnected") })
        let writer = HistoryWriter(directory: historyDirectory)
        let reader = HistoryReader(directory: historyDirectory)
        return AppModel(
            directory: directory, historyDirectory: historyDirectory,
            session: session,
            configurationStore: ConfigurationStore(directory: directory, shared: SharedPresetsStore()),
            initialConfiguration: .starters(
                model: prefs.string(forKey: "model") ?? "",
                effort: prefs.string(forKey: "effort") ?? "low", fast: prefs.bool(forKey: "fast")),
            historyPreparation: .open { try await writer.prepare(migrating: directory) },
            upgradeActions: true,
            minimumMode: prefs.object(forKey: "minimumMode") as? Bool ?? true,
            setMinimumMode: { prefs.set($0, forKey: "minimumMode") },
            attemptExecution: AttemptExecution(
                generate: generation.generate(entry:onUpdate:), append: { try await writer.append($0) }),
            readHistory: { try await reader.page(search: $0, after: $1) },
            countHistory: { try await reader.count(search: $0, excluding: $1) },
            readHistoryEntry: { try await reader.entry($0) },
            deleteHistory: { try await writer.delete($0) },
            speak: speech.generate(preset:text:), allowsExternalServices: true)
    }

    private static func decode<T: Decodable>(_ type: T.Type, from value: Any?, name: String) throws -> T {
        guard let value else { throw EZError("Invalid \(name).") }
        return try JSONDecoder().decode(type, from: JSONSerialization.data(withJSONObject: value))
    }
}
