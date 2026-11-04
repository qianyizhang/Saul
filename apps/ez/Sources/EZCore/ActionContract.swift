import Foundation

public enum ActionCapability: String, Codable, CaseIterable, Sendable {
    case write, draw, speak
    public var name: String { rawValue.capitalized }
}

public struct ProviderDefinition: Codable, Equatable, Identifiable, Sendable {
    public let key: String
    public var name: String
    public let kind: GenerationProviderID
    public var id: String { key }
    public var capabilities: [ActionCapability] { kind == .chatGPTPlan ? [.write] : [.write, .draw, .speak] }
    public init(key: String, name: String, kind: GenerationProviderID) {
        self.key = key
        self.name = name
        self.kind = kind
    }
    private enum CodingKeys: String, CodingKey, CaseIterable { case key, name, kind }
    public init(from decoder: Decoder) throws {
        let fields = try contractFields(decoder, keys: CodingKeys.self)
        key = try fields.decode(String.self, forKey: .key)
        name = try fields.decode(String.self, forKey: .name)
        kind = try fields.decode(GenerationProviderID.self, forKey: .kind)
    }
    public static let defaults = [
        ProviderDefinition(key: "gpt-plan", name: "ChatGPT plan", kind: .chatGPTPlan),
        ProviderDefinition(key: "openai-api", name: "OpenAI API", kind: .openAIAPI),
    ]
    public static func validate(_ values: [ProviderDefinition]) throws {
        guard values.count <= 32, Set(values.map(\.key)).count == values.count,
            Set(values.map { $0.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }).count
                == values.count,
            values.allSatisfy({
                $0.key.range(of: "^[a-z][a-z0-9-]{0,63}$", options: .regularExpression) != nil
                    && !$0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    && $0.name.utf16.count <= 80
            })
        else {
            throw EZError(
                "Providers need unique keys and names. Keys use lowercase letters, digits and hyphens.")
        }
    }
}

public struct SpeechOptions: Codable, Equatable, Sendable {
    public static let defaultModel = "gpt-realtime-2.1-mini"
    public static let voices = [
        "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar",
    ]
    public var voice: String
    public init(voice: String = "marin") { self.voice = voice }
    private enum CodingKeys: String, CodingKey, CaseIterable { case voice }
    public init(from decoder: Decoder) throws {
        let fields = try contractFields(decoder, keys: CodingKeys.self)
        voice = try fields.decode(String.self, forKey: .voice)
    }
    public func validate() throws {
        guard Self.voices.contains(voice) else {
            throw EZError("Choose a supported speech voice in Presets.")
        }
    }
}

public struct ImageOptions: Codable, Equatable, Sendable {
    public var size: String
    public var quality: String
    public init(size: String = "1024x1024", quality: String = "low") {
        self.size = size
        self.quality = quality
    }
    private enum CodingKeys: String, CodingKey, CaseIterable { case size, quality }
    public init(from decoder: Decoder) throws {
        let fields = try contractFields(decoder, keys: CodingKeys.self)
        size = try fields.decode(String.self, forKey: .size)
        quality = try fields.decode(String.self, forKey: .quality)
    }
    public func validate() throws {
        guard ImageModelOption.sizes.contains(size), ImageModelOption.qualities.contains(quality) else {
            throw EZError("Choose a supported image size and quality in Presets.")
        }
    }
}

// Match the shared TypeScript boundary: unknown fields must not disappear on save.
private struct ContractKey: CodingKey {
    let stringValue: String
    var intValue: Int? { nil }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { return nil }
}
func contractFields<Key: CodingKey & CaseIterable>(_ decoder: Decoder, keys: Key.Type) throws
    -> KeyedDecodingContainer<Key>
{
    let raw = try decoder.container(keyedBy: ContractKey.self)
    let known = Set(Key.allCases.map(\.stringValue))
    guard raw.allKeys.allSatisfy({ known.contains($0.stringValue) }) else {
        throw DecodingError.dataCorrupted(
            .init(
                codingPath: decoder.codingPath,
                debugDescription: "Unsupported configuration fields. Original file preserved."))
    }
    return try decoder.container(keyedBy: keys)
}
