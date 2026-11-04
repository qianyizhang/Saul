import EZCheckSupport
import Foundation

@testable import EZCore

@MainActor func searchImageChecks() -> [CheckCase] {
    [
        CheckCase("search: required tool, search completion, citations and follow-up survive history") {
            directory in
            var config = Configuration.starters(model: "fixture", effort: "low", fast: false)
            config.addSearchAndMeme()
            let action = config.actions.first { $0.webSearch }!
            let preset = config.presets.first { $0.id == action.presetID }!
            var entry = try action.prepare(values: ["Question": "Recent news?"], preset: preset, models: [])
            entry.providerSnapshot = ProviderDefinition.defaults[1]
            let fixture = HTTPFixture { request in
                guard
                    let body = try JSONSerialization.jsonObject(with: requestData(request)) as? [String: Any]
                else { throw CheckFailure("No request body") }
                try expectEqual(body["tool_choice"] as? String, "required", "Search was optional")
                try expectEqual(
                    (body["tools"] as? [[String: String]])?.first?["type"], "web_search", "Wrong tool")
                return HTTPReply(searchEvents)
            }
            defer { fixture.close() }
            var activity: [ResponseActivity] = []
            let response = try await ResponsesClient(session: fixture.session).stream(
                entry: entry, token: "synthetic"
            ) {
                activity.append($0.activity)
            }
            try expect(activity.contains(.searching), "Search progress missing")
            try expect(
                response.webSearchCompleted && response.citations.count == 1,
                "Search or citations not recorded")
            entry.response = response.text
            entry.citations = response.citations
            entry.webSearchCompleted = response.webSearchCompleted
            entry.status = "completed"
            let history = try HistoryStore(directory: directory)
            try history.append(entry)
            let saved = try history.load().entries[0]
            try expectEqual(
                saved.citedResponse, "😀 [News](https://example.com/news)", "Unicode citation shifted")
            let followUp = try saved.prepareFollowUp("What changed?", models: [])
            try expect(followUp.usesWebSearch, "Follow-up lost required search policy")
            try expect(
                followUp.instructions?.contains("Never use tools") == false, "Search follow-up forbids search"
            )
            try expectEqual(fixture.requests.count, 1, "Unexpected automatic requests")
        },
        CheckCase("search: missing or failed search cannot produce successful completion") { _ in
            for output in [
                [], [["type": "web_search_call", "status": "failed", "action": ["type": "search"]]],
            ] as [[[String: Any]]] {
                var response = ResponseAccumulator()
                try response.consume(
                    try JSONSerialization.data(withJSONObject: [
                        "type": "response.completed",
                        "response": [
                            "status": "completed",
                            "output": output + [
                                ["content": [["type": "output_text", "text": "Unverified"]]]
                            ],
                        ],
                    ]))
                try expectThrows(EZError.self, matching: { $0.message.contains("required web search") }) {
                    try response.requireCompleted(webSearchRequired: true)
                }
            }
            let provider = GenerationProvider.chatGPTPlan(accessToken: {
                throw CheckFailure("Credential resolved before rejecting search")
            })
            var entry = HistoryEntry(
                mode: .ask, query: "hello", model: "test", effort: "", requestedServiceTier: nil)
            entry.actionSnapshot = Action(
                name: "Search", presetID: UUID(), template: "{{text}}", webSearch: true)
            try await expectAsyncThrows(EZError.self) {
                _ = try await provider.streamText(entry: entry) { _ in }
            }
        },
        CheckCase("search: unsafe citation URLs and invalid offsets cannot create executable links") { _ in
            try expect(
                WebCitation(annotation: [
                    "type": "url_citation", "url": "javascript:alert(1)", "start_index": 0, "end_index": 2,
                ]) == nil, "Unsafe URL accepted")
            let citation = WebCitation(annotation: [
                "type": "url_citation", "url": "https://example.com/", "title": "Source", "start_index": 500,
                "end_index": 501,
            ])!
            try expect(
                WebCitation.markdown("Short", citations: [citation]).contains(
                    "[Source](https://example.com/)"), "Invalid offset hid source")
        },
        CheckCase("image input: edit transport carries exact bytes and normal Draw stays generation") { _ in
            let image = try ImageAttachment(data: fixturePNG, name: "sketch.png")
            let fixture = HTTPFixture { request in
                try expectEqual(request.url?.path, "/v1/images/edits", "Input image used generation endpoint")
                try expect(
                    request.value(forHTTPHeaderField: "Content-Type")?.hasPrefix(
                        "multipart/form-data; boundary=") == true, "Edit is not multipart")
                let body = requestData(request)
                try expect(body.range(of: fixturePNG) != nil, "Image bytes changed")
                let header = String(decoding: body, as: UTF8.self)
                try expect(
                    header.contains("name=\"image[]\"; filename=\"input\"")
                        && header.contains("Content-Type: image/png"), "Image part missing")
                try expect(header.contains("caption 中文"), "Instructions lost")
                return HTTPReply("{\"data\":[{\"b64_json\":\"\(fixturePNG.base64EncodedString())\"}]}")
            }
            defer { fixture.close() }
            let result = try await ImagesClient(session: fixture.session).generate(
                ImageGenerationRequest(prompt: "caption 中文", image: image), apiKey: "sk-synthetic")
            try expectEqual(result, fixturePNG, "Edited PNG changed")
            try expectEqual(fixture.requests.count, 1, "Edit automatically retried")
        },
        CheckCase("image input: history saves source separately, restores it and deletes both images") {
            directory in
            let store = try HistoryStore(directory: directory)
            var entry = HistoryEntry(
                mode: .ask, query: "meme", model: "test", effort: "", requestedServiceTier: nil)
            entry.inputImage = try ImageAttachment(data: fixturePNG, name: "my sketch.png")
            entry.imageData = fixturePNG
            entry.imageFile = entry.id.uuidString.lowercased() + ".png"
            try store.append(entry)
            let json = try String(contentsOf: store.url, encoding: .utf8)
            try expect(!json.contains(fixturePNG.base64EncodedString()), "Image bytes entered JSONL")
            let saved = try store.load().entries[0]
            try expect(saved.inputImage?.data == nil, "Metadata decoded bytes")
            try expectEqual(try store.inputImage(for: saved)?.data, fixturePNG, "Input image not restored")
            try store.delete(id: entry.id)
            try expect(
                try FileManager.default.contentsOfDirectory(
                    atPath: directory.appendingPathComponent("images").path
                ).isEmpty, "Delete left an owned image")
        },
        CheckCase("image input: invalid and oversized inputs fail locally and source symlinks are rejected") {
            directory in
            try expectThrows(EZError.self) {
                _ = try ImageAttachment(data: Data("not an image".utf8), name: "fake.png")
            }
            try expectThrows(EZError.self) {
                _ = try ImageAttachment(
                    data: Data(repeating: 0, count: ImageAttachment.byteLimit + 1), name: "huge.png")
            }
            let store = try HistoryStore(directory: directory)
            var entry = HistoryEntry(
                mode: .ask, query: "meme", model: "test", effort: "", requestedServiceTier: nil)
            entry.inputImage = try ImageAttachment(data: fixturePNG, name: "sketch.png")
            try store.append(entry)
            let saved = try store.load().entries[0]
            let input = directory.appendingPathComponent(
                "images/" + entry.id.uuidString.lowercased() + "-input")
            try FileManager.default.removeItem(at: input)
            let outside = directory.appendingPathComponent("outside.png")
            try fixturePNG.write(to: outside)
            try FileManager.default.createSymbolicLink(at: input, withDestinationURL: outside)
            try expectThrows(EZError.self) { _ = try store.inputImage(for: saved) }
            try expectEqual(try Data(contentsOf: outside), fixturePNG, "External image changed")
        },
        CheckCase("actions: seed once, preserve edited or removed starters and decode old actions") { _ in
            var config = Configuration.starters(model: "fixture", effort: "low", fast: false)
            let originals = config.actions
            config.addSearchAndMeme()
            try expect(config.actions.starts(with: originals), "Existing actions replaced")
            config.actions.removeAll { $0.webSearch }
            let before = config
            try expect(!config.addSearchAndMeme() && config == before, "Removed starter returned")
            let old =
                "{\"id\":\"\(UUID())\",\"name\":\"Old\",\"presetID\":\"\(UUID())\",\"template\":\"{{text}}\"}"
            let action = try JSONDecoder().decode(Action.self, from: Data(old.utf8))
            try expect(!action.webSearch && action.imageInput == nil, "Old action behavior changed")
        },
    ]
}

private let searchEvents = """
    data: {"type":"response.web_search_call.searching"}

    data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"web_search_call","status":"completed","action":{"type":"search"}},{"type":"message","content":[{"type":"output_text","text":"😀 News","annotations":[{"type":"url_citation","start_index":2,"end_index":6,"url":"https://example.com/news","title":"News source"}]}]}]}}


    """

private func requestData(_ request: URLRequest) -> Data {
    if let body = request.httpBody { return body }
    guard let stream = request.httpBodyStream else { return Data() }
    stream.open()
    defer { stream.close() }
    var result = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)
    while stream.hasBytesAvailable {
        let count = stream.read(&buffer, maxLength: buffer.count)
        guard count > 0 else { break }
        result.append(contentsOf: buffer.prefix(count))
    }
    return result
}
