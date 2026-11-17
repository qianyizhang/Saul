import AVFoundation
import EZCore
import SwiftUI

struct SpeakPreview: View {
    @ObservedObject var model: AppModel
    let preset: ModelPreset
    let saved: Bool
    @State private var text = "Hello. This is a speech preview."
    @State private var phase: Phase = .idle

    private enum Phase {
        case idle
        case generating(Task<Void, Never>)
        case ready(AVAudioPlayer)
        case stopped
        case failed(String)

        var isGenerating: Bool {
            if case .generating = self { return true }
            return false
        }
    }

    private var canGenerate: Bool {
        saved && !model.offline && !phase.isGenerating
            && model.presetIssue(preset) == nil && model.connectionIssue(for: preset) == nil
            && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && text.utf16.count <= 512
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Speech text").font(AppStyle.caption)
            TextEditor(text: $text).frame(height: 80).border(.separator)
                .disabled(phase.isGenerating)
            Text("AI-generated audio · OpenAI API billing").font(AppStyle.caption).foregroundStyle(.secondary)
            if !saved { Text("Save changes before generating speech.").font(AppStyle.caption) }
            HStack {
                if phase.isGenerating {
                    Button("Stop") { stop(andShow: .stopped) }
                } else {
                    Button("Generate") { generate() }.disabled(!canGenerate)
                }
                if case .ready(let player) = phase {
                    Button("Play") {
                        player.currentTime = 0
                        player.play()
                    }
                    Button("Stop playback") { player.stop() }
                }
            }
            switch phase {
            case .idle: EmptyView()
            case .generating: Text("Generating speech…").font(AppStyle.caption)
            case .ready: Text("Speech ready. Press Play to listen.").font(AppStyle.caption)
            case .stopped: Text("Stopped.").font(AppStyle.caption)
            case .failed(let error):
                Text(error).font(AppStyle.caption).foregroundStyle(.red).textSelection(.enabled)
            }
            if model.offline {
                Text("Speech generation is unavailable in the offline preview.").font(AppStyle.caption)
            } else if let issue = model.connectionIssue(for: preset) {
                Text(issue).font(AppStyle.caption).foregroundStyle(.red)
            }
        }
        .onDisappear { stop() }
        .onChange(of: preset) { _, _ in stop() }
        .onChange(of: model.settingsSection) { _, section in
            if section != .configuration { stop() }
        }
    }

    private func stop(andShow next: Phase = .idle) {
        switch phase {
        case .generating(let task): task.cancel()
        case .ready(let player): player.stop()
        default: break
        }
        phase = next
    }

    private func generate() {
        guard canGenerate else { return }
        stop()
        let input = text
        phase = .generating(
            Task {
                do {
                    let data = try await SpeechPreviewClient(connection: model.auth).generate(
                        preset: preset, text: input)
                    try Task.checkCancellation()
                    let player = try AVAudioPlayer(data: data)
                    player.prepareToPlay()
                    phase = .ready(player)
                } catch {
                    if !Task.isCancelled { phase = .failed(error.localizedDescription) }
                }
            })
    }
}
