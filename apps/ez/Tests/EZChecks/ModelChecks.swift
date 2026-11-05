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
            let invalidDefault = ModelOption(catalog: [
                "visibility": "list", "slug": "test", "default_reasoning_level": "retired",
                "supported_reasoning_levels": [
                    false, ["effort": "high"], ["effort": "high"], ["effort": ""],
                ],
            ])!
            try expect(
                invalidDefault.quickEffort == "high" && invalidDefault.supportedReasoningEfforts.count == 1,
                "Invalid or duplicate catalog options changed defaults")
            try expect(
                ModelPreset(name: "Default", model: "test", effort: "", fast: false)
                    .availabilityError(in: [invalidDefault], provider: .chatGPTPlan) == nil,
                "Default effort should omit the request option")
        },
        CheckCase("preset: presets refuse unavailable models, effort, and Fast without fallback") {
            _ in
            let f = RecipeFixture()
            let option = f.option
            let preset = f.preset
            let action = f.action

            try expect(
                preset.availabilityError(in: [option], provider: .chatGPTPlan) == nil, "Valid preset rejected"
            )
            var changed = preset
            changed.model = "missing"
            try expect(
                changed.availabilityError(in: [option], provider: .chatGPTPlan) != nil,
                "Unavailable model accepted")
            changed = preset
            changed.effort = "ultra"
            try expect(
                changed.availabilityError(in: [option], provider: .chatGPTPlan) != nil,
                "Unsupported effort accepted")
            let noFast = ModelOption(catalog: [
                "visibility": "list", "slug": "fixture",
                "supported_reasoning_levels": [["effort": "medium"]],
            ])!
            try expect(
                preset.availabilityError(in: [noFast], provider: .chatGPTPlan) != nil,
                "Fast silently downgraded")
            try expectThrows(EZError.self) {
                _ = try action.prepare(
                    values: ["fuzzy term": "word", "fuzzy context": "context"], preset: changed,
                    models: [option], provider: .chatGPTPlan)
            }
            try expect(changed.effort == "ultra" && preset.fast, "Validation mutated choices")
        },
        CheckCase("preset: added plan connections use their provider's model and Fast rules") { _ in
            let fixture = RecipeFixture()
            var preset = fixture.preset
            preset.connectionKey = "second-account"
            try expect(
                preset.availabilityError(in: [], provider: .chatGPTPlan) != nil,
                "Added account bypassed model validation")
            let option = ModelOption(catalog: [
                "visibility": "list", "slug": preset.model,
                "supported_reasoning_levels": [["effort": preset.effort]], "additional_speed_tiers": ["fast"],
            ])!
            let entry = try fixture.action.prepare(
                values: ["fuzzy term": "word", "fuzzy context": "context"], preset: preset, models: [option],
                provider: .chatGPTPlan)
            try expectEqual(
                entry.requestedServiceTier, "fast", "Added plan account used the API priority default")
            var search = fixture.action
            search.webSearch = true
            try expectThrows(EZError.self) {
                _ = try search.prepare(
                    values: ["fuzzy term": "word", "fuzzy context": "context"], preset: preset,
                    models: [option], provider: .chatGPTPlan)
            }
        },
    ]
}
