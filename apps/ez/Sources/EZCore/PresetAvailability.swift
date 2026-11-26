import Foundation
import SaulNativeValues

extension ModelPreset {
    public func availabilityError(in models: [ConnectionModel], provider: GenerationProviderID) -> String? {
        if capability == .speak { return "Speak previews run in Settings → Presets." }
        if capability == .draw {
            guard !model.isEmpty else {
                return "Preset ‘\(name)’ needs an available Draw model. Edit it in Presets."
            }
            do { try (imageOptions ?? ImageOptions()).validate() } catch { return error.localizedDescription }
            return nil
        }
        if provider != .chatGPTPlan {
            return model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? "Choose a model in Presets." : nil
        }
        guard let option = models.first(where: { $0.id == model }) else {
            return
                "Preset ‘\(name)’ needs \(model.isEmpty ? "a model" : model). Choose an available model in Presets."
        }
        if !effort.isEmpty && !option.efforts.contains(effort) {
            return "Preset ‘\(name)’ requests unsupported effort ‘\(effort)’. Edit it in Presets."
        }
        if fast && option.fastTier == nil {
            return
                "Preset ‘\(name)’ requests Fast, but this model does not advertise Fast. Edit it in Presets."
        }
        return nil
    }
}
