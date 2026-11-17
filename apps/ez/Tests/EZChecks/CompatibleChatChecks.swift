import EZCheckSupport
import EZCore
import Foundation
import SaulCredentialStorage

private struct CompatibleChatContract: Decodable {
    struct Scenario: Decodable {
        let name: String
        let sse: String
        let text: String
        let outcome: Outcome
    }
    enum Outcome: String, Decodable { case completed, failed }
    let version: Int
    let cases: [Scenario]
}

private enum CompatibleChatRoute: String, CaseIterable {
    case browser = "api-chat"
    case native = "native-responses"

    static let connection = ConnectionDefinition(
        key: "compat", name: "Compatible", kind: .openAIAPI, baseUrl: "https://models.example.test/v1")

    var request: [String: Any] {
        if self == .browser {
            return [
                "action": rawValue, "model": "test", "systemPrompt": "System", "userPrompt": "Input",
                "connectionKey": Self.connection.key,
            ]
        }
        return [
            "action": rawValue, "provider": "openai-api", "connectionKey": Self.connection.key,
            "body": [
                "model": "test", "input": [["role": "user", "content": "Input"]],
                "instructions": "System", "store": false, "stream": true,
            ],
        ]
    }

    func update(_ event: [String: Any], text: inout String, completions: inout Int) throws {
        if self == .browser {
            guard event["type"] as? String == "delta", let delta = event["text"] as? String else {
                throw CheckFailure("Unexpected signed chat event")
            }
            text += delta
            return
        }
        guard event["type"] as? String == "response-event", let raw = event["data"] as? String,
            let json = try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any]
        else { throw CheckFailure("Unexpected native compatible event") }
        if json["type"] as? String == "response.completed" {
            try expectEqual((json["response"] as? [String: String])?["status"], "completed", "Native status")
            completions += 1
        } else if json["type"] as? String == "response.output_text.delta",
            let delta = json["delta"] as? String
        {
            text += delta
        } else {
            throw CheckFailure("Unexpected projected response event")
        }
    }

    @MainActor static func client(_ directory: URL, http: HTTPFixture) async throws -> SaulConnection {
        http.installModelCatalog(["test"])
        let client = try credentialConnection(directory: directory, http: http, definitions: [connection])
        _ = try await client.call([
            "action": "connection-key-save", "connectionKey": connection.key,
            "endpoint": connection.endpoint, "key": "fixture",
        ])
        return client
    }
}

@MainActor func compatibleChatChecks() -> [CheckCase] {
    CompatibleChatRoute.allCases.flatMap { route in
        [
            CheckCase("compatible chat: \(route.rawValue) shared completion contract") { directory in
                let fixture = URL(fileURLWithPath: #filePath)
                    .deletingLastPathComponent()
                    .appendingPathComponent("../../../../contracts/fixtures/compatible-chat.json")
                    .standardizedFileURL
                let contract = try JSONDecoder().decode(
                    CompatibleChatContract.self, from: Data(contentsOf: fixture))
                try expectEqual(contract.version, 1, "Unknown compatible chat contract")
                for scenario in contract.cases {
                    let http = HTTPFixture { request in
                        try expectEqual(request.url?.path, "/v1/chat/completions", "Wrong compatible route")
                        return HTTPReply(scenario.sse)
                    }
                    defer { http.close() }
                    let client = try await CompatibleChatRoute.client(directory, http: http)
                    var text = ""
                    var completed = false
                    var projections = 0
                    do {
                        let result = try await client.call(
                            route.request,
                            onEvent: { event in
                                try route.update(event, text: &text, completions: &projections)
                            })
                        completed = result["type"] as? String == "complete"
                    } catch let error as CheckFailure {
                        throw error
                    } catch {
                        if scenario.outcome == .completed { throw CheckFailure("\(scenario.name): \(error)") }
                    }
                    try expectEqual(text, scenario.text, scenario.name)
                    try expectEqual(completed, scenario.outcome == .completed, scenario.name)
                    try expectEqual(projections, route == .native && completed ? 1 : 0, scenario.name)
                    try expectEqual(http.requests.count, 1, "Compatible generation replayed")
                }
            },
            CheckCase("compatible chat: \(route.rawValue) Stop keeps partial text without completion") {
                directory in
                let http = HTTPFixture { _ in
                    HTTPReply(
                        "data: {\"choices\":[{\"delta\":{\"content\":\"Partial\"}}]}\n\n", finish: false)
                }
                defer { http.close() }
                let client = try await CompatibleChatRoute.client(directory, http: http)
                let shown = CheckSignal()
                var text = ""
                var completions = 0
                let task = Task {
                    _ = try await client.call(
                        route.request,
                        onEvent: { event in
                            try route.update(event, text: &text, completions: &completions)
                            Task { await shown.signal() }
                        })
                }
                defer { task.cancel() }
                try await shown.wait()
                task.cancel()
                try await expectAsyncThrows(CancellationError.self) { try await task.value }
                try expectEqual(text, "Partial", "Stop discarded partial text")
                try expectEqual(completions, 0, "Stop emitted a completed response")
                try expectEqual(http.requests.count, 1, "Stop replayed the request")
            },
        ]
    }
}
