import Foundation
import SaulCredentialClient
import SaulCredentialOwner
import SaulNativeValues
import SaulTestSupport

package final class FixtureCredentialRecords: CredentialRecords, @unchecked Sendable {
  package init() {}
  package var values: [CredentialRecord: Data] = [:]
  package func read(_ record: CredentialRecord) throws -> Data? { values[record] }
  package func contains(_ record: CredentialRecord) throws -> Bool { values[record] != nil }
  package func write(_ data: Data?, to record: CredentialRecord) throws { values[record] = data }
}

@MainActor public func credentialConnection(
  directory: URL, http: HTTPFixture, key: String? = "synthetic",
  definitions: [ConnectionDefinition] = ConnectionDefinition.defaults
) throws -> SaulConnection {
  try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
  let records = FixtureCredentialRecords()
  records.values[.openAI] = key.map { Data($0.utf8) }
  let storage = SharedAuthStorage(records: records, directory: directory)
  let connection = SaulConnection { framed in
    var frames = NativeFrames()
    guard let data = try frames.append(framed).first else {
      throw CredentialStorageError("Missing request frame")
    }
    let request = try CredentialRequest.decode(data, caller: .ez)
    let stream = AsyncThrowingStream<Data, Error> { continuation in
      let owner = CredentialOwner(
        storage: storage, http: ConnectionHTTP(session: http.session),
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
