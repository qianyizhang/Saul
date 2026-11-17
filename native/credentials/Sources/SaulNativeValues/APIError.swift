import Foundation

public struct APIError: LocalizedError {
  public let status: Int
  public let code: String?
  public let message: String
  public let requestID: String?
  public init(status: Int, code: String?, message: String, requestID: String?) {
    self.status = status
    self.code = code
    self.message = message
    self.requestID = requestID
  }
  public var errorDescription: String? {
    var text = message
    if code == "subscription_sharing_usage_limit_exceeded" {
      text += " Manage your app allowance in ChatGPT Settings → Usage."
    }
    if let code { text += " [\(code)]" }
    if let requestID { text += " Request: \(requestID)" }
    return text
  }
  public static func parse(data: Data, response: HTTPURLResponse) -> APIError {
    let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    let nested = body["error"] as? [String: Any] ?? [:]
    let code = nested["code"] as? String ?? body["error"] as? String
    let message =
      nested["message"] as? String ?? body["error_description"] as? String ?? body["detail"]
      as? String
      ?? "OpenAI returned HTTP \(response.statusCode)."
    return APIError(
      status: response.statusCode, code: code, message: String(message.prefix(2000)),
      requestID: response.value(forHTTPHeaderField: "x-request-id"))
  }
}
