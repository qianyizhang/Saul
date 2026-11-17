import Foundation

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
