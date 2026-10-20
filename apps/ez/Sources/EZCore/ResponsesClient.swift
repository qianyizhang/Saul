import Foundation

/// Preserve the empty lines that delimit SSE events, including fragmented UTF-8.
public struct SSELineDecoder {
    private var buffer = Data()
    public init() {}
    public mutating func feed(_ byte: UInt8) throws -> String? {
        if byte != 0x0A {
            guard buffer.count < 2_000_000 else {
                throw EZError("Response event exceeded the supported size.")
            }
            buffer.append(byte)
            return nil
        }
        if buffer.last == 0x0D { buffer.removeLast() }
        defer { buffer.removeAll(keepingCapacity: true) }
        guard let line = String(data: buffer, encoding: .utf8) else {
            throw EZError("Invalid UTF-8 in response stream.")
        }
        return line
    }
}

public struct SSEParser {
    private var dataLines: [String] = []
    public init() {}
    public mutating func feed(_ line: String) -> Data? {
        if line.isEmpty {
            guard !dataLines.isEmpty else { return nil }
            defer { dataLines.removeAll() }
            return Data(dataLines.joined(separator: "\n").utf8)
        }
        if line.hasPrefix("data:") {
            var value = String(line.dropFirst(5))
            if value.hasPrefix(" ") { value.removeFirst() }
            dataLines.append(value)
        }
        return nil
    }
}

/// Transient UI activity; no reasoning content is retained.
public enum ResponseActivity: Equatable, Sendable {
    case waiting, thinking, responding, finished

    public var showsThinkingLight: Bool { self == .waiting || self == .thinking }
}

public struct ResponseAccumulator {
    public private(set) var text = ""
    public private(set) var completed = false
    public private(set) var activity: ResponseActivity = .waiting
    public internal(set) var metrics = ResponseMetrics()
    public private(set) var actualServiceTier: String?
    public init() {}
    public mutating func consume(_ data: Data, elapsedSeconds: Double? = nil) throws {
        guard let event = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let type = event["type"] as? String
        else { throw EZError("Malformed response event.") }
        if type == "response.output_item.added",
            let item = event["item"] as? [String: Any], item["type"] as? String == "reasoning",
            text.isEmpty
        {
            activity = .thinking
        }
        if ["response.output_text.delta", "response.refusal.delta"].contains(type),
            let delta = event["delta"] as? String
        {
            if !delta.isEmpty && metrics.timeToFirstTokenSeconds == nil {
                metrics.timeToFirstTokenSeconds = elapsedSeconds
            }
            if !delta.isEmpty { activity = .responding }
            text += delta
        }
        if ["response.completed", "response.failed", "response.incomplete", "error"].contains(type) {
            activity = .finished
        }
        if ["response.completed", "response.failed", "response.incomplete"].contains(type) {
            let response = event["response"] as? [String: Any] ?? [:]
            if let usage = response["usage"] as? [String: Any] { metrics.recordUsage(usage) }
            metrics.durationSeconds = elapsedSeconds
        }
        if type == "response.completed" {
            let response = event["response"] as? [String: Any] ?? [:]
            guard response["status"] as? String == "completed" else {
                throw EZError("Response did not complete successfully.")
            }
            let output = response["output"] as? [[String: Any]] ?? []
            let finalText = output.flatMap { $0["content"] as? [[String: Any]] ?? [] }.compactMap {
                part -> String? in
                if part["type"] as? String == "output_text" { return part["text"] as? String }
                if part["type"] as? String == "refusal" { return part["refusal"] as? String }
                return nil
            }.joined(separator: "\n\n")
            if !finalText.isEmpty { text = finalText }
            actualServiceTier = response["service_tier"] as? String
            completed = true
        }
        if ["response.failed", "response.incomplete", "error"].contains(type) {
            let response = event["response"] as? [String: Any] ?? [:]
            let error = response["error"] as? [String: Any] ?? event["error"] as? [String: Any] ?? event
            let code = error["code"] as? String
            let reason = (response["incomplete_details"] as? [String: Any])?["reason"] as? String
            throw APIError(
                status: 0, code: code,
                message: error["message"] as? String
                    ?? "Response incomplete\(reason.map { ": \($0)" } ?? ".")", requestID: nil)
        }
    }
    public func requireCompleted() throws {
        guard completed else {
            throw EZError(
                "The stream ended before response.completed. The partial answer has been preserved.")
        }
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw EZError("OpenAI completed without a text answer.")
        }
    }
}

@MainActor public final class ResponsesClient {
    private let session: URLSession
    public init(session: URLSession? = nil) {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 180
        self.session = session ?? URLSession(configuration: config)
    }
    public func models(token: String) async throws -> [ModelOption] {
        var request = URLRequest(url: URL(string: "https://api.openai.com/v1/models")!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let result = try await OpenAIHTTP.json(request, session: session)
        guard let models = result["models"] as? [[String: Any]] else {
            throw EZError("OpenAI returned an unexpected account model catalog.")
        }
        return models.compactMap(ModelOption.init(catalog:))
    }
    public static func requestBody(entry: HistoryEntry) -> [String: Any] {
        var body: [String: Any] = [
            "model": entry.model,
            "input": [["role": "user", "content": entry.query]], "store": false, "stream": true,
        ]
        let instructions = entry.instructions ?? entry.mode.instruction
        if !instructions.isEmpty { body["instructions"] = instructions }
        if !entry.effort.isEmpty { body["reasoning"] = ["effort": entry.effort] }
        // Codex's speed label is `fast`; the public Responses API tier is `priority`.
        body["service_tier"] =
            entry.requestedServiceTier == "fast" ? "priority" : entry.requestedServiceTier ?? "default"
        return body
    }
    public func stream(entry: HistoryEntry, token: String, onUpdate: (ResponseAccumulator) -> Void)
        async throws
        -> ResponseAccumulator
    {
        var request = URLRequest(url: URL(string: "https://api.openai.com/v1/responses")!)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONSerialization.data(withJSONObject: Self.requestBody(entry: entry))
        let clock = ContinuousClock()
        let start = clock.now
        var result = ResponseAccumulator()
        func elapsedSeconds() -> Double {
            let duration = start.duration(to: clock.now).components
            return Double(duration.seconds) + Double(duration.attoseconds) / 1e18
        }
        defer {
            // Publish partial metrics even when transport, parsing, or cancellation fails.
            if result.metrics.durationSeconds == nil { result.metrics.durationSeconds = elapsedSeconds() }
            onUpdate(result)
        }
        let (bytes, response) = try await session.bytes(for: request)
        guard let response = response as? HTTPURLResponse else { throw EZError("Invalid HTTP response.") }
        guard (200..<300).contains(response.statusCode) else {
            var data = Data()
            for try await byte in bytes {
                data.append(byte)
                if data.count >= 32768 { break }
            }
            throw APIError.parse(data: data, response: response)
        }
        var lines = SSELineDecoder()
        var parser = SSEParser()
        for try await byte in bytes {
            try Task.checkCancellation()
            guard let line = try lines.feed(byte) else { continue }
            guard let data = parser.feed(line), String(data: data, encoding: .utf8) != "[DONE]" else {
                continue
            }
            do { try result.consume(data, elapsedSeconds: elapsedSeconds()) } catch let error as APIError {
                throw APIError(
                    status: response.statusCode, code: error.code, message: error.message,
                    requestID: response.value(forHTTPHeaderField: "x-request-id"))
            }
            onUpdate(result)
            if result.completed { break }
        }
        try result.requireCompleted()
        return result
    }
}
