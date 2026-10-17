import EZCore
import SwiftUI

/// Optional footer when the quieter reading presentation is disabled.
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

/// Exact request and response information, shared by both reading surfaces.
struct LookupDetails: View {
    let entry: HistoryEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            LabeledContent("Created", value: entry.createdAt.formatted(date: .abbreviated, time: .shortened))
            LabeledContent("Model", value: entry.model)
            LabeledContent("Effort", value: entry.effort.isEmpty ? "Default" : entry.effort.capitalized)
            LabeledContent("Requested speed", value: entry.requestedServiceTier == nil ? "Standard" : "Fast")
            LabeledContent("Service tier", value: entry.actualServiceTier ?? "Not reported")
            Divider()
            LabeledContent("Input tokens", value: count(entry.metrics?.inputTokens))
            LabeledContent("Thinking tokens", value: count(entry.metrics?.reasoningTokens))
            LabeledContent("Answer tokens", value: count(entry.metrics?.responseTokens))
                .help("Output tokens minus reasoning tokens; may include formatting tokens.")
            LabeledContent("Time to first text", value: seconds(entry.metrics?.timeToFirstTokenSeconds))
                .help(
                    "From HTTP request start to the first nonempty answer or refusal text, including network time and thinking."
                )
            LabeledContent(
                "Answer tokens / s",
                value: entry.metrics?.tokensPerSecond.map { String(format: "%.1f", $0) } ?? "—"
            )
            .help(
                "Answer tokens divided by the time from first text to the terminal event. Initial waiting and thinking are excluded."
            )
            LabeledContent(
                "Total time", value: seconds(entry.metrics?.durationSeconds ?? entry.durationSeconds))
        }
        .font(AppStyle.caption.monospacedDigit())
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func count(_ value: Int?) -> String { value?.formatted() ?? "—" }
    private func seconds(_ value: Double?) -> String { value.map { String(format: "%.2f s", $0) } ?? "—" }
}
