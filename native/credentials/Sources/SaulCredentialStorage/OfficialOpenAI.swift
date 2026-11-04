import Foundation

public enum OfficialOpenAIRoute: String, Sendable {
  case models, responses
  case chat = "chat/completions"
  case realtime = "realtime/client_secrets"
}

public struct CredentialHTTPError: LocalizedError, Sendable {
  public let status: Int
  public let code: String?
  public var errorDescription: String? {
    "OpenAI request failed (HTTP \(status)). Check the selected Saul connection and try again."
  }
  public init(status: Int, code: String? = nil) {
    self.status = status
    self.code = code
  }
}

/// Fixed official destinations keep an API key from being forwarded to an edited endpoint.
/// Provider error bodies never leave this owner, because they can echo credentials.
public struct OfficialOpenAI: Sendable {
  private let session: URLSession
  public init(session: URLSession? = nil) {
    if let session {
      self.session = session
    } else {
      let configuration = URLSessionConfiguration.ephemeral
      configuration.httpShouldSetCookies = false
      configuration.urlCache = nil
      configuration.timeoutIntervalForRequest = 60
      configuration.timeoutIntervalForResource = 180
      self.session = URLSession(configuration: configuration)
    }
  }
  public static func request(route: OfficialOpenAIRoute, body: Data?, credential: String) throws
    -> URLRequest
  {
    guard !credential.isEmpty, credential.utf8.count <= 32_000,
      credential.utf8.allSatisfy({ $0 > 32 && $0 < 127 })
    else { throw CredentialStorageError("The selected Saul credential is invalid. Connect again.") }
    var request = URLRequest(url: URL(string: "https://api.openai.com/v1/\(route.rawValue)")!)
    request.httpMethod = route == .models ? "GET" : "POST"
    request.httpBody = body
    request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
    return request
  }
  public func json(route: OfficialOpenAIRoute, body: Data? = nil, credential: String) async throws
    -> [String: Any]
  {
    let request = try Self.request(route: route, body: body, credential: credential)
    let (bytes, response) = try await session.bytes(for: request, delegate: NoCredentialRedirect())
    guard let response = response as? HTTPURLResponse else { throw CredentialHTTPError(status: 0) }
    var data = Data()
    for try await byte in bytes {
      try Task.checkCancellation()
      guard data.count < 2_000_000 else {
        throw CredentialStorageError("OpenAI returned an oversized reply.")
      }
      data.append(byte)
    }
    guard (200..<300).contains(response.statusCode) else {
      throw Self.failure(data, status: response.statusCode)
    }
    guard let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw CredentialStorageError("OpenAI returned an invalid reply.")
    }
    return result
  }
  public func stream(
    route: OfficialOpenAIRoute, body: Data, credential: String,
    onEvent: @MainActor @Sendable (Data, Double) async throws -> Bool
  ) async throws {
    let request = try Self.request(route: route, body: body, credential: credential)
    let start = ContinuousClock.now
    let (bytes, response) = try await session.bytes(for: request, delegate: NoCredentialRedirect())
    guard let response = response as? HTTPURLResponse else { throw CredentialHTTPError(status: 0) }
    guard (200..<300).contains(response.statusCode) else {
      var error = Data()
      for try await byte in bytes {
        error.append(byte)
        if error.count >= 32_768 { break }
      }
      throw Self.failure(error, status: response.statusCode)
    }
    var parser = CredentialSSE()
    for try await byte in bytes {
      try Task.checkCancellation()
      guard let event = try parser.append(byte) else { continue }
      let duration = start.duration(to: .now).components
      if try await onEvent(event, Double(duration.seconds) + Double(duration.attoseconds) / 1e18) {
        return
      }
    }
    try parser.requireComplete()
  }
  private static func failure(_ data: Data, status: Int) -> CredentialHTTPError {
    let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    let error = root?["error"] as? [String: Any]
    let code = (error?["code"] as? String).flatMap {
      $0.range(of: "^[a-z][a-z0-9_]{0,127}$", options: .regularExpression) == nil ? nil : $0
    }
    return CredentialHTTPError(status: status, code: code)
  }
}

public struct CredentialSSE {
  private var line = Data()
  private var event: [String] = []
  private var eventBytes = 0
  public init() {}
  public mutating func append(_ byte: UInt8) throws -> Data? {
    if byte != 10 {
      guard line.count < 2_000_000 else {
        throw CredentialStorageError("OpenAI event is too large.")
      }
      line.append(byte)
      return nil
    }
    if line.last == 13 { line.removeLast() }
    guard let value = String(data: line, encoding: .utf8) else {
      throw CredentialStorageError("OpenAI returned invalid UTF-8.")
    }
    line.removeAll(keepingCapacity: true)
    if value.isEmpty {
      guard !event.isEmpty else { return nil }
      defer {
        event.removeAll(keepingCapacity: true)
        eventBytes = 0
      }
      return Data(event.joined(separator: "\n").utf8)
    }
    if value.hasPrefix("data:") {
      var data = String(value.dropFirst(5))
      if data.hasPrefix(" ") { data.removeFirst() }
      eventBytes += data.utf8.count
      guard eventBytes <= 2_000_000 else {
        throw CredentialStorageError("OpenAI event is too large.")
      }
      event.append(data)
    }
    return nil
  }
  public func requireComplete() throws {
    guard line.isEmpty, event.isEmpty else {
      throw CredentialStorageError("OpenAI returned a truncated event.")
    }
  }
}

private final class NoCredentialRedirect: NSObject, URLSessionTaskDelegate, Sendable {
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
  ) { completionHandler(nil) }
}
