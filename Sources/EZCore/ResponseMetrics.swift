import CoreFoundation
import Foundation

/// Server-reported usage plus client-observed HTTP stream timing.
public struct ResponseMetrics: Codable, Equatable, Sendable {
    public var inputTokens: Int?
    public var reasoningTokens: Int?
    public var outputTokens: Int?
    public var timeToFirstTokenSeconds: Double?
    public var durationSeconds: Double?

    public init(
        inputTokens: Int? = nil, reasoningTokens: Int? = nil, outputTokens: Int? = nil,
        timeToFirstTokenSeconds: Double? = nil, durationSeconds: Double? = nil
    ) {
        self.inputTokens = inputTokens
        self.reasoningTokens = reasoningTokens
        self.outputTokens = outputTokens
        self.timeToFirstTokenSeconds = timeToFirstTokenSeconds
        self.durationSeconds = durationSeconds
    }

    /// Non-reasoning output includes any unitemized formatting tokens.
    public var responseTokens: Int? {
        guard let outputTokens, let reasoningTokens,
            outputTokens >= 0, reasoningTokens >= 0, outputTokens >= reasoningTokens
        else { return nil }
        return outputTokens - reasoningTokens
    }

    /// Average non-reasoning output throughput after the first visible answer/refusal text.
    public var tokensPerSecond: Double? {
        guard let responseTokens, let durationSeconds, let timeToFirstTokenSeconds,
            durationSeconds.isFinite, timeToFirstTokenSeconds.isFinite,
            timeToFirstTokenSeconds >= 0, durationSeconds > timeToFirstTokenSeconds
        else { return nil }
        return Double(responseTokens) / (durationSeconds - timeToFirstTokenSeconds)
    }

    mutating func recordUsage(_ usage: [String: Any]) {
        func count(_ value: Any?) -> Int? {
            guard let number = value as? NSNumber,
                CFGetTypeID(number) != CFBooleanGetTypeID(),
                let value = Int(number.stringValue), value >= 0
            else { return nil }
            return value
        }
        inputTokens = count(usage["input_tokens"])
        outputTokens = count(usage["output_tokens"])
        reasoningTokens = count((usage["output_tokens_details"] as? [String: Any])?["reasoning_tokens"])
    }
}
