import Foundation

/// A presentation-only comparison. Never rewrites the saved response or infers edits with another request.
public struct SpellingComparison {
    public struct Run: Equatable {
        public let text: String
        public let changed: Bool
    }
    public struct Paragraph {
        public let original: [Run]
        public let corrected: [Run]
    }
    public let paragraphs: [Paragraph]
    public let corrected: String
    public let notes: String
    public let originalRuns: [Run]
    public let correctedRuns: [Run]
    public let highlightsAvailable: Bool

    public init?(entry: HistoryEntry) {
        guard entry.mode == .spelling, entry.status == "completed" else { return nil }
        if let recipe = entry.recipeSnapshot {
            guard let template = try? PromptTemplate(recipe.template), template.fields.count == 1 else {
                return nil
            }
        }
        let lines = entry.response.trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: "\n")
        // Labels may stand alone or introduce content on the same line.
        let notesSection = lines.indices.dropFirst().compactMap { index -> (index: Int, text: String)? in
            guard
                let text = Self.sectionContent(
                    lines[index], names: ["changes", "changes made", "corrections", "修改说明", "修改", "更改说明"])
            else { return nil }
            return (index, text)
        }.first
        let titleContent = Self.sectionContent(
            lines.first ?? "", names: ["corrected text", "corrected version", "corrected", "修正后", "修改后"])
        guard notesSection != nil || titleContent != nil else { return nil }
        var bodyLines = Array(lines[..<(notesSection?.index ?? lines.count)])
        if let titleContent, !bodyLines.isEmpty { bodyLines[0] = titleContent }
        let body = bodyLines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return nil }
        corrected = Self.plainText(body)
        notes =
            notesSection.map { section in
                ([section.text] + Array(lines.dropFirst(section.index + 1)))
                    .joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            } ?? ""
        let original = Self.tokens(entry.displayQuery)
        let revised = Self.tokens(corrected)
        // Bound worst-case diff work for long or unrelated responses.
        highlightsAvailable =
            original.count <= 4_000 && revised.count <= 4_000
            && original.count * revised.count <= 2_000_000
        if highlightsAvailable {
            let difference = revised.difference(from: original)
            var removed = Set<Int>()
            var inserted = Set<Int>()
            for change in difference {
                switch change {
                case .remove(let offset, _, _): removed.insert(offset)
                case .insert(let offset, _, _): inserted.insert(offset)
                }
            }
            originalRuns = Self.runs(original, changed: removed)
            correctedRuns = Self.runs(revised, changed: inserted)
            let sourceAnchors = Self.wordOffsets(original, excluding: removed)
            let targetAnchors = Self.wordOffsets(revised, excluding: inserted)
            paragraphs = SpellingParagraphAlignment.rows(
                original: originalRuns, corrected: correctedRuns,
                anchors: Array(zip(sourceAnchors, targetAnchors)))
        } else {
            originalRuns = [Run(text: entry.displayQuery, changed: false)]
            correctedRuns = [Run(text: corrected, changed: false)]
            paragraphs = [Paragraph(original: originalRuns, corrected: correctedRuns)]
        }
    }

    private static func wordOffsets(_ tokens: [String], excluding changed: Set<Int>) -> [Int] {
        var offset = 0
        var result: [Int] = []
        for (index, token) in tokens.enumerated() {
            if !changed.contains(index), token.rangeOfCharacter(from: .alphanumerics) != nil {
                result.append(offset)
            }
            offset += token.utf16.count
        }
        return result
    }

    /// Returns the section's inline content, or an empty string for a standalone heading.
    private static func sectionContent(_ line: String, names: [String]) -> String? {
        let decoration = CharacterSet(charactersIn: " #*_:\t：\r")
        if names.contains(line.trimmingCharacters(in: decoration).lowercased()) { return "" }
        guard let colon = line.firstIndex(where: { $0 == ":" || $0 == "：" }) else { return nil }
        let label = String(line[..<colon])
        guard names.contains(label.trimmingCharacters(in: decoration).lowercased()) else { return nil }
        var content = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
        // Handle **Changes:** without stripping emphasis from Changes: **Fixed** spelling.
        for marker in ["**", "__"] {
            if label.components(separatedBy: marker).count.isMultiple(of: 2), content.hasPrefix(marker) {
                content.removeFirst(marker.count)
                break
            }
        }
        return content.trimmingCharacters(in: .whitespaces)
    }
    private static func plainText(_ text: String) -> String {
        guard
            let attributed = try? AttributedString(
                markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))
        else { return text }
        return String(attributed.characters)
    }
    private static func tokens(_ text: String) -> [String] {
        let pattern = #"[\p{L}\p{M}\p{N}]+|\s+|[^\p{L}\p{M}\p{N}\s]"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [text] }
        let source = text as NSString
        return regex.matches(in: text, range: NSRange(location: 0, length: source.length)).map {
            source.substring(with: $0.range)
        }
    }
    private static func runs(_ tokens: [String], changed: Set<Int>) -> [Run] {
        var result: [Run] = []
        for (index, token) in tokens.enumerated() {
            let isChanged = changed.contains(index)
            if let last = result.last, last.changed == isChanged {
                result[result.count - 1] = Run(text: last.text + token, changed: isChanged)
            } else {
                result.append(Run(text: token, changed: isChanged))
            }
        }
        return result
    }
}
