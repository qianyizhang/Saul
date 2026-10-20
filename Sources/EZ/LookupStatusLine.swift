import EZCore
import SwiftUI

/// Optional footer when the quieter reading presentation is disabled.
struct LookupStatusLine: View {
    let entry: HistoryEntry

    var body: some View {
        Text(summary)
            .font(AppStyle.caption.monospacedDigit())
            .foregroundStyle(AppStyle.secondaryText)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
            .help(explanation)
    }

    private var summary: String {
        let metrics = entry.metrics
        let first = metrics?.timeToFirstTokenSeconds.map { String(format: "%.2f s", $0) } ?? "—"
        let total =
            (metrics?.durationSeconds ?? entry.durationSeconds).map { String(format: "%.2f s", $0) } ?? "—"
        return "First text: \(first) · Total: \(total)"
    }

    private var explanation: String {
        "First text includes network time and thinking. Total is the observed request duration. "
            + "A dash means the time was not observed. Token counts and throughput are in Details."
    }
}

/// Exact recorded facts, shared by both reading surfaces.
struct LookupDetails: View {
    let entry: HistoryEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(spacing: 8) {
                MetadataRow("Created", value: entry.createdAt.formatted(date: .abbreviated, time: .shortened))
                if let preset = entry.presetSnapshot {
                    MetadataRow("Preset", value: preset.name)
                }
                MetadataRow("Model", value: entry.model)
                MetadataRow("Effort", value: entry.effort.isEmpty ? "Default" : entry.effort.capitalized)
                MetadataRow("Requested speed", value: entry.requestedServiceTier == nil ? "Standard" : "Fast")
                MetadataRow("Served tier", value: entry.actualServiceTier ?? "Not reported")
            }
            Divider()
            Text("Tokens").font(AppStyle.caption.weight(.semibold)).foregroundStyle(.primary)
            HStack(alignment: .top, spacing: 12) {
                metric("Input", count(entry.metrics?.inputTokens))
                metric("Thinking", count(entry.metrics?.reasoningTokens))
                metric("Answer", count(entry.metrics?.responseTokens))
                    .help("Output tokens minus reasoning tokens; may include formatting tokens.")
            }
            Divider()
            HStack(alignment: .top, spacing: 12) {
                metric("First text", seconds(entry.metrics?.timeToFirstTokenSeconds))
                    .help(
                        "From HTTP request start to first answer or refusal text, including network time and thinking."
                    )
                metric("Total time", seconds(entry.metrics?.durationSeconds ?? entry.durationSeconds))
                metric(
                    "Answer tokens/s",
                    entry.metrics?.tokensPerSecond.map { String(format: "%.1f", $0) } ?? "—"
                )
                .help(
                    "Answer tokens per second after first text; initial waiting and thinking are excluded."
                )
            }
        }
        .textSelection(.enabled)
        .frame(maxWidth: 420, alignment: .leading)
    }

    private func metric(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(AppStyle.caption).foregroundStyle(AppStyle.secondaryText)
            Text(value).font(.system(size: 14, weight: .medium).monospacedDigit()).foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
        }.frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
    }
    private func count(_ value: Int?) -> String { value?.formatted() ?? "—" }
    private func seconds(_ value: Double?) -> String { value.map { String(format: "%.2f s", $0) } ?? "—" }
}
