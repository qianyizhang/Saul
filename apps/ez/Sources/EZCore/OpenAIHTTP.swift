import Foundation

public struct APIError: LocalizedError {
    public let status: Int
    public let code: String?
    public let message: String
    public let requestID: String?
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
            nested["message"] as? String ?? body["error_description"] as? String ?? body["detail"] as? String
            ?? "OpenAI returned HTTP \(response.statusCode)."
        return APIError(
            status: response.statusCode, code: code, message: String(message.prefix(2000)),
            requestID: response.value(forHTTPHeaderField: "x-request-id"))
    }
}

public enum OpenAIHTTP {
    public static func form(_ values: [String: String]) -> Data {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        return Data(
            values.sorted(by: { $0.key < $1.key }).map {
                "\($0.key.addingPercentEncoding(withAllowedCharacters: allowed)!)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed)!)"
            }.joined(separator: "&").utf8)
    }
    public static func json(_ request: URLRequest, session: URLSession = .shared) async throws -> [String:
        Any]
    {
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw EZError("Invalid HTTP response.") }
        guard (200..<300).contains(response.statusCode) else {
            throw APIError.parse(data: data, response: response)
        }
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw EZError("Invalid JSON response.")
        }
        return object
    }
}
