import Foundation
import SaulCredentialClient
import SaulNativeValues

/// Sends a frozen EZ request through the signed owner. The adapter never reads
/// current preset choices or resolves an account or credential on its own.
@MainActor public struct SaulGeneration {
    private let owner: SaulConnection
    public init(connection: SaulConnection) { owner = connection }

    public func generate(
        entry: HistoryEntry, onUpdate: @escaping @MainActor (ResponseAccumulator) -> Void
    ) async throws -> AttemptExecution.Output {
        try Task.checkCancellation()
        guard entry.sourceID == nil, let preset = entry.presetSnapshot,
            let connection = entry.connectionSnapshot
        else { throw EZError("The action's connection snapshot is missing.") }
        guard connection.key == preset.connectionKey, entry.matchesFrozenPreset(preset)
        else { throw EZError("The saved request no longer matches its preset and connection.") }

        switch preset.capability {
        case .speak:
            throw EZError("Speak previews run in Settings → Presets.")
        case .write:
            if entry.usesWebSearch,
                connection.kind != .openAIAPI || connection.endpoint != "https://api.openai.com/v1"
            {
                throw EZError("Web search requires an official OpenAI API connection.")
            }
            return .text(try await write(entry, connection: connection, onUpdate: onUpdate))
        case .draw:
            guard connection.capabilities.contains(.draw) else {
                throw EZError("Draw requires an official OpenAI API connection.")
            }
            guard entry.actionSnapshot?.imageInput == nil || entry.inputImage != nil else {
                throw EZError("The saved request is missing its input image.")
            }
            let options = entry.imageOptions
            return .image(
                try await draw(
                    ImageGenerationRequest(
                        prompt: entry.query, model: entry.model, size: options.size, quality: options.quality,
                        outputFormat: options.outputFormat, image: entry.inputImage,
                        connectionKey: connection.key)))
        }
    }

    private func write(
        _ entry: HistoryEntry, connection: ConnectionDefinition,
        onUpdate: @escaping @MainActor (ResponseAccumulator) -> Void
    ) async throws -> ResponseAccumulator {
        var request: [String: Any] = [
            "action": "native-responses", "provider": connection.kind.rawValue,
            "connectionKey": connection.key, "body": ResponsesRequest.body(entry: entry),
        ]
        if connection.kind == .chatGPTPlan {
            guard let account = connection.accountId, !account.isEmpty else {
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
        _ = try await owner.call(
            request,
            onEvent: { event in
                guard event["type"] as? String == "response-event", let text = event["data"] as? String,
                    let elapsed = event["elapsed"] as? Double, elapsed.isFinite, elapsed >= 0
                else { throw EZError("Saul returned an invalid response event.") }
                try result.consume(Data(text.utf8), elapsedSeconds: elapsed)
                onUpdate(result)
            })
        return result
    }
    private func draw(_ input: ImageGenerationRequest) async throws -> Data {
        try input.validate()
        var request: [String: Any] = [
            "action": "native-image", "prompt": input.prompt, "model": input.model,
            "size": input.size, "quality": input.quality, "outputFormat": input.outputFormat,
        ]
        if let key = input.connectionKey { request["connectionKey"] = key }
        if let image = input.image {
            request["imageBase64"] = try image.validatedData().base64EncodedString()
            request["imageName"] = image.name
        }
        let result = try await owner.call(request)
        guard let encoded = result["imageBase64"] as? String, let data = Data(base64Encoded: encoded),
            !data.isEmpty
        else {
            throw EZError("Saul returned an invalid image result.")
        }
        return data
    }
}
