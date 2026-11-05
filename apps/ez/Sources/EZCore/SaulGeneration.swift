import Foundation
import SaulCredentialStorage

extension GenerationProvider {
    public static func saul(
        _ id: GenerationProviderID, connection: SaulConnection = SaulConnection(),
        accountID: @escaping @MainActor () -> String? = { nil }
    ) -> GenerationProvider {
        let client = SaulGeneration(connection: connection, accountID: accountID)
        let text: TextOperation = { entry, update in
            try await client.stream(entry: entry, onUpdate: update)
        }
        let image: ImageOperation?
        if id == .openAIAPI { image = { request in try await client.image(request) } } else { image = nil }
        return GenerationProvider(
            id: id,
            text: text, image: image)
    }
}

@MainActor private struct SaulGeneration {
    let connection: SaulConnection
    let accountID: @MainActor () -> String?
    func stream(entry: HistoryEntry, onUpdate: @escaping @MainActor (ResponseAccumulator) -> Void)
        async throws -> ResponseAccumulator
    {
        let plan = entry.providerSnapshot?.kind != .openAIAPI
        var request: [String: Any] = [
            "action": "native-responses", "provider": plan ? "chatgpt-plan" : "openai-api",
            "body": ResponsesRequest.body(entry: entry),
        ]
        if plan {
            guard let account = accountID(), !account.isEmpty else {
                throw EZError("Choose a Saul ChatGPT account before running.")
            }
            request["accountId"] = account
        }
        var result = ResponseAccumulator()
        let start = ContinuousClock.now
        defer {
            if result.metrics.durationSeconds == nil {
                let duration = start.duration(to: .now).components
                result.metrics.durationSeconds =
                    Double(duration.seconds) + Double(duration.attoseconds) / 1e18
            }
            onUpdate(result)
        }
        _ = try await connection.call(
            request,
            onEvent: { event in
                guard event["type"] as? String == "response-event", let text = event["data"] as? String,
                    let elapsed = event["elapsed"] as? Double, elapsed.isFinite, elapsed >= 0
                else { throw EZError("Saul returned an invalid response event.") }
                try result.consume(Data(text.utf8), elapsedSeconds: elapsed)
                onUpdate(result)
            })
        try result.requireCompleted(webSearchRequired: entry.usesWebSearch)
        return result
    }
    func image(_ input: ImageGenerationRequest) async throws -> Data {
        try input.validate()
        var request: [String: Any] = [
            "action": "native-image", "prompt": input.prompt, "model": input.model,
            "size": input.size, "quality": input.quality, "outputFormat": input.outputFormat,
        ]
        if let image = input.image {
            request["imageBase64"] = try image.validatedData().base64EncodedString()
            request["imageName"] = image.name
        }
        let result = try await connection.call(request)
        guard let encoded = result["imageBase64"] as? String, let data = Data(base64Encoded: encoded),
            !data.isEmpty
        else {
            throw EZError("Saul returned an invalid image result.")
        }
        return data
    }
}
