import CoreFoundation
import Foundation

/// The wire boundary has no token-read operation or caller-supplied destination URL.
public struct CredentialRequest {
  public let id: String
  public let action: String
  public let value: [String: Any]

  public static func decode(_ data: Data, caller: CredentialCaller) throws -> CredentialRequest {
    guard data.count <= NativeFrames.maximumInputBytes,
      let frame = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      Set(frame.keys) == ["version", "id", "request"],
      let version = frame["version"] as? NSNumber, CFGetTypeID(version) != CFBooleanGetTypeID(),
      version.doubleValue == 1,
      let id = frame["id"] as? String, !id.isEmpty, id.utf8.count <= 128,
      let value = frame["request"] as? [String: Any], let action = value["action"] as? String
    else { throw invalid() }
    let operations: [String: Set<String>] = [
      "accounts": [], "status": [], "select": ["accountId"],
      "login": ["accountId", "consent"], "logout": ["accountId"],
      "models": ["accountId"],
      "generate": [
        "accountId", "model", "effort", "fast", "systemPrompt", "userPrompt", "attachments",
      ],
      "api-key-status": [], "api-key-save": ["key"], "api-key-remove": [],
      "api-key-import": ["key", "selectedAccountId"],
      "api-chat": ["model", "systemPrompt", "userPrompt", "temperature", "maxTokens"],
      "api-realtime": ["model", "voice"],
      "native-responses": ["provider", "accountId", "body"],
      "native-image": ["prompt", "model", "size", "quality", "imageBase64", "imageName"],
      "migration-verified": [],
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
    for flag in ["consent", "fast"] where value[flag] != nil {
      guard let number = value[flag] as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID()
      else { throw invalid() }

    }
    if ["select", "logout", "models", "generate"].contains(action), !text("accountId", max: 256) {
      throw invalid()
    }
    if action == "login", !text("accountId", max: 256, required: false) { throw invalid() }
    if ["api-key-save", "api-key-import"].contains(action) {
      guard text("key", max: 512), let key = value["key"] as? String,
        key.utf8.allSatisfy({ $0 > 32 && $0 < 127 }),
        text("selectedAccountId", max: 256, required: false)
      else { throw invalid() }
    }
    if ["generate", "api-chat"].contains(action) {
      guard text("model", max: 256), text("systemPrompt", max: 400_000, empty: true),
        text("userPrompt", max: 800_000), text("effort", max: 64, required: false, empty: true)
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
    if action == "native-image" {
      guard text("prompt", max: 128_000), text("model", max: 256), text("size", max: 64),
        text("quality", max: 64),
        text("imageBase64", max: 28_000_000, required: false),
        text("imageName", max: 800, required: false)
      else { throw invalid() }
    }
    return CredentialRequest(id: id, action: action, value: value)
  }
  private static func invalid() -> CredentialStorageError {
    CredentialStorageError("Unsupported or invalid Saul credential operation.")
  }
}
