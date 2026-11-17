import Foundation
import SaulNativeValues
import SaulTestSupport

@testable import EZCore

@MainActor func modelChecks() -> [CheckCase] {
    [
        CheckCase("retry: reset results while preserving frozen image and follow-up inputs") { _ in
            var entry = HistoryEntry(
                mode: .ask, query: "Frozen prompt", model: "gpt-image-2.6-flare", effort: "",
                requestedServiceTier: nil)
            entry.status = "interrupted"
            entry.response = "Partial output"
            entry.error = "Stopped"
            entry.parentID = UUID()
            entry.followUpQuestion = "Original question"
            entry.instructions = "Frozen instructions"
            entry.connectionSnapshot = ConnectionDefinition.defaults[1]
            entry.presetSnapshot = ModelPreset(
                name: "Image", model: entry.model, effort: "", fast: false,
                connectionKey: "openai-api", capability: .draw, imageOptions: ImageOptions())
            let image = try ImageAttachment(data: fixturePNG, name: "source.png")
            entry.inputImage = image
            entry.inputImage?.data = nil
            entry.storedImage = true
            entry.imageData = fixturePNG
            let retry = try entry.prepareRetry(connection: ConnectionDefinition.defaults[1], image: image)
            try expect(retry.id != entry.id, "Retry reused a history identity")
            try expectEqual(retry.parentID, entry.parentID, "Follow-up parent changed")
            try expectEqual(retry.query, entry.query, "Frozen prompt changed")
            try expectEqual(retry.instructions, entry.instructions, "Instructions changed")
            try expectEqual(retry.inputImage?.data, fixturePNG, "Frozen image lost")
            try expect(
                retry.status == "pending" && retry.response.isEmpty && retry.error == nil
                    && !retry.storedImage && retry.imageData == nil, "Retry retained prior result state")
            try expectThrows(EZError.self) {
                _ = try entry.prepareRetry(connection: ConnectionDefinition.defaults[1], image: nil)
            }
            var changed = ConnectionDefinition.defaults[1]
            changed.baseUrl = "https://example.test/v1"
            try expectThrows(EZError.self) { _ = try entry.prepareRetry(connection: changed, image: image) }
            for status in ["completed", "pending", "unsaved"] {
                entry.status = status
                try expect(!entry.isRetryable, "Ineligible state offered Retry")
            }
            entry.status = "failed"
            entry.sourceID = "saul-origin"
            try expect(!entry.isRetryable, "Saul-origin request offered native Retry")
        },
        CheckCase("model: preset defaults omit unadvertised effort and Fast options") { _ in
            let model = ModelOption(
                connectionModel: ConnectionModel(
                    id: "test", efforts: ["high"], defaultEffort: "retired"))
            try expect(
                model.quickEffort == "high" && model.fastTier == nil,
                "Unadvertised defaults changed the quick fallback")
            try expect(
                ModelPreset(name: "Default", model: "test", effort: "", fast: false)
                    .availabilityError(in: [model], provider: .chatGPTPlan) == nil,
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
            let noFast = ModelOption(connectionModel: ConnectionModel(id: "fixture", efforts: ["medium"]))
            try expect(
                preset.availabilityError(in: [noFast], provider: .chatGPTPlan) != nil,
                "Fast silently downgraded")
            try expectThrows(EZError.self) {
                _ = try action.prepare(
                    values: ["fuzzy term": "word", "fuzzy context": "context"], preset: changed,
                    models: [option], provider: .chatGPTPlan)
            }
        },
        CheckCase("preset: added plan connections use their provider's model and Fast rules") { _ in
            let fixture = RecipeFixture()
            var preset = fixture.preset
            preset.connectionKey = "second-account"
            try expect(
                preset.availabilityError(in: [], provider: .chatGPTPlan) != nil,
                "Added account bypassed model validation")
            let option = ModelOption(
                connectionModel: ConnectionModel(
                    id: preset.model, efforts: [preset.effort], fastTier: "fast"))
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
