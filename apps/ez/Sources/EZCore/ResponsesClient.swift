import Foundation

/// Transient UI activity; no reasoning content is retained.
public enum ResponseActivity: Equatable, Sendable {
    case waiting, searching, thinking, responding, finished

    public var showsThinkingLight: Bool { self == .waiting || self == .searching || self == .thinking }
}

public struct ResponseAccumulator {
    public private(set) var text = ""
    public private(set) var completed = false
    public private(set) var citations: [WebCitation] = []
    public private(set) var webSearchCompleted = false
    public private(set) var activity: ResponseActivity = .waiting
    public internal(set) var metrics = ResponseMetrics()
    public private(set) var actualServiceTier: String?
    public init() {}
    public mutating func consume(_ data: Data, elapsedSeconds: Double? = nil) throws {
        guard let event = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let type = event["type"] as? String
        else { throw EZError("Malformed response event.") }
        if type == "response.output_text.annotation.added",
            let annotation = event["annotation"] as? [String: Any],
            let citation = WebCitation(annotation: annotation)
        {
            if !citations.contains(citation) { citations.append(citation) }
        }
        if type.hasPrefix("response.web_search_call.") && text.isEmpty {
            activity = .searching
        }
        if type == "response.output_item.done",
            let item = event["item"] as? [String: Any], item["type"] as? String == "web_search_call",
            item["status"] as? String == "completed",
            (item["action"] as? [String: Any])?["type"] as? String == "search"
        {
            webSearchCompleted = true
        }
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
            var finalCitations: [WebCitation] = []
            var offset = 0
            for item in output {
                if item["type"] as? String == "web_search_call",
                    item["status"] as? String == "completed",
                    (item["action"] as? [String: Any])?["type"] as? String == "search"
                {
                    webSearchCompleted = true
                }
                for part in item["content"] as? [[String: Any]] ?? [] {
                    let value =
                        part["type"] as? String == "output_text"
                        ? part["text"] as? String
                        : part["type"] as? String == "refusal" ? part["refusal"] as? String : nil
                    guard let value else { continue }
                    finalCitations += (part["annotations"] as? [[String: Any]] ?? []).compactMap {
                        WebCitation(annotation: $0, offset: offset)
                    }
                    offset += value.unicodeScalars.count + 2
                }
            }
            if !finalText.isEmpty { citations = finalCitations }
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
    public func requireCompleted(webSearchRequired: Bool = false) throws {
        if webSearchRequired && !webSearchCompleted {
            throw EZError(
                "OpenAI did not complete the required web search. The answer is incomplete; run again explicitly."
            )
        }
        guard completed else {
            throw EZError(
                "The stream ended before response.completed. The partial answer has been preserved.")
        }
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw EZError("OpenAI completed without a text answer.")
        }
    }
}

public enum ResponsesRequest {
    public static func body(entry: HistoryEntry) -> [String: Any] {
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
        if entry.usesWebSearch {
            body["tools"] = [["type": "web_search"]]
            body["tool_choice"] = "required"
        }
        return body
    }
}
