import EZCore
import SwiftUI

/// Shared, pinned footer for the displayed lookup in both native surfaces.
struct LookupStatusLine: View {
    let entry: HistoryEntry

    var body: some View {
        ViewThatFits(in: .horizontal) {
            Text(summary(compact: false)).fixedSize()
            Text(summary(compact: true)).fixedSize()
        }
        .font(AppStyle.caption.monospacedDigit())
        .foregroundStyle(AppStyle.secondaryText)
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
        .help(explanation)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(summary(compact: false))
        .accessibilityHint(explanation)
    }

    private func summary(compact: Bool) -> String {
        let metrics = entry.metrics
        let input = count(metrics?.inputTokens, compact: compact)
        let thinking = count(metrics?.reasoningTokens, compact: compact)
        let response = count(metrics?.responseTokens, compact: compact)
        let ttft = metrics?.timeToFirstTokenSeconds.map { String(format: "%.2f s", $0) } ?? "—"
        let rate = metrics?.tokensPerSecond.map { String(format: "%.1f", $0) } ?? "—"
        if compact {
            return "I \(input) · T \(thinking) · R \(response) · TTFT \(ttft) · \(rate) t/s"
        }
        return
            "In \(input) · Think \(thinking) · Response \(response) · TTFT \(ttft) · \(rate) tok/s"
    }

    private func count(_ value: Int?, compact: Bool) -> String {
        guard let value else { return "—" }
        if compact && value >= 1_000_000 { return String(format: "%.1fM", Double(value) / 1_000_000) }
        if compact && value >= 1_000 { return String(format: "%.1fk", Double(value) / 1_000) }
        return value.formatted()
    }

    private var explanation: String {
        "Input, thinking, and response token counts come from OpenAI usage. "
            + "Response = output minus reasoning; it may include formatting tokens. "
            + "TTFT measures HTTP request start to first nonempty answer/refusal text delta, including network time and thinking. "
            + "Tokens/s = response tokens ÷ (HTTP stream seconds − TTFT); waiting and thinking before first text are excluded. "
            + "A dash means the value was not reported or observed. Plan allowance is available through Manage usage in Settings."
    }
}
