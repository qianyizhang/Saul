import Foundation

/// Validated commands at the signed owner's interface. Callers still send the existing JSON wire.
public enum CredentialOperation: Sendable {
  case accounts, status
  case select(accountID: String)
  case login(accountID: String?, consent: Bool, suggestedAppName: String?)
  case confirmAppName(accountID: String, name: String)
  case logout(accountID: String)
  case models(accountID: String)
  case connectionCapabilities
  case connectionRunHold(key: String?, accountID: String?)
  case connectionSetupHold(key: String, accountID: String?, operationID: UUID, previousToken: UUID?)
  case connectionSetups
  case connectionSetupRelease(key: String, token: UUID)
  case generate(PlanText)
  case apiKeyStatus
  case apiKey(String?)
  case connectionStatus(key: String)
  case connectionCatalog(key: String, intent: CredentialCatalogIntent, includeDefault: Bool)
  case connectionKeyStatus(id: String, endpoint: String)
  case connectionKey(id: String, endpoint: String, key: String?)
  case apiChat(APIChat)
  case apiRealtime(model: String, voice: String, connectionKey: String?)
  case nativeResponses(Responses)
  case image(Image)

  public struct PlanText: Sendable {
    public let accountID: String
    public let connectionKey: String?
    public let model: String
    public let effort: String?
    public let fast: Bool
    public let systemPrompt: String
    public let userPrompt: String
    public let images: [String]
    public let pdfURLs: [String]
  }

  public struct APIChat: Sendable {
    public let model: String
    public let connectionKey: String?
    public let systemPrompt: String
    public let userPrompt: String
    public let images: [String]?
    public let temperature: Double
    public let maxTokens: Int
  }

  public struct Responses: Sendable {
    public enum Route: Sendable {
      case plan(accountID: String)
      case api
    }

    public struct Message: Codable, Sendable {
      public let role: String
      public let content: String
    }

    public let route: Route
    public let connectionKey: String?
    public let model: String
    public let instructions: String?
    public let input: [Message]
    public let effort: String?
    public let tier: String?
    public let usesWebSearch: Bool
    public let providerBody: Data
  }

  public struct Image: Sendable {
    public let model: String
    public let connectionKey: String?
    public let prompt: String
    public let size: String
    public let quality: String
    public let outputFormat: String
    public let imageBase64: String?
    public let imageName: String?
  }
}
