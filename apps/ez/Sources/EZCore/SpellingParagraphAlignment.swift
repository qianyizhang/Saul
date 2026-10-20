import Foundation

/// Uses unchanged words from the text diff as anchors, including paragraph splits and merges.
enum SpellingParagraphAlignment {
    private struct Group {
        var original: ClosedRange<Int>
        var corrected: ClosedRange<Int>
    }

    static func rows(
        original: [SpellingComparison.Run], corrected: [SpellingComparison.Run],
        anchors: [(Int, Int)]
    ) -> [SpellingComparison.Paragraph] {
        let left = blocks(original)
        let right = blocks(corrected)
        var groups: [Group] = []
        for (sourceOffset, targetOffset) in anchors {
            guard let source = left.firstIndex(where: { NSLocationInRange(sourceOffset, $0.range) }),
                let target = right.firstIndex(where: { NSLocationInRange(targetOffset, $0.range) })
            else { continue }
            if let last = groups.last,
                source <= last.original.upperBound || target <= last.corrected.upperBound
            {
                groups[groups.count - 1] = Group(
                    original: last.original.lowerBound...max(source, last.original.upperBound),
                    corrected: last.corrected.lowerBound...max(target, last.corrected.upperBound))
            } else {
                groups.append(Group(original: source...source, corrected: target...target))
            }
        }
        var result: [SpellingComparison.Paragraph] = []
        var sourceIndex = 0
        var targetIndex = 0
        func appendGaps(untilSource: Int, untilTarget: Int) {
            // Unanchored paragraphs stay on their own side, rather than guessing correspondence.
            for index in sourceIndex..<untilSource {
                result.append(.init(original: left[index].runs, corrected: []))
            }
            for index in targetIndex..<untilTarget {
                result.append(.init(original: [], corrected: right[index].runs))
            }
        }
        for group in groups {
            appendGaps(untilSource: group.original.lowerBound, untilTarget: group.corrected.lowerBound)
            result.append(
                .init(
                    original: joined(left[group.original].map(\.runs)),
                    corrected: joined(right[group.corrected].map(\.runs))))
            sourceIndex = group.original.upperBound + 1
            targetIndex = group.corrected.upperBound + 1
        }
        appendGaps(untilSource: left.count, untilTarget: right.count)
        return result
    }

    private struct Block {
        let range: NSRange
        let runs: [SpellingComparison.Run]
    }

    private static func blocks(_ runs: [SpellingComparison.Run]) -> [Block] {
        let text = runs.map(\.text).joined() as NSString
        // Blank lines delimit prose paragraphs; list items also start their own comparison rows.
        let pattern = #"\r?\n[\t ]*\r?\n(?:[\t ]*\r?\n)*|\r?\n(?=[\t ]*(?:[-*+]|\d+[.)])[\t ]+)"#
        let separators =
            (try? NSRegularExpression(pattern: pattern))?.matches(
                in: text as String, range: NSRange(location: 0, length: text.length)) ?? []
        var ranges: [NSRange] = []
        var start = 0
        for separator in separators {
            if separator.range.location > start {
                ranges.append(NSRange(location: start, length: separator.range.location - start))
            }
            start = NSMaxRange(separator.range)
        }
        if start < text.length { ranges.append(NSRange(location: start, length: text.length - start)) }
        return ranges.map { range in
            var offset = 0
            var fragments: [SpellingComparison.Run] = []
            for run in runs {
                let source = run.text as NSString
                let overlap = NSIntersectionRange(range, NSRange(location: offset, length: source.length))
                if overlap.length > 0 {
                    fragments.append(
                        .init(
                            text: source.substring(
                                with: NSRange(location: overlap.location - offset, length: overlap.length)),
                            changed: run.changed))
                }
                offset += source.length
            }
            return Block(range: range, runs: fragments)
        }
    }

    private static func joined(_ paragraphs: [[SpellingComparison.Run]]) -> [SpellingComparison.Run] {
        var result: [SpellingComparison.Run] = []
        for paragraph in paragraphs {
            if !result.isEmpty { result.append(.init(text: "\n\n", changed: false)) }
            result.append(contentsOf: paragraph)
        }
        return result
    }
}
