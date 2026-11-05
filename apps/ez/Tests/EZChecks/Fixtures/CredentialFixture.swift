import EZCore
import Foundation
import SaulCredentialOwner
import SaulCredentialStorage

private final class FixtureCredentialRecords: CredentialRecords, @unchecked Sendable {
    var values: [CredentialRecord: Data] = [:]
    func read(_ record: CredentialRecord) throws -> Data? { values[record] }
    func contains(_ record: CredentialRecord) throws -> Bool { values[record] != nil }
    func write(_ data: Data?, to record: CredentialRecord) throws { values[record] = data }
}

/// Runs the shipped client, wire validation and owner with isolated storage and HTTP.
@MainActor func credentialProvider(
    directory: URL, http: HTTPFixture, key: String? = "synthetic",
    id: GenerationProviderID = .openAIAPI
) throws -> GenerationProvider {
    http.installModelCatalog(["test"])
    return GenerationProvider.saul(
        id, connection: try credentialConnection(directory: directory, http: http, key: key))
}

@MainActor func credentialConnection(
    directory: URL, http: HTTPFixture, key: String? = "synthetic",
    definitions: [ConnectionDefinition] = ConnectionDefinition.defaults
) throws -> SaulConnection {
    try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
    let records = FixtureCredentialRecords()
    records.values[.openAI] = key.map { Data($0.utf8) }
    let storage = SharedAuthStorage(
        records: records, directory: directory,
        legacy: directory.appendingPathComponent("absent-accounts.json"), retireEZ: {})
    let connection = SaulConnection { framed in
        var frames = NativeFrames()
        guard let data = try frames.append(framed).first else {
            throw CredentialStorageError("Missing request frame")
        }
        let request = try CredentialRequest.decode(data, caller: .ez)
        let stream = AsyncThrowingStream<Data, Error> { continuation in
            let owner = CredentialOwner(
                storage: storage, caller: .ez, http: ConnectionHTTP(session: http.session),
                connectionDefinitions: { definitions }
            ) { event in
                do {
                    continuation.yield(
                        try JSONSerialization.data(withJSONObject: [
                            "id": request.id, "event": event,
                        ]))
                } catch { continuation.finish(throwing: error) }
            }
            let task = Task {
                do {
                    try await owner.run(request)
                    continuation.finish()
                } catch { continuation.finish(throwing: error) }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
        return NativeCredentialReplies(stream: stream, close: {})
    }
    return connection
}

extension HistoryEntry {
    func withAPIProvider() -> HistoryEntry {
        var entry = self
        entry.connectionSnapshot = ConnectionDefinition.defaults[1]
        return entry
    }
}
