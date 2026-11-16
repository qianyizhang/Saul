import AppKit
import EZCore

extension AppModel {
    var currentConnection: ConnectionDefinition? {
        configuration.connections.first { $0.key == currentPreset?.connectionKey }
    }
    func lookupPresetChoiceIssue(_ preset: ModelPreset) -> String? {
        guard let action = currentAction else { return "Choose an action first." }
        guard preset.capability != .speak else { return "Speak previews run in Settings → Presets." }
        guard preset.capability == action.capability else {
            return "This action needs a \(action.capability.name) preset."
        }
        guard let connection = configuration.connections.first(where: { $0.key == preset.connectionKey })
        else {
            return "The preset’s connection is unavailable. Update the preset in Settings."
        }
        if action.webSearch && connection.kind != .openAIAPI {
            return "Web search needs an OpenAI API Write preset."
        }
        guard connection.capabilities.contains(preset.capability) else {
            return "This connection does not support \(preset.capability.name)."
        }
        if preset.model.isEmpty { return "Choose a model in Settings → Presets." }
        // An unopened connection can load its catalog when selected. Only block on known model evidence.
        if offline || connectionCatalogs[preset.connectionKey]?.isFresh == true { return presetIssue(preset) }
        return nil
    }
    func chooseLookupPreset(_ id: UUID?) {
        let preset =
            id.flatMap { id in configuration.presets.first { $0.id == id } }
            ?? (id == nil ? replayEntry?.presetSnapshot : nil)
        guard let preset, lookupPresetChoiceIssue(preset) == nil else { return }
        choosePreset(id)
    }
    var needsPlan: Bool { currentConnection?.kind == .chatGPTPlan }
    var connectionIssue: String? {
        connectionIssue(for: currentPreset)
    }
    func connectionIssue(for preset: ModelPreset?) -> String? {
        if !offline, !sharedCredentialsConnected {
            return "Connect to Saul in Settings → Preferences → Integrations."
        }
        guard let preset else { return nil }
        guard let connection = configuration.connections.first(where: { $0.key == preset.connectionKey })
        else {
            return "The selected preset's connection is unavailable. Open Connections."
        }
        guard connection.capabilities.contains(preset.capability) else {
            return
                "Connection ‘\(connection.name)’ cannot \(preset.capability.rawValue). Choose a compatible preset."
        }
        if !offline {
            if connection.kind == .chatGPTPlan && connection.accountId == nil {
                return "Choose an account for this connection in Settings → Connections."
            }
            if let error = connectionErrors[connection.key], connectionStatuses[connection.key] == nil {
                return error
            }
            if connectionStatuses[connection.key]?.connected != true {
                return "Set up ‘\(connection.name)’ in Connections."
            }
            return nil
        }
        if connection.kind == .chatGPTPlan {
            if !signedIn { return "Connect ‘\(connection.name)’ in Connections." }
            if !planEnabled { return "Enable plan usage in Connections." }
        } else if !apiConnected {
            return "Save an API key for ‘\(connection.name)’ in Connections."
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
        beginImageImport()
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
        beginImageImport()
        guard !busy, !launcherPending, currentAction?.imageInput != nil else { return }
        do {
            try setImageInput(ImageAttachment(data: data, name: name))
            inputImageError = nil
        } catch { inputImageError = error.localizedDescription }
    }
}
