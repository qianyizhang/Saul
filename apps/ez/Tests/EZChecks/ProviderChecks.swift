import EZCheckSupport
import EZCore
import Foundation

private actor ProviderKeyFixture: OpenAIKeyStorage {
    var reads = 0
    let key: String?
    init(_ key: String?) { self.key = key }
    func read() -> String? {
        reads += 1
        return key
    }
    func write(_ key: String?) {}
}

@MainActor func providerChecks() -> [CheckCase] {
    [
        CheckCase("providers: plan exposes Responses and rejects images before reading credentials") { _ in
            var credentialReads = 0
            let provider = GenerationProvider.chatGPTPlan(accessToken: {
                credentialReads += 1
                return "oauth-fixture"
            })
            try expectEqual(provider.id, .chatGPTPlan, "Plan identity changed")
            try expectEqual(provider.capabilities, [.write], "Plan advertises unsupported capability")
            try await expectAsyncThrows(
                EZError.self, matching: { $0.localizedDescription.contains("Choose OpenAI API explicitly") }
            ) {
                _ = try await provider.generateImage(ImageGenerationRequest(prompt: "Tree"))
            }
            try expectEqual(credentialReads, 0, "Unsupported operation read OAuth credentials")
        },
        CheckCase("providers: both providers route text through Responses with their own credentials") { _ in
            let keyStore = ProviderKeyFixture("sk-fixture")
            for isPlan in [true, false] {
                let fixture = HTTPFixture { request in
                    try expectEqual(request.url?.path, "/v1/responses", "Wrong text transport")
                    try expectEqual(
                        request.value(forHTTPHeaderField: "Authorization"),
                        "Bearer \(isPlan ? "oauth-fixture" : "sk-fixture")", "Credential owner switched")
                    return HTTPReply(
                        "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[{\"content\":[{\"type\":\"output_text\",\"text\":\"OK\"}]}]}}\n\n"
                    )
                }
                defer { fixture.close() }
                let responses = ResponsesClient(session: fixture.session)
                let provider =
                    isPlan
                    ? GenerationProvider.chatGPTPlan(accessToken: { "oauth-fixture" }, responses: responses)
                    : GenerationProvider.openAIAPI(keyStore: keyStore, responses: responses)
                let result = try await provider.streamText(
                    entry: HistoryEntry(
                        mode: .ask, query: "Hi", model: "test", effort: "", requestedServiceTier: nil),
                    onUpdate: { _ in })
                try expectEqual(result.text, "OK", "Text result changed")
                try expectEqual(fixture.requests.count, 1, "Text request repeated")
                try expectEqual(
                    provider.capabilities, isPlan ? [.write] : [.write, .draw],
                    "Capabilities disagree with operations")
            }
            let reads = await keyStore.reads
            try expectEqual(reads, 1, "Plan read API credentials or API did not resolve its key")
        },
        CheckCase("providers: missing API key and invalid image inputs never fall back") { _ in
            let keys = ProviderKeyFixture(nil)
            let fixture = HTTPFixture { _ in throw CheckFailure("Unconfigured provider reached HTTP") }
            defer { fixture.close() }
            let provider = GenerationProvider.openAIAPI(
                keyStore: keys, images: ImagesClient(session: fixture.session))
            try await expectAsyncThrows(
                EZError.self, matching: { $0.localizedDescription.contains("Save an OpenAI API key") }
            ) {
                _ = try await provider.generateImage(ImageGenerationRequest(prompt: "Tree"))
            }
            try await expectAsyncThrows(EZError.self) {
                _ = try await provider.generateImage(ImageGenerationRequest(prompt: ""))
            }
            let reads = await keys.reads
            try expectEqual(reads, 1, "Invalid input read credentials")
            try expectEqual(fixture.requests.count, 0, "Missing key sent a request")
        },
    ]
}
