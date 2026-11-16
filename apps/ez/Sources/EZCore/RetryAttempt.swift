import Foundation

extension HistoryEntry {
    public var isRetryable: Bool {
        sourceID == nil && ["failed", "interrupted"].contains(status)
    }

    /// A new attempt repeats the frozen request, never the current editor or old output.
    public func prepareRetry(connection: ConnectionDefinition, image: ImageAttachment?) throws
        -> HistoryEntry
    {
        guard isRetryable else { throw EZError("Only failed or stopped requests can be retried.") }
        guard let preset = presetSnapshot, let saved = connectionSnapshot,
            saved.key == preset.connectionKey, saved.key == connection.key,
            saved.kind == connection.kind, saved.accountId == connection.accountId,
            saved.endpoint == connection.endpoint
        else {
            throw EZError(
                "The saved connection is unavailable or changed. Review the saved request and choose a connection."
            )
        }
        guard preset.capability == capability, connection.capabilities.contains(capability),
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
