import Foundation
import SaulNativeValues

public enum OpenAIHTTP {
  public static func form(_ values: [String: String]) -> Data {
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
    return Data(
      values.sorted(by: { $0.key < $1.key }).map {
        "\($0.key.addingPercentEncoding(withAllowedCharacters: allowed)!)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed)!)"
      }.joined(separator: "&").utf8)
  }
  public static func json(_ request: URLRequest, session: URLSession = .shared) async throws
    -> [String:
    Any]
  {
    let (data, response) = try await session.data(for: request)
    guard let response = response as? HTTPURLResponse else {
      throw OwnerRequestError("Invalid HTTP response.")
    }
    guard (200..<300).contains(response.statusCode) else {
      throw APIError.parse(data: data, response: response)
    }
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw OwnerRequestError("Invalid JSON response.")
    }
    return object
  }
}
