import EZCheckSupport
import EZCore
import Foundation
import SaulCredentialStorage

@MainActor func connectionChecks() -> [CheckCase] {
    [
        CheckCase("connections: sign-in reuses the selected registration and adding an account is explicit") {
            _ in
            var requests: [[String: Any]] = []
            let client = SaulConnection(transport: { frame in
                var frames = NativeFrames()
                guard let data = try frames.append(frame).first,
                    let packet = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                    let id = packet["id"] as? String, let request = packet["request"] as? [String: Any]
                else { throw CheckFailure("Invalid sign-in request frame") }
                requests.append(request)
                let reply = try JSONSerialization.data(withJSONObject: [
                    "id": id, "event": ["type": "result"],
                ])
                return NativeCredentialReplies(
                    stream: AsyncThrowingStream { continuation in
                        continuation.yield(reply)
                        continuation.finish()
                    }, close: {})
            })
            _ = try await client.signIn(accountID: "chosen-registration", authorize: { _ in false })
            try expectEqual(
                requests[0]["accountId"] as? String, "chosen-registration",
                "Reauthorization created a registration")
            try expectEqual(requests[0]["consent"] as? Bool, true, "Plan permission was not requested")
            try await expectAsyncThrows(CredentialStorageError.self) {
                _ = try await client.signIn(accountID: "", authorize: { _ in false })
            }
            try expectEqual(requests.count, 1, "Empty selection reached the owner")
            _ = try await client.signIn(
                accountID: "chosen-registration", addingAccount: true, authorize: { _ in false })
            try expect(requests[1]["accountId"] == nil, "Explicit Add reused an existing registration")
        },
        CheckCase("connections: stored names upgrade once without losing identity or conflicting originals") {
            directory in
            let url = directory.appendingPathComponent("settings.json")
            let original = Data(
                #"{"modelPresets":{"revision":7,"providers":[{"key":"personal","name":"Personal","kind":"chatgpt-plan","accountId":"account-one"}],"presets":[{"id":"c14b29f3-3ec2-4efc-8bed-e05531aef2cb","name":"Saved","model":"saved-model","effort":"","fast":false,"providerKey":"personal"}]},"appearance":{"theme":"dark"}}"#
                    .utf8)
            try original.write(to: url)
            let store = SharedPresetsStore(url: url)
            let saved = try store.read()
            try expectEqual(saved.revision, 7, "Upgrade changed the editor revision")
            try expectEqual(saved.presets[0].connectionKey, "personal", "Upgrade lost the preset binding")
            try expectEqual(saved.connections[0].accountId, "account-one", "Upgrade lost the account")
            let upgraded = try Data(contentsOf: url)
            try expect(
                !String(decoding: upgraded, as: UTF8.self).contains("providerKey"), "Old field survived")
            _ = try store.read()
            try expectEqual(try Data(contentsOf: url), upgraded, "Unchanged read rewrote settings")
            guard var conflict = try JSONSerialization.jsonObject(with: original) as? [String: Any],
                var library = conflict["modelPresets"] as? [String: Any]
            else { throw CheckFailure("Invalid settings fixture") }
            library["connections"] = []
            conflict["modelPresets"] = library
            let conflicting = try JSONSerialization.data(withJSONObject: conflict)
            try conflicting.write(to: url)
            try expectThrows(EZError.self) { _ = try store.read() }
            try expectEqual(try Data(contentsOf: url), conflicting, "Conflicting original was overwritten")
            let malformed = Data(
                #"{"apps":"invalid","modelPresets":{"revision":0,"presets":[],"providers":[]}}"#.utf8)
            try malformed.write(to: url)
            try expectThrows(EZError.self) { _ = try store.read() }
            try expectEqual(try Data(contentsOf: url), malformed, "Malformed app scope was discarded")
        },
        CheckCase("connections: history upgrades only connection fields and rolls back conflicting snapshots")
        { directory in
            let store = try HistoryStore(directory: directory)
            var entry = HistoryEntry(
                mode: .ask, query: "Saved", model: "saved-model", effort: "", requestedServiceTier: nil)
            entry.connectionSnapshot = ConnectionDefinition(
                key: "personal", name: "Personal", kind: .chatGPTPlan, accountId: "account-one")
            try store.append(entry)
            _ = try historySQL(
                store.url,
                "UPDATE ez_entry SET data=json_remove(json_set(data,'$.providerSnapshot',json_extract(data,'$.connectionSnapshot'),'$.inputValues.providerKey','literal input'),'$.connectionSnapshot')"
            )
            _ = try historySQL(store.url, "PRAGMA user_version=3")
            let reopened = try HistoryStore(directory: directory)
            let restored = try reopened.load()[0]
            try expectEqual(restored.connectionSnapshot?.accountId, "account-one", "History identity changed")
            try expectEqual(restored.inputValues?["providerKey"], "literal input", "User input was renamed")
            try expectEqual(
                try historySQL(store.url, "PRAGMA user_version"), "4", "History upgrade was not recorded")
            _ = try historySQL(
                store.url,
                "UPDATE ez_entry SET data=json_set(data,'$.providerSnapshot',json_extract(data,'$.connectionSnapshot'))"
            )
            _ = try historySQL(store.url, "PRAGMA user_version=3")
            let before = try historySQL(store.url, "SELECT data FROM ez_entry")
            try expectThrows(EZError.self) { _ = try HistoryStore(directory: directory) }
            try expectEqual(
                try historySQL(store.url, "SELECT data FROM ez_entry"), before,
                "Failed upgrade rewrote history")
            try expectEqual(
                try historySQL(store.url, "PRAGMA user_version"), "3", "Failed upgrade advanced schema")
        },
        CheckCase(
            "connections: live catalogs retain last good data and distinguish removal from failed refresh"
        ) { directory in
            var response = "{\"data\":[{\"id\":\"gpt-future\"},{\"id\":\"gpt-image-future\"}]}"
            let http = HTTPFixture { request in
                try expectEqual(request.url?.path, "/v1/models", "Catalog used a generation route")
                try expectEqual(request.httpMethod, "GET", "Catalog generated output")
                return HTTPReply(response)
            }
            defer { http.close() }
            let connection = try credentialConnection(directory: directory, http: http)
            @MainActor func catalog(force: Bool) async throws -> ConnectionCatalog {
                let reply = try await connection.call([
                    "action": "connection-catalog", "connectionKey": "openai-api", "force": force,
                ])
                return try JSONDecoder().decode(
                    ConnectionCatalog.self, from: JSONSerialization.data(withJSONObject: reply["catalog"]!))
            }
            let first = try await catalog(force: false)
            try expectEqual(
                first.models.map(\.id), ["gpt-future", "gpt-image-future"],
                "New models were filtered by a fixed list")
            _ = try await catalog(force: false)
            try expectEqual(http.requests.count, 1, "Fresh catalog was fetched again")
            response = "malformed"
            let stale = try await catalog(force: true)
            try expect(stale.error != nil, "Failed refresh was hidden")
            try expectEqual(stale.models, first.models, "Failed refresh erased valid models")
            try expect(stale.issue(model: "gpt-future") == nil, "Network failure implied removal")
            response = "{\"data\":[]}"
            let empty = try await catalog(force: true)
            try expect(
                empty.error == nil && empty.fetchedAt > 0,
                "Valid empty catalog was treated as a fetch failure")
            try expect(
                empty.issue(model: "gpt-future")?.contains("no longer available") == true,
                "Removed model stayed available")
            let requestsBeforeRun = http.requests.count
            try await expectAsyncThrows(CredentialStorageError.self) {
                _ = try await connection.call([
                    "action": "api-chat", "connectionKey": "openai-api", "model": "gpt-future",
                    "systemPrompt": "", "userPrompt": "Do not send this after model removal.",
                ])
            }
            try expectEqual(http.requests.count, requestsBeforeRun, "Removed model reached generation")
        },
        CheckCase("connections: endpoint keys stay separate and removal cannot retarget an identity") {
            directory in
            let definitions = [
                ConnectionDefinition(
                    key: "custom", name: "Local", kind: .openAIAPI, baseUrl: "http://localhost:11434/v1")
            ]
            let http = HTTPFixture { request in
                try expectEqual(request.url?.host, "localhost", "Custom key reached another host")
                try expectEqual(
                    request.value(forHTTPHeaderField: "Authorization"), "Bearer synthetic-custom",
                    "Wrong connection key")
                return HTTPReply("{\"data\":[{\"id\":\"new-local-model\"}]}")
            }
            defer { http.close() }
            let connection = try credentialConnection(
                directory: directory, http: http, definitions: definitions)
            _ = try await connection.call([
                "action": "connection-key-save", "connectionKey": "custom",
                "endpoint": definitions[0].endpoint, "key": "synthetic-custom",
            ])
            let status = try await connection.call(["action": "connection-status", "connectionKey": "custom"])
            let encoded = String(decoding: try JSONSerialization.data(withJSONObject: status), as: UTF8.self)
            try expect(
                !encoded.contains("synthetic-custom") && encoded.contains("stom"),
                "Status leaked a key or lost the suffix")
            _ = try await connection.call(["action": "connection-catalog", "connectionKey": "custom"])
            _ = try await connection.call([
                "action": "connection-key-remove", "connectionKey": "custom",
                "endpoint": definitions[0].endpoint,
            ])
            try await expectAsyncThrows(CredentialStorageError.self) {
                _ = try await connection.call([
                    "action": "connection-key-save", "connectionKey": "custom",
                    "endpoint": "https://example.test/v1", "key": "different",
                ])
            }
            try expectEqual(http.requests.count, 1, "Setup or removal unexpectedly contacted a provider")
        },
        CheckCase("connections: presets keep fixed account identity across rename and reject retargeting") {
            directory in
            let store = SharedPresetsStore(url: directory.appendingPathComponent("settings.json"))
            var connections = ConnectionDefinition.defaults
            connections[0].accountId = "account-one"
            let first = try store.save([], revision: 0, connections: connections)
            connections[0].name = "Personal"
            let renamed = try store.save([], revision: first.revision, connections: connections)
            connections[0].accountId = "account-two"
            try expectThrows(EZError.self) {
                _ = try store.save([], revision: renamed.revision, connections: connections)
            }
            try expectEqual(
                try store.read().connections[0].accountId, "account-one", "Failed edit changed identity")
            connections = try store.read().connections
            connections[1].baseUrl = "https://elsewhere.test/v1"
            try expectThrows(EZError.self) {
                _ = try store.save([], revision: renamed.revision, connections: connections)
            }
        },
        CheckCase("speech: native preview requires completed audio and produces a playable WAV") { _ in
            var audio = SpeechAudio()
            try expect(try audio.consume(["type": "session.created"]) == nil, "Session created output")
            _ = try audio.consume([
                "type": "response.output_audio.delta", "delta": Data([0, 0, 1, 0]).base64EncodedString(),
            ])
            let wav = try audio.consume(["type": "response.done", "response": ["status": "completed"]])
            try expectEqual(wav?.count, 48, "WAV framing changed")
            try expectEqual(
                wav.map { String(decoding: $0.prefix(4), as: UTF8.self) }, "RIFF", "Audio was not WAV")
            var failed = SpeechAudio()
            _ = try failed.consume(["type": "session.created"])
            try expectThrows(EZError.self) {
                _ = try failed.consume(["type": "response.done", "response": ["status": "failed"]])
            }
            try expectThrows(EZError.self) {
                _ = try failed.consume(["type": "response.output_audio.delta", "delta": "invalid base64"])
            }
        },
    ]
}
