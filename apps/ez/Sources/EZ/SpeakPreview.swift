import AVFoundation
import EZCore
import SwiftUI

struct SpeakPreview: View {
    @ObservedObject var model: AppModel
    let preset: ModelPreset
    let saved: Bool
    @State private var text = "Hello. This is a speech preview."
    @State private var operation: Task<Void, Never>?
    @State private var player: AVAudioPlayer?
    @State private var message: String?
    @State private var error: String?
    @State private var generation = UUID()
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Speech text").font(AppStyle.caption)
            TextEditor(text: $text).frame(height: 80).border(.separator)
                .disabled(operation != nil)
            Text("AI-generated audio · OpenAI API billing").font(AppStyle.caption).foregroundStyle(.secondary)
            if !saved { Text("Save changes before generating speech.").font(AppStyle.caption) }
            HStack {
                if operation != nil {
                    Button("Stop") { stop() }
                } else {
                    Button("Generate") { generate() }
                        .disabled(
                            !saved || model.offline || model.presetIssue(preset) != nil
                                || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                || text.utf16.count > 512)
                }
                if let player {
                    Button("Play") {
                        player.currentTime = 0
                        player.play()
                    }
                    Button("Stop playback") { player.stop() }
                }
            }
            if let message { Text(message).font(AppStyle.caption) }
            if let error { Text(error).font(AppStyle.caption).foregroundStyle(.red).textSelection(.enabled) }
            if model.offline {
                Text("Speech generation is unavailable in the offline preview.").font(AppStyle.caption)
            }
        }
        .onDisappear { stop() }
        .onChange(of: preset) { _, _ in
            stop()
            message = nil
            error = nil
        }
    }
    private func stop() {
        generation = UUID()
        operation?.cancel()
        operation = nil
        player?.stop()
        player = nil
        message = "Stopped."
    }
    private func generate() {
        stop()
        message = "Generating speech…"
        error = nil
        let id = UUID()
        generation = id
        let input = text
        operation = Task {
            defer { if generation == id { operation = nil } }
            do {
                let data = try await SpeechPreviewClient(connection: model.auth).generate(
                    preset: preset, text: input)
                try Task.checkCancellation()
                guard generation == id else { return }
                player = try AVAudioPlayer(data: data)
                player?.prepareToPlay()
                message = "Speech ready. Press Play to listen."
            } catch {
                if !Task.isCancelled && generation == id {
                    self.error = error.localizedDescription
                    message = nil
                }
            }
        }
    }
}
