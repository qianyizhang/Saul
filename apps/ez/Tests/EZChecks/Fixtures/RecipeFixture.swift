import Foundation

@testable import EZCore

struct RecipeFixture {
    let option = ModelOption(catalog: [
        "visibility": "list", "slug": "fixture", "display_name": "Fixture",
        "supported_reasoning_levels": [["effort": "low"], ["effort": "medium"]],
        "service_tiers": [["id": "priority", "name": "Fast"]],
    ])!
    let preset = ModelPreset(name: "lit", model: "fixture", effort: "medium", fast: true)
    var recipe: Recipe {
        Recipe(
            name: "Lookup", presetID: preset.id,
            template: "Find {{fuzzy term}} for {{fuzzy context}}; correct {{ fuzzy term }}.")
    }
}
