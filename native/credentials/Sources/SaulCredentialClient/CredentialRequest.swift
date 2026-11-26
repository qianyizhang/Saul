import CoreFoundation
import Foundation

public enum CredentialCaller: String, Sendable { case saul, ez }

public enum CredentialCatalogIntent: String, Sendable {
  case display, refresh, check
}

/// No token-read operation. Setup binds endpoints; generation cannot choose another destination.
public struct CredentialRequest: Sendable {
  public static let version = 2
  public let id: String
  public let operation: CredentialOperation
  public let caller: CredentialCaller
  public let setupToken: UUID?
  public let runGeneration: String?

  public static func decode(_ data: Data, caller: CredentialCaller) throws -> CredentialRequest {
    guard data.count <= NativeFrames.maximumInputBytes,
      let frame = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      Set(frame.keys) == ["version", "id", "request"],
      let version = frame["version"] as? NSNumber, CFGetTypeID(version) != CFBooleanGetTypeID(),
      version.doubleValue == 1 || version.doubleValue == Double(Self.version),
      let id = frame["id"] as? String, !id.isEmpty, id.utf8.count <= 128,
      let value = frame["request"] as? [String: Any], let action = value["action"] as? String
    else { throw invalid() }
    let operations: [String: Set<String>] = [
      "accounts": [], "status": [], "select": ["accountId"],
      "login": ["accountId", "consent", "suggestedAppName", "setupToken"],
      "logout": ["accountId", "setupToken"],
      "confirm-app-name": ["accountId", "suggestedAppName", "setupToken"],
      "models": ["accountId"],
      "connection-capabilities": [],
      "connection-setups": [],
      "connection-run-hold": ["connectionKey", "accountId"],
      "connection-setup-hold": ["connectionKey", "accountId", "operationId", "previousToken"],
      "connection-setup-release": ["connectionKey", "token"],
      "generate": [
        "accountId", "model", "effort", "fast", "systemPrompt", "userPrompt", "attachments",
        "images", "connectionKey", "runGeneration",
      ],
      "api-key-status": [], "api-key-save": ["key"], "api-key-remove": [],
      "connection-status": ["connectionKey"],
      "connection-catalog": ["connectionKey", "force", "intent"],
      "connection-key-save": ["connectionKey", "endpoint", "key", "setupToken"],
      "connection-key-remove": ["connectionKey", "endpoint", "setupToken"],
      "connection-key-status": ["connectionKey", "endpoint"],
      "api-chat": [
        "model", "systemPrompt", "userPrompt", "temperature", "maxTokens", "connectionKey",
        "images", "runGeneration",
      ],
      "api-realtime": ["model", "voice", "connectionKey", "runGeneration"],
      "native-responses": ["provider", "accountId", "body", "connectionKey", "runGeneration"],
      "native-image": [
        "prompt", "model", "size", "quality", "outputFormat", "imageBase64", "imageName",
        "connectionKey", "runGeneration",
      ],
      "api-image": [
        "prompt", "model", "size", "quality", "outputFormat", "connectionKey", "runGeneration",
      ],
    ]
    guard let fields = operations[action],
      Set(value.keys).subtracting(["action"]).isSubset(of: fields)
    else {
      throw invalid()
    }
    if caller == .saul && action.hasPrefix("native-") { throw invalid() }
    func text(_ key: String, max: Int, required: Bool = true, empty: Bool = false) -> Bool {
      guard let raw = value[key] else { return !required }
      guard let text = raw as? String else { return false }
      return (empty || !text.isEmpty) && text.utf8.count <= max
    }
    for flag in ["consent", "fast", "force"] where value[flag] != nil {
      guard let number = value[flag] as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID()
      else { throw invalid() }

    }
    if let intent = value["intent"] {
      guard version.doubleValue == Double(Self.version), value["force"] == nil,
        let intent = intent as? String, CredentialCatalogIntent(rawValue: intent) != nil
      else { throw invalid() }
    }
    let optionalConnectionKey = [
      "connection-capabilities", "connection-setups", "connection-run-hold",
    ]
    if (action.hasPrefix("connection-") && !optionalConnectionKey.contains(action))
      || value["connectionKey"] != nil
    {
      guard text("connectionKey", max: 64),
        (value["connectionKey"] as? String)?.range(
          of: "^[a-z][a-z0-9-]{0,63}$", options: .regularExpression) != nil
      else { throw invalid() }
    }
    if ["connection-key-save", "connection-key-remove", "connection-key-status"].contains(action) {
      guard text("endpoint", max: 2048),
        action != "connection-key-save" || text("key", max: 512, empty: true)
      else { throw invalid() }
    }
    if ["select", "logout", "models", "generate", "confirm-app-name"].contains(action),
      !text("accountId", max: 256)
    {
      throw invalid()
    }
    if ["login", "connection-run-hold", "connection-setup-hold"].contains(action),
      !text("accountId", max: 256, required: false)
    {
      throw invalid()
    }
    if action == "connection-run-hold", value["connectionKey"] == nil, value["accountId"] == nil {
      throw invalid()
    }
    for field in ["setupToken", "previousToken", "operationId", "token"] where value[field] != nil {
      guard let token = value[field] as? String, UUID(uuidString: token) != nil else {
        throw invalid()
      }
    }
    if let raw = value["runGeneration"] {
      guard let generation = raw as? String,
        generation.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
      else { throw invalid() }
    }
    if ([
      "connection-capabilities", "connection-setups", "connection-run-hold",
      "connection-setup-hold",
      "connection-setup-release",
    ].contains(action) || value["setupToken"] != nil || value["runGeneration"] != nil)
      && version.doubleValue != Double(Self.version)
    {
      throw invalid()
    }
    if let raw = value["suggestedAppName"] {
      guard version.doubleValue == Double(Self.version),
        action != "login" || value["accountId"] == nil,
        let name = raw as? String, name.utf8.count == 17,
        name.range(of: "^Saul [0-9A-F]{12}$", options: .regularExpression) != nil
      else { throw invalid() }
    }
    if action == "api-key-save" {
      guard text("key", max: 512), let key = value["key"] as? String,
        key.utf8.allSatisfy({ $0 > 32 && $0 < 127 })
      else { throw invalid() }
    }
    if ["generate", "api-chat"].contains(action) {
      guard text("model", max: 256), text("systemPrompt", max: 400_000, empty: true),
        text("userPrompt", max: 800_000), text("effort", max: 64, required: false, empty: true)
      else { throw invalid() }
    }
    if let images = value["images"] {
      guard let images = images as? [String], images.count == 1,
        images.allSatisfy({ image in
          image.utf8.count <= 450_000
            && image.range(
              of: "^data:image/jpeg;base64,[A-Za-z0-9+/]+=*$", options: .regularExpression) != nil
        })
      else { throw invalid() }
    }
    if let attachments = value["attachments"] {
      guard let attachments = attachments as? [[String: Any]], attachments.count == 1,
        attachments.allSatisfy({ item in
          guard Set(item.keys) == ["type", "url"], item["type"] as? String == "pdf-url",
            let raw = item["url"] as? String, raw.utf8.count <= 16_384, let url = URL(string: raw)
          else { return false }
          return ["http", "https"].contains(url.scheme) && url.user == nil && url.password == nil
        })
      else { throw invalid() }
    }
    if action == "api-chat" {
      if let max = value["maxTokens"] {
        guard let max = max as? NSNumber, CFGetTypeID(max) != CFBooleanGetTypeID(),
          max.doubleValue.isFinite, max.doubleValue.rounded() == max.doubleValue,
          (1...1_000_000).contains(max.intValue)
        else { throw invalid() }
      }
      if let temperature = value["temperature"] {
        guard let number = temperature as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
          number.doubleValue.isFinite, (0...2).contains(number.doubleValue)
        else { throw invalid() }
      }
    }
    if action == "api-realtime" {
      guard text("model", max: 256), text("voice", max: 64),
        (value["model"] as? String)?.range(
          of: "^gpt-realtime(?:-[a-z0-9.]+)*$", options: .regularExpression) != nil,
        ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"]
          .contains(value["voice"] as? String ?? "")
      else { throw invalid() }
    }
    if action == "native-responses" {
      guard ["chatgpt-plan", "openai-api"].contains(value["provider"] as? String ?? ""),
        let body = value["body"] as? [String: Any],
        Set(body.keys).isSubset(of: [
          "model", "input", "instructions", "store", "stream", "reasoning", "service_tier", "tools",
          "tool_choice",
        ]),
        let model = body["model"] as? String, !model.isEmpty, model.utf8.count <= 256,
        let input = body["input"] as? [[String: Any]], !input.isEmpty, input.count <= 200,
        let store = body["store"] as? NSNumber, CFGetTypeID(store) == CFBooleanGetTypeID(),
        !store.boolValue,
        let stream = body["stream"] as? NSNumber, CFGetTypeID(stream) == CFBooleanGetTypeID(),
        stream.boolValue,
        value["provider"] as? String != "chatgpt-plan"
          || (text("accountId", max: 256) && body["tools"] == nil)
      else { throw invalid() }
      guard
        input.allSatisfy({ item in
          guard Set(item.keys) == ["role", "content"],
            ["user", "assistant", "system", "developer"].contains(item["role"] as? String ?? ""),
            let text = item["content"] as? String, text.utf8.count <= 800_000
          else { return false }
          return true
        }),
        body["instructions"] == nil
          || (body["instructions"] as? String).map({ $0.utf8.count <= 400_000 }) == true,
        body["service_tier"] == nil
          || (body["service_tier"] as? String)?.range(
            of: "^[a-z][a-z0-9_-]{0,63}$", options: .regularExpression) != nil
      else { throw invalid() }
      if let reasoning = body["reasoning"] {
        guard let reasoning = reasoning as? [String: Any], Set(reasoning.keys) == ["effort"],
          let effort = reasoning["effort"] as? String, !effort.isEmpty, effort.utf8.count <= 64
        else { throw invalid() }
      }
      if let tools = body["tools"] {
        guard let tools = tools as? [[String: String]], tools == [["type": "web_search"]],
          body["tool_choice"] as? String == "required"
        else { throw invalid() }
      } else if body["tool_choice"] != nil {
        throw invalid()
      }
    }
    if action == "native-image" || action == "api-image" {
      guard text("prompt", max: 128_000), text("model", max: 256), text("size", max: 64),
        text("quality", max: 64),
        value["outputFormat"] == nil
          || ["png", "gif"].contains(value["outputFormat"] as? String ?? ""),
        text("imageBase64", max: 28_000_000, required: false),
        text("imageName", max: 800, required: false)
      else { throw invalid() }
    }
    return CredentialRequest(
      id: id, operation: try operation(action, value), caller: caller,
      setupToken: (value["setupToken"] as? String).flatMap(UUID.init(uuidString:)),
      runGeneration: value["runGeneration"] as? String)

  }

  private static func operation(_ action: String, _ value: [String: Any]) throws
    -> CredentialOperation
  {
    let key = value["connectionKey"] as? String
    let account = value["accountId"] as? String
    func string(_ field: String, from fields: [String: Any]? = nil) throws -> String {
      guard let text = (fields ?? value)[field] as? String else { throw invalid() }
      return text
    }
    func id(_ field: String) throws -> UUID {
      guard let id = try UUID(uuidString: string(field)) else { throw invalid() }
      return id
    }
    switch action {
    case "connection-capabilities": return .connectionCapabilities
    case "connection-setups": return .connectionSetups
    case "connection-run-hold": return .connectionRunHold(key: key, accountID: account)
    case "connection-setup-hold":
      return try .connectionSetupHold(
        key: string("connectionKey"), accountID: account, operationID: id("operationId"),
        previousToken: (value["previousToken"] as? String).flatMap(UUID.init(uuidString:)))
    case "connection-setup-release":
      return try .connectionSetupRelease(key: string("connectionKey"), token: id("token"))
    case "accounts": return .accounts
    case "status": return .status
    case "select": return try .select(accountID: string("accountId"))
    case "login":
      return .login(
        accountID: account, consent: value["consent"] as? Bool == true,
        suggestedAppName: value["suggestedAppName"] as? String)
    case "confirm-app-name":
      return try .confirmAppName(accountID: string("accountId"), name: string("suggestedAppName"))
    case "logout": return try .logout(accountID: string("accountId"))
    case "models": return try .models(accountID: string("accountId"))
    case "generate":
      return try .generate(
        .init(
          accountID: string("accountId"), connectionKey: key, model: string("model"),
          effort: value["effort"] as? String, fast: value["fast"] as? Bool == true,
          systemPrompt: string("systemPrompt"), userPrompt: string("userPrompt"),
          images: value["images"] as? [String] ?? [],
          pdfURLs: (value["attachments"] as? [[String: String]] ?? []).compactMap { $0["url"] }))
    case "api-key-status": return .apiKeyStatus
    case "api-key-save", "api-key-remove": return .apiKey(value["key"] as? String)
    case "connection-status": return try .connectionStatus(key: string("connectionKey"))
    case "connection-catalog":
      let supplied = (value["intent"] as? String).flatMap(CredentialCatalogIntent.init(rawValue:))
      return try .connectionCatalog(
        key: string("connectionKey"),
        intent: supplied ?? (value["force"] as? Bool == true ? .refresh : .display),
        includeDefault: supplied != nil)
    case "connection-key-status":
      return try .connectionKeyStatus(id: string("connectionKey"), endpoint: string("endpoint"))
    case "connection-key-save", "connection-key-remove":
      return try .connectionKey(
        id: string("connectionKey"), endpoint: string("endpoint"), key: value["key"] as? String)
    case "api-chat":
      return try .apiChat(
        .init(
          model: string("model"), connectionKey: key,
          systemPrompt: string("systemPrompt"), userPrompt: string("userPrompt"),
          images: value["images"] as? [String], temperature: value["temperature"] as? Double ?? 0.3,
          maxTokens: value["maxTokens"] as? Int ?? 1024))
    case "api-realtime":
      return try .apiRealtime(model: string("model"), voice: string("voice"), connectionKey: key)
    case "native-responses":
      guard let body = value["body"] as? [String: Any],
        let roles = body["input"] as? [[String: Any]]
      else { throw invalid() }
      return try .nativeResponses(
        .init(
          route: value["provider"] as? String == "chatgpt-plan"
            ? .plan(accountID: string("accountId")) : .api,
          connectionKey: key, model: string("model", from: body),
          instructions: body["instructions"] as? String,
          input: roles.map {
            try .init(role: string("role", from: $0), content: string("content", from: $0))
          },
          effort: (body["reasoning"] as? [String: String])?["effort"],
          tier: body["service_tier"] as? String, usesWebSearch: body["tools"] != nil,
          providerBody: JSONSerialization.data(withJSONObject: body)))
    case "native-image", "api-image":
      return try .image(
        .init(
          model: string("model"), connectionKey: key,
          prompt: string("prompt"), size: string("size"),
          quality: string("quality"), outputFormat: value["outputFormat"] as? String ?? "png",
          imageBase64: value["imageBase64"] as? String, imageName: value["imageName"] as? String))
    default: throw invalid()
    }
  }

  private static func invalid() -> CredentialStorageError {
    CredentialStorageError("Unsupported or invalid Saul credential operation.")
  }
}
