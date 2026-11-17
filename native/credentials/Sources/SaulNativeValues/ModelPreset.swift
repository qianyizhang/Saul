import Foundation

public struct ModelPreset: Codable, Equatable, Identifiable, Sendable {
  public var id: UUID
  public var name: String
  public var model: String
  public var effort: String
  public var fast: Bool
  public var connectionKey: String
  public var capability: ActionCapability
  public var imageOptions: ImageOptions?
  public var speechOptions: SpeechOptions?

  public init(
    id: UUID = UUID(), name: String, model: String, effort: String, fast: Bool,
    connectionKey: String = "gpt-plan", capability: ActionCapability = .write,
    imageOptions: ImageOptions? = nil, speechOptions: SpeechOptions? = nil
  ) {
    self.id = id
    self.name = name
    self.model = model
    self.effort = effort
    self.fast = fast
    self.connectionKey = connectionKey
    self.capability = capability
    self.imageOptions = imageOptions
    self.speechOptions = speechOptions
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case id, name, model, effort, fast, connectionKey, capability, imageOptions, speechOptions
  }
  public init(from decoder: Decoder) throws {
    let c = try contractFields(decoder, keys: CodingKeys.self)
    id = try c.decode(UUID.self, forKey: .id)
    name = try c.decode(String.self, forKey: .name)
    model = try c.decode(String.self, forKey: .model)
    effort = try c.decode(String.self, forKey: .effort)
    fast = try c.decode(Bool.self, forKey: .fast)
    connectionKey =
      c.contains(.connectionKey) ? try c.decode(String.self, forKey: .connectionKey) : "gpt-plan"
    capability =
      c.contains(.capability) ? try c.decode(ActionCapability.self, forKey: .capability) : .write
    imageOptions =
      c.contains(.imageOptions) ? try c.decode(ImageOptions.self, forKey: .imageOptions) : nil
    speechOptions =
      c.contains(.speechOptions) ? try c.decode(SpeechOptions.self, forKey: .speechOptions) : nil
  }
}
