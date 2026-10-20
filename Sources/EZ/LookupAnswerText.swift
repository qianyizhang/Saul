import EZCore
import SwiftUI

/// Shared reading treatment for the main window and Quick Lookup.
struct LookupAnswerText: View {
    let entry: HistoryEntry
    let activity: ResponseActivity?
    var compact = false

    var body: some View {
        if let comparison = SpellingComparison(entry: entry) {
            SpellingComparisonView(comparison: comparison, compact: compact)
        } else {
            VStack(alignment: .leading, spacing: 16) {
                if entry.displayQuery.count > 120 || entry.displayQuery.contains("\n") {
                    DisclosureGroup("Original text") {
                        Text(entry.displayQuery).font(AppStyle.body).lineSpacing(5)
                            .textSelection(.enabled).padding(.top, 8)
                    }.font(AppStyle.caption).foregroundStyle(.secondary)
                } else {
                    Text(entry.displayQuery)
                        .font(compact ? .system(size: 18, weight: .medium, design: .serif) : AppStyle.subject)
                        .textSelection(.enabled)
                }
                if entry.response.isEmpty && entry.status == "pending" {
                    Text(activity == .thinking ? "Thinking…" : "Waiting for answer…")
                        .foregroundStyle(.secondary)
                } else {
                    AnswerMarkdown(text: entry.response)
                }
            }
        }
    }
}

struct AnswerMarkdown: View {
    let text: String
    var body: some View {
        Text(
            (try? AttributedString(
                markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
                ?? AttributedString(text)
        )
        .font(AppStyle.body).lineSpacing(6).textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct SpellingComparisonView: View {
    let comparison: SpellingComparison
    let compact: Bool
    @State private var availableWidth: CGFloat = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            if availableWidth >= 524 {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(alignment: .top, spacing: 24) {
                        columnHeader(original: true)
                        columnHeader(original: false)
                    }
                    ForEach(comparison.paragraphs.indices, id: \.self) { index in
                        let paragraph = comparison.paragraphs[index]
                        HStack(alignment: .top, spacing: 24) {
                            passage(paragraph.original, original: true)
                            passage(paragraph.corrected, original: false)
                        }
                    }
                }
            } else {
                VStack(alignment: .leading, spacing: 24) {
                    column(original: false)
                    DisclosureGroup("Original · compare changes") {
                        column(original: true).padding(.top, 12)
                    }.font(AppStyle.caption)
                }
            }
            if !comparison.highlightsAvailable {
                Text("Long passage · highlighting omitted").font(AppStyle.caption).foregroundStyle(.secondary)
            }
            if !comparison.notes.isEmpty {
                DisclosureGroup("Why these changes") {
                    AnswerMarkdown(text: comparison.notes).padding(.top, 8)
                }.font(AppStyle.caption)
            }
        }
        .onGeometryChange(for: CGFloat.self) {
            $0.size.width
        } action: {
            availableWidth = $0
        }
    }

    private func column(original: Bool) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            columnHeader(original: original)
            passage(original ? comparison.originalRuns : comparison.correctedRuns, original: original)
        }.frame(minWidth: 0, maxWidth: .infinity, alignment: .topLeading)
    }

    private func columnHeader(original: Bool) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(original ? "Original" : "Corrected").font(.headline)
                Spacer(minLength: 4)
                if comparison.highlightsAvailable {
                    Text(original ? "Removed" : "Added")
                        .strikethrough(original).underline(!original)
                        .font(AppStyle.caption).foregroundStyle(
                            original ? DesignTokens.danger : AppStyle.accent)
                }
            }
            Divider()
        }.frame(minWidth: 0, maxWidth: .infinity, alignment: .topLeading)
    }

    private func passage(_ runs: [SpellingComparison.Run], original: Bool) -> some View {
        Text(highlighted(runs, original: original))
            .font(AppStyle.body).lineSpacing(compact ? 4 : 6).textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
            .frame(minWidth: 0, maxWidth: .infinity, alignment: .topLeading)
    }

    private func highlighted(_ runs: [SpellingComparison.Run], original: Bool) -> AttributedString {
        var result = AttributedString()
        for run in runs {
            var fragment = AttributedString(run.text)
            if run.changed {
                fragment[AttributeScopes.SwiftUIAttributes.ForegroundColorAttribute.self] =
                    original ? DesignTokens.danger : AppStyle.accent
                fragment[AttributeScopes.SwiftUIAttributes.BackgroundColorAttribute.self] =
                    original ? DesignTokens.dangerWash : DesignTokens.wash
                if original {
                    fragment[AttributeScopes.SwiftUIAttributes.StrikethroughStyleAttribute.self] = .single
                } else {
                    fragment[AttributeScopes.SwiftUIAttributes.UnderlineStyleAttribute.self] = .single
                }
            }
            result.append(fragment)
        }
        return result
    }
}
