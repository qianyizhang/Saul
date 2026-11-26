import Foundation
import SaulNativeValues

@testable import EZCore

struct RecipeFixture {
    let option = ConnectionModel(
        id: "fixture", efforts: ["medium"], defaultEffort: "medium", fastTier: "fast")
    let preset = ModelPreset(name: "lit", model: "fixture", effort: "medium", fast: true)
    var action: Action {
        Action(
            name: "Lookup", presetID: preset.id,
            template: "Find {{fuzzy term}} for {{fuzzy context}}; correct {{ fuzzy term }}.")
    }
}
