import EZCheckSupport
import Foundation

@testable import EZCore

@MainActor func recipeHistoryChecks() -> [CheckCase] {
    [
        CheckCase("recipe history: compiled request and immutable snapshots") { directory in
            let f = RecipeFixture()
            let option = f.option
            let preset = f.preset
            let recipe = f.recipe

            let entry = try recipe.prepare(
                values: ["fuzzy term": "elicit", "fuzzy context": "draw out"], preset: preset,
                models: [option])
            let body = ResponsesClient.requestBody(entry: entry)
            let input = body["input"] as? [[String: String]]
            try expect(
                input?.first?["content"] == "Find elicit for draw out; correct elicit.",
                "Wrong compiled payload")
            try expect(body["instructions"] == nil, "Hidden legacy-mode instruction contaminated recipe")
            try expect(
                body["model"] as? String == "fixture" && body["service_tier"] as? String == "priority",
                "Wrong preset sent")
            try expect(
                body["store"] as? Bool == false && body["stream"] as? Bool == true, "Plan contract lost")
            let store = try HistoryStore(directory: directory.appendingPathComponent("recipe-history"))
            try store.append(entry)
            var edited = recipe
            edited.template = "New {{text}}"
            try ConfigurationStore(directory: directory).save(
                Configuration(presets: [preset], recipes: [edited]))
            let entries = try store.load().entries
            try expectEqual(entries.count, 1, "Saved recipe history did not reload")
            let reloaded = entries[0]
            try expect(
                reloaded.recipeSnapshot == recipe && reloaded.presetSnapshot == preset,
                "Historical snapshot changed")
            try expect(
                reloaded.inputValues == entry.inputValues && reloaded.query == entry.query,
                "Historical fields lost")
            try expect(
                reloaded.recipeName == "Lookup" && reloaded.displayQuery == "elicit · draw out",
                "History display lost user inputs")
            try expect(reloaded.markdown.contains(entry.query), "Export must contain exact compiled prompt")

        },
        CheckCase("recipe history: legacy history retains request and display semantics") { directory in
            let decoder = JSONDecoder()
            let old = try decoder.decode(
                HistoryEntry.self,
                from: Data(
                    #"{"id":"00000000-0000-0000-0000-000000000001","createdAt":0,"mode":"Ask","query":"old query","response":"old response","model":"fixture","effort":"low","status":"completed","schemaVersion":1}"#
                        .utf8))
            try expect(
                old.recipeSnapshot == nil && old.displayQuery == "old query",
                "Legacy history no longer readable")
            try expect(
                ResponsesClient.requestBody(entry: old)["instructions"] as? String
                    == QueryMode.ask.instruction,
                "Legacy request semantics changed")
        },
    ]
}
