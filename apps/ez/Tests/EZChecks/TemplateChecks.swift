import EZCheckSupport
import Foundation

@testable import EZCore

@MainActor func templateChecks() -> [CheckCase] {
    [
        CheckCase("template: template fields, required values, and literal insertion") { _ in
            let recipe = RecipeFixture().recipe

            let template = try PromptTemplate(recipe.template)
            try expect(
                template.fields == ["fuzzy term", "fuzzy context"], "Field order/deduplication changed")
            let values = ["fuzzy term": "你好 {{fuzzy context}}", "fuzzy context": "a+b\ncontext"]
            try expect(
                try template.render(values)
                    == "Find 你好 {{fuzzy context}} for a+b\ncontext; correct 你好 {{fuzzy context}}.",
                "Values must remain literal; no recursive substitution")
            try expectThrows(EZError.self) { _ = try template.render(["fuzzy term": "word"]) }
            try expectThrows(EZError.self) {
                _ = try template.render(["fuzzy term": "word", "fuzzy context": " \n"])
            }
            for invalid in [
                "{{}}", "{{text", "text}}", "{{a | upper}}", "{{a.b}}", "{% if x %}{{text}}{% endif %}",
                "no inputs", "{{{{text}}",
            ] {
                try expectThrows(EZError.self) {
                    _ = try PromptTemplate(invalid)
                }
            }
        }
    ]
}
