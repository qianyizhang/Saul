import EZCheckSupport
import EZCore
import Foundation

func spellingComparisonChecks() -> [CheckCase] {
    func entry(_ query: String, _ response: String) -> HistoryEntry {
        var value = HistoryEntry(
            mode: .spelling, query: query, model: "fixture", effort: "", requestedServiceTier: nil)
        value.response = response
        value.status = "completed"
        return value
    }
    func require(_ value: SpellingComparison?, _ message: String) throws -> SpellingComparison {
        guard let value else { throw CheckFailure(message) }
        return value
    }
    return [
        CheckCase("spelling: separate notes and preserve Unicode and paragraph text") { _ in
            let source = "Its a café.\n\n你好 🧪!"
            let value = entry(
                source, "**Corrected text:**\nIt’s a café.\n\n你好 🧪！\n\n### Changes\n- Fixed punctuation.")
            let result = try require(SpellingComparison(entry: value), "Expected comparison")
            try expectEqual(result.corrected, "It’s a café.\n\n你好 🧪！", "Notes leaked into correction")
            try expectEqual(result.originalRuns.map(\.text).joined(), source, "Original text changed")
            try expectEqual(result.correctedRuns.map(\.text).joined(), result.corrected, "Correction changed")
            try expectEqual(result.notes, "- Fixed punctuation.", "Missing explanation")
            try expect(
                result.originalRuns.contains { $0.changed && $0.text.contains("Its") }, "Missing deletion")
            try expect(
                result.correctedRuns.contains { $0.changed && $0.text.contains("It") }, "Missing insertion")
        },
        CheckCase("spelling: rerun accepts inline change notes and Markdown labels") { _ in
            let source = "there to many empty pots.\n\nbring some seeds."
            let corrected = "There are too many empty pots.\n\nBring some seeds."
            let explanation =
                "Fixed agreement and capitalization."
            for label in [
                "Changes:", "**Changes:**", "**Changes**:", "### Changes:", "__Changes:__", "修改说明：",
            ] {
                var value = entry(source, corrected + "\n\n" + label + " " + explanation)
                let preset = ModelPreset(name: "Fixture", model: "fixture", effort: "", fast: false)
                value.recipeSnapshot = Recipe(
                    name: "Spell Check", presetID: preset.id, template: "Correct {{text}}",
                    legacyMode: .spelling)
                value.inputValues = ["text": source]
                let result = try require(
                    SpellingComparison(entry: value), "Inline notes disabled comparison: \(label)")
                try expectEqual(result.corrected, corrected, "Notes leaked into corrected text")
                try expectEqual(result.notes, explanation, "Inline explanation was lost")
                try expectEqual(result.paragraphs.count, 2, "Paragraph alignment was lost")
                try expectEqual(
                    value.response, corrected + "\n\n" + label + " " + explanation, "Saved response changed")
            }
        },
        CheckCase("spelling: inline corrected title and note emphasis remain intact") { _ in
            let result = try require(
                SpellingComparison(
                    entry: entry(
                        "its fine",
                        "\n\n**Corrected text:** It’s fine.\n\n**Changes**: **Fixed** punctuation.\n- Preserved meaning.\n"
                    )), "Missing inline corrected title")
            try expectEqual(result.corrected, "It’s fine.", "Inline corrected text was lost")
            try expectEqual(
                result.notes, "**Fixed** punctuation.\n- Preserved meaning.",
                "Explanation formatting was stripped")
            let ordinary = entry("Changes in style matter.", "Changes in style matter: they help clarity.")
            try expect(
                SpellingComparison(entry: ordinary) == nil, "Ordinary prose was treated as a section label")
        },
        CheckCase("spelling: incomplete and ambiguous answers retain raw presentation") { _ in
            var value = entry("hello", "Already correct.")
            try expect(SpellingComparison(entry: value) == nil, "Guessed an unlabelled correction")
            value.response = "Hello.\n\nChanges:\n- Capitalization."
            for status in ["pending", "failed", "interrupted"] {
                value.status = status
                try expect(SpellingComparison(entry: value) == nil, "Compared incomplete answer")
            }
            value.status = "completed"
            value.mode = .ask
            try expect(SpellingComparison(entry: value) == nil, "Compared non-spelling recipe")
        },
        CheckCase("spelling: paragraph splits and merges keep later paragraphs aligned") { _ in
            let original = "Alpha starts. Beta follows.\n\nGamma ends."
            let corrected = "Alpha starts.\n\nBeta follows.\n\nGamma ends."
            for (source, target) in [(original, corrected), (corrected, original)] {
                let result = try require(
                    SpellingComparison(entry: entry(source, "Corrected text:\n" + target)),
                    "Missing comparison")
                try expectEqual(result.paragraphs.count, 2, "Split or merge displaced following paragraph")
                try expectEqual(
                    result.paragraphs[1].original.map(\.text).joined(), "Gamma ends.",
                    "Original anchor drifted")
                try expectEqual(
                    result.paragraphs[1].corrected.map(\.text).joined(), "Gamma ends.",
                    "Corrected anchor drifted")
                try expectEqual(
                    result.paragraphs.map { $0.original.map(\.text).joined() }.joined(separator: "\n\n"),
                    source, "Original paragraphs lost text")
                try expectEqual(
                    result.paragraphs.map { $0.corrected.map(\.text).joined() }.joined(separator: "\n\n"),
                    target, "Corrected paragraphs lost text")
            }
        },
        CheckCase("spelling: inserted and deleted paragraphs leave the opposite cell empty") { _ in
            let short = "Oranges ripen.\n\nViolets bloom."
            let long = "Oranges ripen.\n\nSaturn glows.\n\nViolets bloom."
            let inserted = try require(
                SpellingComparison(entry: entry(short, "Corrected text:\n" + long)), "Missing comparison")
            let deleted = try require(
                SpellingComparison(entry: entry(long, "Corrected text:\n" + short)), "Missing comparison")
            try expectEqual(inserted.paragraphs.count, 3, "Insertion shifted subsequent paragraphs")
            try expectEqual(deleted.paragraphs.count, 3, "Deletion shifted subsequent paragraphs")
            try expect(
                inserted.paragraphs[1].original.isEmpty && deleted.paragraphs[1].corrected.isEmpty,
                "Guessed correspondence for unmatched paragraph")
            try expectEqual(
                inserted.paragraphs[2].original.map(\.text).joined(), "Violets bloom.",
                "Later paragraph no longer aligned")
        },
        CheckCase("spelling: list items and Unicode retain highlights in aligned rows") { _ in
            let result = try require(
                SpellingComparison(
                    entry: entry(
                        "Café notes:\n- amber colour\n- blue colour\n\n你好 🧪!",
                        "Corrected text:\nCafé notes:\n\n- amber color\n- blue color\n\n你好 🧪！")),
                "Missing comparison")
            try expectEqual(result.paragraphs.count, 4, "List items did not align separately")
            try expectEqual(
                result.paragraphs[1].original.filter(\.changed).map(\.text).joined(), "colour",
                "Deleted word highlight lost")
            try expectEqual(
                result.paragraphs[1].corrected.filter(\.changed).map(\.text).joined(), "color",
                "Added word highlight lost")
            try expectEqual(
                result.paragraphs[3].original.map(\.text).joined(), "你好 🧪!", "Unicode source damaged")
        },
        CheckCase("spelling: unchanged prose, repeated words, and long input") { _ in
            let unchanged = try require(
                SpellingComparison(entry: entry("Same text.", "Corrected text:\nSame text.")),
                "Expected titled answer")
            try expect(
                !unchanged.originalRuns.contains { $0.changed }
                    && !unchanged.correctedRuns.contains { $0.changed }, "Invented changes")
            let repeated = try require(
                SpellingComparison(
                    entry: entry("the the text", "the text\n\nChanges:\n- Removed duplicate.")),
                "Missing comparison")
            try expectEqual(
                repeated.originalRuns.filter(\.changed).map(\.text).joined(), "the ", "Wrong duplicate edit")
            let long = String(repeating: "word ", count: 5_000)
            let bounded = try require(
                SpellingComparison(entry: entry(long, "Corrected text:\n" + long)),
                "Long comparison unavailable")
            try expect(!bounded.highlightsAvailable, "Unbounded diff")
        },
    ]
}
