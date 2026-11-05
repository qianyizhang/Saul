import Foundation

public enum ActionCapability: String, Codable, CaseIterable, Sendable {
    case write, draw, speak
    public var name: String { rawValue.capitalized }
}

public struct ConnectionDefinition: Codable, Equatable, Identifiable, Sendable {
    public let key: String
    public var name: String
    public let kind: GenerationProviderID
    public var accountId: String?
    public var baseUrl: String?
    public var endpoint: String { baseUrl ?? "https://api.openai.com/v1" }
    public var id: String { key }
    public var capabilities: [ActionCapability] {
        kind == .chatGPTPlan || endpoint != "https://api.openai.com/v1" ? [.write] : [.write, .draw, .speak]
    }
    public init(
        key: String, name: String, kind: GenerationProviderID, accountId: String? = nil,
        baseUrl: String? = nil
    ) {
        self.key = key
        self.name = name
        self.kind = kind
        self.accountId = accountId
        self.baseUrl = baseUrl
    }
    private enum CodingKeys: String, CodingKey, CaseIterable { case key, name, kind, accountId, baseUrl }
    public init(from decoder: Decoder) throws {
        let fields = try contractFields(decoder, keys: CodingKeys.self)
        key = try fields.decode(String.self, forKey: .key)
        name = try fields.decode(String.self, forKey: .name)
        kind = try fields.decode(GenerationProviderID.self, forKey: .kind)
        accountId = try fields.decodeIfPresent(String.self, forKey: .accountId)
        baseUrl = try fields.decodeIfPresent(String.self, forKey: .baseUrl)
    }
    public static let defaults = [
        ConnectionDefinition(key: "gpt-plan", name: "ChatGPT plan", kind: .chatGPTPlan),
        ConnectionDefinition(key: "openai-api", name: "OpenAI API", kind: .openAIAPI),
    ]
    public static func validate(_ values: [ConnectionDefinition]) throws {
        guard values.count <= 32, Set(values.map(\.key)).count == values.count,
            Set(values.map { $0.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }).count
                == values.count,
            values.allSatisfy({
                $0.key.range(of: "^[a-z][a-z0-9-]{0,63}$", options: .regularExpression) != nil
                    && !$0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    && $0.name.utf16.count <= 80
                    && ($0.accountId == nil
                        || ($0.kind == .chatGPTPlan && !$0.accountId!.isEmpty
                            && $0.accountId!.utf8.count <= 256))
                    && ($0.baseUrl == nil || ($0.kind == .openAIAPI && Self.validEndpoint($0.baseUrl!)))
            })
        else {
            throw EZError(
                "Connections need unique keys and names. Keys use lowercase letters, digits and hyphens.")
        }
    }
    public static func validEndpoint(_ value: String) -> Bool {
        guard value.utf8.count <= 2048, let url = URL(string: value), let host = url.host, !host.isEmpty,
            url.absoluteString == value, host == host.lowercased(),
            !(url.scheme == "https" && url.port == 443), !(url.scheme == "http" && url.port == 80),
            url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
            !value.hasSuffix("/")
        else { return false }
        return url.scheme == "https"
            || (url.scheme == "http" && ["localhost", "127.0.0.1", "[::1]", "::1"].contains(host))
    }
}

public struct SpeechOptions: Codable, Equatable, Sendable {
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
    public static let formats = ["png", "gif"]
    public static let sizes = ["1024x1024", "1536x1024", "1024x1536"]
    public static let qualities = ["low", "medium", "high"]
    public var size: String
    public var quality: String
    public var outputFormat: String
    public init(size: String = "1024x1024", quality: String = "low", outputFormat: String = "png") {
        self.size = size
        self.quality = quality
        self.outputFormat = outputFormat
    }
    private enum CodingKeys: String, CodingKey, CaseIterable { case size, quality, outputFormat }
    public init(from decoder: Decoder) throws {
        let fields = try contractFields(decoder, keys: CodingKeys.self)
        size = try fields.decode(String.self, forKey: .size)
        quality = try fields.decode(String.self, forKey: .quality)
        outputFormat =
            fields.contains(.outputFormat) ? try fields.decode(String.self, forKey: .outputFormat) : "png"
    }
    public func validate() throws {
        guard ImageOptions.sizes.contains(size), ImageOptions.qualities.contains(quality),
            ImageOptions.formats.contains(outputFormat)
        else {
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
