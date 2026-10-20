import EZCheckSupport
import Foundation

@testable import EZCore

@MainActor func modelChecks() -> [CheckCase] {
    [
        CheckCase("model: live-catalog-only model capabilities") { _ in
            let model = ModelOption(catalog: [
                "visibility": "list", "slug": "test", "display_name": "Test",
                "supported_reasoning_levels": [["effort": "low", "description": "Quick"]],
                "additional_speed_tiers": ["fast"],
            ])!
            try expect(model.quickEffort == "low" && model.fastTier == "fast", "Catalog capability decode")
            try expect(
                ModelOption(catalog: ["visibility": "hidden", "slug": "test"]) == nil, "Hidden model shown")
            try expect(
                ModelOption(catalog: ["visibility": "list", "slug": "test"])?.fastTier == nil,
                "Invented Fast capability")
        },
        CheckCase("preset: presets refuse unavailable models, effort, and Fast without fallback") {
            _ in
            let f = RecipeFixture()
            let option = f.option
            let preset = f.preset
            let recipe = f.recipe

            try expect(preset.availabilityError(in: [option]) == nil, "Valid preset rejected")
            var changed = preset
            changed.model = "missing"
            try expect(changed.availabilityError(in: [option]) != nil, "Unavailable model accepted")
            changed = preset
            changed.effort = "ultra"
            try expect(changed.availabilityError(in: [option]) != nil, "Unsupported effort accepted")
            let noFast = ModelOption(catalog: [
                "visibility": "list", "slug": "fixture",
                "supported_reasoning_levels": [["effort": "medium"]],
            ])!
            try expect(preset.availabilityError(in: [noFast]) != nil, "Fast silently downgraded")
            try expectThrows(EZError.self) {
                _ = try recipe.prepare(
                    values: ["fuzzy term": "word", "fuzzy context": "context"], preset: changed,
                    models: [option])
            }
            try expect(changed.effort == "ultra" && preset.fast, "Validation mutated choices")
        },
    ]
}
