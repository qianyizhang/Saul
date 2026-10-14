import EZCheckSupport
import Foundation

@testable import EZCore

@MainActor func launcherChecks() -> [CheckCase] {
    [
        CheckCase("launcher: launcher query decoding and invalid input") { _ in
            let text = "你好 + a&b = 50% # ? / \"quote\"\n%26 $(echo hello)"
            var parts = URLComponents(string: "ez://lookup")!
            parts.queryItems = [URLQueryItem(name: "query", value: text)]
            try expect(try LauncherQuery(url: parts.url!).query == text, "Query must decode exactly once")
            try expect(
                try LauncherQuery(url: URL(string: "ez://lookup?query=a+b")!).query == "a+b",
                "Literal plus must remain plus")
            for value in [
                "https://lookup?query=test", "ez://other?query=test", "ez://lookup/path?query=test",
                "ez://lookup?query=", "ez://lookup?query=%20%0A", "ez://lookup",
                "ez://lookup?query=one&query=two", "ez://lookup?query=one&model=other",
                "ez://lookup?query=test#fragment", "ez://user@lookup?query=test",
                "ez://lookup:80?query=test",
                "ez://lookup?query=" + String(repeating: "a", count: 16_385),
            ] {
                try expectThrows(EZError.self) {
                    _ = try LauncherQuery(url: URL(string: value)!)
                }
            }
            parts.queryItems = [URLQueryItem(name: "query", value: String(repeating: "a", count: 16_384))]
            try expect(
                try LauncherQuery(url: parts.url!).query.utf8.count == 16_384, "Boundary query rejected")
            parts.queryItems = [URLQueryItem(name: "query", value: String(repeating: "你", count: 5_462))]
            try expectThrows(EZError.self) { _ = try LauncherQuery(url: parts.url!) }
        },
        CheckCase("launcher: single-field submission versus multi-field completion") { _ in

            let config = Configuration.starters(model: "fixture", effort: "medium", fast: false)
            guard let singleRecipe = config.recipes.first(where: { $0.legacyMode == .dictionary }),
                let multiRecipe = config.recipes.first(where: { $0.legacyMode == nil })
            else { throw CheckFailure("Starter configuration is missing launcher recipes") }
            let single = try config.preparingLauncherInput("query", recipeID: singleRecipe.id)
            try expect(single.submit && single.values == ["text": "query"], "Single-field launcher changed")
            let multi = try config.preparingLauncherInput("word", recipeID: multiRecipe.id)
            try expect(
                !multi.submit && multi.values == ["fuzzy term": "word"],
                "Multi-field launcher must wait for user"
            )
            try expectThrows(EZError.self) {
                _ = try config.preparingLauncherInput("word", recipeID: UUID())
            }
        },
    ]
}
