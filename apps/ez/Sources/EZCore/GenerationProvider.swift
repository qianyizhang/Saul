import Foundation

public enum GenerationProviderID: String, Codable, Sendable {
    case chatGPTPlan = "chatgpt-plan"
    case openAIAPI = "openai-api"

    public var name: String {
        switch self {
        case .chatGPTPlan: return "ChatGPT plan"
        case .openAIAPI: return "OpenAI API"
        }
    }
}

public struct ImageModelOption: Identifiable, Sendable {
    public let id: String
    public let name: String
    public static let openAIModels = [
        ImageModelOption(id: "gpt-image-2.5-flare", name: "GPT Image 2.5 Flare"),
        ImageModelOption(id: "gpt-image-2.5-sunburst", name: "GPT Image 2.5 Sunburst"),
    ]
    public static let sizes = ["1024x1024", "1536x1024", "1024x1536"]
    public static let qualities = ["low", "medium", "high"]
}

/// Provider identity, credential resolution and supported operations have one owner.
/// Transport clients know HTTP; actions request a capability without receiving credentials.
@MainActor public final class GenerationProvider {
    public typealias TextOperation =
        @MainActor (
            HistoryEntry, String, @escaping @MainActor (ResponseAccumulator) -> Void
        ) async throws -> ResponseAccumulator
    public typealias ImageOperation =
        @MainActor (ImageGenerationRequest, String) async throws -> Data
    public let id: GenerationProviderID
    private let credential: @MainActor () async throws -> String
    private let textOperation: TextOperation?
    private let imageOperation: ImageOperation?

    public var capabilities: Set<ActionCapability> {
        var supported = Set<ActionCapability>()
        if textOperation != nil { supported.insert(.write) }
        if imageOperation != nil { supported.insert(.draw) }
        return supported
    }

    private init(
        id: GenerationProviderID, credential: @escaping @MainActor () async throws -> String,
        text: TextOperation?, image: ImageOperation? = nil
    ) {
        self.id = id
        self.credential = credential
        textOperation = text
        imageOperation = image
    }

    public static func chatGPTPlan(
        accessToken: @escaping @MainActor () async throws -> String,
        responses: ResponsesClient? = nil
    ) -> GenerationProvider {
        let client = responses ?? ResponsesClient()
        return GenerationProvider(
            id: .chatGPTPlan, credential: accessToken,
            text: { entry, key, update in
                try await client.stream(entry: entry, token: key, onUpdate: update)
            })
    }

    public static func openAIAPI(
        keyStore: any OpenAIKeyStorage, responses: ResponsesClient? = nil,
        images: ImagesClient = ImagesClient()
    ) -> GenerationProvider {
        let client = responses ?? ResponsesClient()
        return GenerationProvider(
            id: .openAIAPI,
            credential: {
                guard let key = try await keyStore.read() else {
                    throw EZError("Save an OpenAI API key in Providers before running.")
                }
                return try validatedOpenAIKey(key)
            },
            text: { entry, key, update in
                try await client.stream(entry: entry, token: key, onUpdate: update)
            },
            image: { try await images.generate($0, apiKey: $1) })
    }

    public func streamText(
        entry: HistoryEntry, onUpdate: @escaping @MainActor (ResponseAccumulator) -> Void
    ) async throws -> ResponseAccumulator {
        if entry.usesWebSearch && id != .openAIAPI {
            throw EZError("Web search requires OpenAI API. Choose an API Write preset explicitly.")
        }
        guard let textOperation else { throw EZError("\(id.name) does not support Responses.") }
        try Task.checkCancellation()
        let key = try await credential()
        try Task.checkCancellation()
        do { return try await textOperation(entry, key, onUpdate) } catch {
            if error.localizedDescription.contains(key) {
                throw EZError(error.localizedDescription.replacingOccurrences(of: key, with: "[redacted]"))
            }
            throw error
        }
    }

    public func generateImage(_ request: ImageGenerationRequest) async throws -> Data {
        guard let imageOperation else {
            throw EZError("\(id.name) does not support image generation. Choose OpenAI API explicitly.")
        }
        try request.validate()
        try Task.checkCancellation()
        let key = try await credential()
        try Task.checkCancellation()
        return try await imageOperation(request, key)
    }
}
