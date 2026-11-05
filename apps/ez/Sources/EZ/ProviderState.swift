import AppKit
import EZCore

extension AppModel {
    var currentProvider: ProviderDefinition? {
        configuration.providers.first { $0.key == currentPreset?.providerKey }
    }
    var compatiblePresets: [ModelPreset] {
        configuration.presets.filter { preset in
            preset.capability == currentAction?.capability
                && (currentAction?.webSearch != true
                    || configuration.providers.first { $0.key == preset.providerKey }?.kind == .openAIAPI)
        }
    }
    var needsPlan: Bool { currentProvider?.kind == .chatGPTPlan }
    var providerIssue: String? {
        if !offline, !sharedCredentialsConnected { return "Connect to Saul in Providers." }
        guard currentPreset != nil else { return nil }
        guard let provider = currentProvider else {
            return "The selected preset's provider is unavailable. Open Providers."
        }
        guard provider.capabilities.contains(currentPreset?.capability ?? .write) else {
            return
                "Provider ‘\(provider.name)’ cannot \(currentPreset?.capability.rawValue ?? "write"). Choose a compatible preset."
        }
        if provider.kind == .chatGPTPlan {
            if !signedIn { return "Connect ‘\(provider.name)’ in Providers." }
            if !planEnabled { return "Enable plan usage in Providers." }
        } else if !apiConnected {
            return "Save an API key for ‘\(provider.name)’ in Providers."
        }
        return nil
    }
    func restoreAPIKey() async {
        guard !apiKeyBusy, !busy, sharedCredentialsConnected else { return }
        apiKeyBusy = true
        defer { apiKeyBusy = false }
        do {
            apiConnected = offline ? try await apiKeyStore.read() != nil : try await auth.keyStatus()
            apiKeyError = nil
        } catch { apiKeyError = error.localizedDescription }
    }
    func saveAPIKey() async {
        guard !apiKeyBusy, !busy else { return }
        apiKeyBusy = true
        let submittedDraft = apiKeyDraft
        defer { apiKeyBusy = false }
        do {
            let key = try validatedOpenAIKey(submittedDraft)
            if offline { try await apiKeyStore.write(key) } else { try await auth.saveKey(key) }
            apiConnected = true
            if apiKeyDraft == submittedDraft { apiKeyDraft = "" }
            apiKeyError = nil
        } catch { apiKeyError = error.localizedDescription }
    }
    func removeAPIKey() async {
        guard !apiKeyBusy, !busy else { return }
        apiKeyBusy = true
        defer { apiKeyBusy = false }
        do {
            if offline { try await apiKeyStore.write(nil) } else { try await auth.saveKey(nil) }
            apiConnected = false
            apiKeyDraft = ""
            apiKeyError = nil
        } catch { apiKeyError = error.localizedDescription }
    }
    func imageData(for entry: HistoryEntry) -> Data? {
        if let data = entry.imageData { return data }
        return selection == entry.id ? selectedImageData : nil
    }
    func loadSelectedImage() {
        imageLoadTask?.cancel()
        selectedImageData = nil
        guard let entry = selectedEntry, entry.hasImage else {
            imageLoading = false
            return
        }
        if let png = entry.imageData {
            selectedImageData = png
            imageLoading = false
            return
        }
        imageLoading = true
        let directory = historyDirectory
        imageLoadTask = Task { [weak self] in
            let data = try? await Task.detached {
                try HistoryStore(directory: directory).image(for: entry)
            }.value
            guard !Task.isCancelled, let self, self.selection == entry.id else { return }
            self.selectedImageData = data
            self.imageLoading = false
        }
    }
    func downloadImage(_ entry: HistoryEntry) {
        guard let data = imageData(for: entry) else {
            error = "The saved image is unavailable."
            return
        }
        let panel = NSSavePanel()
        let gif = data.starts(with: Array("GIF8".utf8))
        panel.allowedContentTypes = gif ? [.gif] : [.png]
        panel.nameFieldStringValue = "EZ-\(entry.id.uuidString.prefix(8)).\(gif ? "gif" : "png")"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do { try data.write(to: url, options: .atomic) } catch { self.error = error.localizedDescription }
    }
}

extension AppModel {
    func attachImage(url: URL) {
        imageImportID = UUID()
        guard url.isFileURL else {
            inputImageError = "Choose an image on this Mac."
            return
        }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? Int.max
            guard size <= ImageAttachment.byteLimit else { throw EZError("Choose an image up to 20 MB.") }
            attachImage(data: try Data(contentsOf: url), name: url.lastPathComponent)
        } catch { inputImageError = error.localizedDescription }
    }

    func attachImage(data: Data, name: String) {
        imageImportID = UUID()
        guard !busy, !launcherPending, currentAction?.imageInput != nil else { return }
        do {
            inputImage = try ImageAttachment(data: data, name: name)
            inputImageError = nil
        } catch { inputImageError = error.localizedDescription }
    }
}
