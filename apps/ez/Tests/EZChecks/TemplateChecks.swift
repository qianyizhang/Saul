import SaulTestSupport

@testable import EZCore

@MainActor func templateChecks() -> [CheckCase] {
    [
        CheckCase("template: multiple named inputs keep first-use order and are each required") { _ in
            let template = try PromptTemplate(
                "Find {{fuzzy term}} for {{fuzzy context}}; correct {{fuzzy term}}.")
            try expectEqual(
                template.fields, ["fuzzy term", "fuzzy context"], "Field order or deduplication changed")
            try expectEqual(
                try template.render(["fuzzy term": "word", "fuzzy context": "sentence"]),
                "Find word for sentence; correct word.", "Named values were not assigned to the right fields")
            try expectThrows(EZError.self) { _ = try template.render(["fuzzy term": "word"]) }
            try expectThrows(EZError.self) { _ = try template.render(["fuzzy context": "sentence"]) }
        }
    ]
}
