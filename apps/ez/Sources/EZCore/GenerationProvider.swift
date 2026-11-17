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
