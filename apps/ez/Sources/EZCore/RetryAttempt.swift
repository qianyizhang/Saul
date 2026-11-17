import Foundation
import SaulNativeValues

extension HistoryEntry {
    func matchesFrozenPreset(_ preset: ModelPreset) -> Bool {
        let fast = requestedServiceTier.map { !$0.isEmpty && $0 != "default" } ?? false
        return model == preset.model && effort == preset.effort && capability == preset.capability
            && fast == (preset.capability == .write && preset.fast)
    }

    public var isRetryable: Bool {
        sourceID == nil && ["failed", "cancelled", "interrupted"].contains(status)
    }

    /// A new attempt repeats the frozen request, never the current editor or old output.
    public func prepareRetry(connection: ConnectionDefinition, image: ImageAttachment?) throws
        -> HistoryEntry
    {
        guard isRetryable else {
            throw EZError("Only failed, stopped or interrupted requests can be retried.")
        }
        guard let preset = presetSnapshot, let saved = connectionSnapshot,
            saved.key == preset.connectionKey, saved.matchesRoute(connection)
        else {
            throw EZError(
                "The saved connection is unavailable or changed. Review the saved request and choose a connection."
            )
        }
        guard matchesFrozenPreset(preset), connection.capabilities.contains(capability),
            !usesWebSearch || connection.kind == .openAIAPI
        else {
            throw EZError("The saved request is incompatible with this connection. Review the saved request.")
        }
        if (inputImage != nil || actionSnapshot?.imageInput != nil) && image == nil {
            throw EZError(
                "The saved input image is unavailable. Review the saved request and attach it again.")
        }
        if let image { _ = try image.validatedData() }
        if capability == .draw {
            try ImageGenerationRequest(
                prompt: query, model: preset.model, size: imageOptions.size,
                quality: imageOptions.quality, outputFormat: imageOptions.outputFormat,
                image: image, connectionKey: connection.key
            ).validate()
        }
        var next = self
        next.id = UUID()
        next.createdAt = Date()
        next.status = "pending"
        next.response = ""
        next.error = nil
        next.durationSeconds = nil
        next.metrics = nil
        next.actualServiceTier = nil
        next.imageData = nil
        next.storedImage = false
        next.inputImage = image
        next.citations = nil
        next.webSearchCompleted = nil
        return next
    }
}
