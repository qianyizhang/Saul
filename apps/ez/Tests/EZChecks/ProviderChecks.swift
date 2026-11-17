import EZCheckSupport
import EZCore
import Foundation
import SaulCredentialStorage

@MainActor private func recordingGeneration(
    _ receive: @escaping ([String: Any]) throws -> Void
) -> SaulGeneration {
    SaulGeneration(
        connection: SaulConnection { frame in
            var frames = NativeFrames()
            guard let payload = try frames.append(frame).first,
                let request = try JSONSerialization.jsonObject(with: payload) as? [String: Any],
                let id = request["id"] as? String, let value = request["request"] as? [String: Any]
            else { throw CheckFailure("Malformed generation frame") }
            _ = try CredentialRequest.decode(payload, caller: .ez)
            try receive(value)
            let reply: [[String: Any]]
            if value["action"] as? String == "native-image" {
                reply = [["type": "result", "imageBase64": fixturePNG.base64EncodedString()]]
            } else {
                reply = [
                    [
                        "type": "response-event", "elapsed": 0.1,
                        "data": #"{"type":"response.output_text.delta","delta":"Result"}"#,
                    ],
                    [
                        "type": "response-event", "elapsed": 0.2,
                        "data": #"{"type":"response.completed","response":{"status":"completed"}}"#,
                    ],
                    ["type": "complete"],
                ]
            }
            let events = try reply.map {
                try JSONSerialization.data(withJSONObject: ["id": id, "event": $0])
            }
            return NativeCredentialReplies(
                stream: AsyncThrowingStream { continuation in
                    for event in events { continuation.yield(event) }
                    continuation.finish()
                }, close: {})
        })
}

@MainActor func providerChecks() -> [CheckCase] {
    [
        CheckCase(
            "connections: frozen adapter rejects unsupported actions and unavailable routes before owner"
        ) {
            _ in
            let plan = ConnectionDefinition(
                key: "bound-plan", name: "Bound Plan", kind: .chatGPTPlan, accountId: "fixture-account")
            let local = ConnectionDefinition(
                key: "local", name: "Local", kind: .openAIAPI, baseUrl: "https://local.example.test")
            let emptyPlan = ConnectionDefinition(key: "unbound-plan", name: "Unbound", kind: .chatGPTPlan)
            let provider = recordingGeneration { _ in
                throw CheckFailure("Unsupported operation reached owner")
            }
            let prompt = HistoryEntry(
                mode: .ask, query: "Hi", model: "test", effort: "", requestedServiceTier: nil)
            var invalid = [
                prompt,
                prompt.withConnection(plan, capability: .draw),
                prompt.withConnection(local, capability: .draw),
                prompt.withConnection(plan, capability: .speak),
                prompt.withConnection(emptyPlan),
            ]
            for connection in [plan, local] {
                var search = prompt.withConnection(connection)
                search.actionSnapshot = Action(
                    name: "Search", presetID: UUID(), template: "{{text}}", webSearch: true)
                invalid.append(search)
            }
            var mismatched = prompt.withConnection(plan)
            mismatched.connectionSnapshot = local
            invalid.append(mismatched)
            var unexpectedFast = prompt.withConnection(plan)
            unexpectedFast.requestedServiceTier = "priority"
            invalid.append(unexpectedFast)
            unexpectedFast.status = "failed"
            try expectThrows(EZError.self) {
                _ = try unexpectedFast.prepareRetry(connection: plan, image: nil)
            }
            for entry in invalid {
                try await expectAsyncThrows(EZError.self) {
                    _ = try await provider.generate(entry: entry) { _ in }
                }
            }
        },
        CheckCase("connections: one signed request preserves the frozen plan or API binding and tier") { _ in
            let plan = ConnectionDefinition(
                key: "bound-plan", name: "Bound Plan", kind: .chatGPTPlan, accountId: "fixture-account")
            let custom = ConnectionDefinition(
                key: "bound-api", name: "Bound API", kind: .openAIAPI, baseUrl: "https://compatible.test/v1")
            var requests: [[String: Any]] = []
            let provider = recordingGeneration { requests.append($0) }
            for connection in [plan, ConnectionDefinition.defaults[1], custom] {
                var entry = HistoryEntry(
                    mode: .ask, query: "Frozen prompt", model: "frozen-model", effort: "medium",
                    requestedServiceTier: "priority"
                ).withConnection(connection)
                entry.instructions = "Frozen instructions"
                let output = try await provider.generate(entry: entry) { _ in }
                guard case .text(let result) = output, result.text == "Result", result.completed,
                    let request = requests.last, let body = request["body"] as? [String: Any]
                else { throw CheckFailure("A frozen Write did not produce text") }
                try expectEqual(
                    request["action"] as? String, "native-responses", "Wrong generation operation")
                try expectEqual(
                    request["provider"] as? String, connection.kind.rawValue, "Billing route changed")
                try expectEqual(request["connectionKey"] as? String, connection.key, "Connection changed")
                try expectEqual(request["accountId"] as? String, connection.accountId, "Registration changed")
                try expectEqual(body["model"] as? String, entry.model, "Model changed")
                try expectEqual(body["service_tier"] as? String, "priority", "Requested tier changed")
                try expectEqual(body["instructions"] as? String, entry.instructions, "Instructions changed")
                try expectEqual(
                    (body["input"] as? [[String: String]])?.first?["content"], entry.query, "Prompt changed")
            }
            try expectEqual(requests.count, 3, "Adapter sent more than one request per frozen run")
        },
        CheckCase("connections: signed Draw carries frozen settings and exact input bytes") { _ in
            var request: [String: Any]?
            let provider = recordingGeneration {
                try expect(request == nil, "Draw sent a second request")
                request = $0
            }
            var entry = HistoryEntry(
                mode: .ask, query: "Frozen caption", model: "gpt-image-2.6-flare", effort: "",
                requestedServiceTier: nil
            ).withConnection(capability: .draw)
            entry.presetSnapshot?.imageOptions = ImageOptions(size: "1536x1024", quality: "high")
            entry.inputImage = try ImageAttachment(data: fixturePNG, name: "saved.png")
            guard case .image(let data) = try await provider.generate(entry: entry, onUpdate: { _ in })
            else { throw CheckFailure("Draw returned text") }
            try expectEqual(data, fixturePNG, "Draw response bytes changed")
            try expectEqual(request?["action"] as? String, "native-image", "Wrong Draw route")
            try expectEqual(request?["connectionKey"] as? String, "openai-api", "Draw lost API binding")
            try expectEqual(request?["prompt"] as? String, "Frozen caption", "Draw lost prompt")
            try expectEqual(request?["size"] as? String, "1536x1024", "Draw lost size")
            try expectEqual(request?["quality"] as? String, "high", "Draw lost quality")
            try expectEqual(
                request?["imageBase64"] as? String, fixturePNG.base64EncodedString(), "Draw lost input")
        },
        CheckCase("connections: missing shared API key blocks without an HTTP fallback") { directory in
            let fixture = HTTPFixture { _ in throw CheckFailure("Unconfigured provider reached HTTP") }
            defer { fixture.close() }
            let entry = HistoryEntry(
                mode: .ask, query: "Hi", model: "test", effort: "", requestedServiceTier: nil
            )
            .withConnection()
            try await expectAsyncThrows(CredentialStorageError.self) {
                _ = try await credentialText(directory: directory, http: fixture, key: nil, entry: entry) {
                    _ in
                }
            }
            try expectEqual(fixture.requests.count, 0, "Missing key sent a request")
        },
    ]
}
