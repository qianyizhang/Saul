import Combine
import EZCheckSupport
import EZCore
import Foundation

@MainActor func searchImageStateChecks() -> [CheckCase] {
    [
        CheckCase("image action: saved images reload from shared history rather than app configuration") {
            directory in
            let local = directory.appendingPathComponent("local")
            let shared = directory.appendingPathComponent("shared")
            var config = Configuration.starters(model: "fixture", effort: "", fast: false)
            config.addIllustration()
            for index in config.presets.indices where config.presets[index].capability == .draw {
                config.presets[index].model = "gpt-image-2.6-flare"
            }
            try ConfigurationStore(directory: local).save(config)
            let action = config.actions.first { $0.capability == .draw }!
            let preset = config.presets.first { $0.id == action.presetID }!
            var entry = try action.prepare(
                values: ["context": "Tree"], preset: preset, models: [], provider: .openAIAPI)
            entry.imageData = fixturePNG
            entry.status = "completed"
            let store = try HistoryStore(directory: shared)
            try store.append(entry)
            let model = AppModel(directory: local, historyDirectory: shared, offline: true)
            defer { model.shutdown() }
            model.selection = entry.id
            await model.imageLoadTask?.value
            try expectEqual(
                model.selectedImageData, fixturePNG, "Image reader used the configuration directory")
            try expect(
                !FileManager.default.fileExists(atPath: local.appendingPathComponent("history.sqlite3").path),
                "Image reader created a second history store")
        },

        CheckCase(
            "image action: freeze source before send, restore through reuse, preserve invalid replacement"
        ) { directory in
            let store = try HistoryStore(directory: directory)
            let execution = AttemptExecution(
                generate: { entry, _ in
                    try expectEqual(entry.inputImage?.data, fixturePNG, "Run did not freeze source bytes")
                    let pending = try store.load().first { $0.id == entry.id }!
                    try expectEqual(
                        try store.inputImage(for: pending)?.data, fixturePNG,
                        "Input was not saved before send")
                    return .image(fixturePNG)
                }, append: { try store.append($0) })
            let model = try newMemeModel(directory, execution: execution)
            defer { model.shutdown() }
            try expect(!model.canSend, "Missing image did not block Run")
            model.attachImage(data: fixturePNG, name: "source.png")
            model.attachImage(data: Data("bad".utf8), name: "fake.png")
            try expectEqual(model.inputImage?.data, fixturePNG, "Invalid replacement discarded source")
            try expect(
                model.inputImageError != nil && model.canSend,
                "Invalid replacement hid error or broke retained input")
            let done = CheckSignal()
            let observer = model.$busy.dropFirst().filter { !$0 }.sink { _ in Task { await done.signal() } }
            defer { observer.cancel() }
            model.send()
            try await done.wait()
            let saved = model.selectedEntry!
            try expectEqual(saved.status, "completed", "Image action failed")
            model.newQuery()
            model.reuse(saved)
            try expectEqual(model.inputImage?.data, fixturePNG, "Reuse lost sketch")
            try expectEqual(model.query, "Make a Monday meme", "Reuse lost instructions")
            try expect(model.canSend && model.selection == nil, "Reuse sent or could not prepare a draft")
            _ = try historySQL(
                directory.appendingPathComponent("history.sqlite3"), "UPDATE ez_entry SET input_image=NULL")
            model.newQuery()
            model.reuse(saved)
            try expect(
                !model.canSend && model.inputImageError != nil,
                "Missing historical source silently generated from text")
        },
        CheckCase("image action: initial source-save failure never invokes generation") { directory in
            let store = try HistoryStore(directory: directory)
            var calls = 0
            let execution = AttemptExecution(
                generate: { _, _ in
                    calls += 1
                    return .image(fixturePNG)
                },
                append: { try store.append($0) })
            let model = try newMemeModel(directory, execution: execution)
            defer { model.shutdown() }
            model.attachImage(data: fixturePNG, name: "source.png")
            _ = try historySQL(
                store.url,
                "CREATE TRIGGER fail_save BEFORE INSERT ON ez_entry BEGIN SELECT RAISE(ABORT,'Synthetic initial save failure'); END"
            )
            model.send()
            try expectEqual(calls, 0, "Source-save failure sent a request")
            try expect(!model.busy && model.error?.contains("not sent") == true, "Source-save failure hidden")
            try expect(
                model.inputImage != nil && model.query == "Make a Monday meme", "Failed send lost draft")
        },
        CheckCase("image action: failed final save retains both images and save recovery never sends") {
            directory in
            let store = try HistoryStore(directory: directory)
            var calls = 0
            var failTerminal = true
            let execution = AttemptExecution(
                generate: { _, _ in
                    calls += 1
                    return .image(fixturePNG)
                },
                append: { entry in
                    if entry.status != "pending" && failTerminal {
                        throw EZError("Synthetic terminal-save failure")
                    }
                    try store.append(entry)
                })
            let model = try newMemeModel(directory, execution: execution)
            defer { model.shutdown() }
            model.attachImage(data: fixturePNG, name: "source.png")
            let done = CheckSignal()
            let observer = model.$busy.dropFirst().filter { !$0 }.sink { _ in Task { await done.signal() } }
            defer { observer.cancel() }
            model.send()
            try await done.wait()
            let unsaved = model.selectedEntry!
            try expectEqual(unsaved.status, "unsaved", "Failed save reported success")
            try expectEqual(unsaved.inputImage?.data, fixturePNG, "Unsaved source lost")
            try expectEqual(unsaved.imageData, fixturePNG, "Unsaved result lost")
            model.newQuery()
            failTerminal = false
            model.saveAgain(unsaved.id)
            let saved = try store.load()[0]
            try expectEqual(saved.status, "completed", "Save recovery failed")
            try expectEqual(try store.inputImage(for: saved)?.data, fixturePNG, "Recovered source lost")
            try expectEqual(try store.image(for: saved), fixturePNG, "Recovered result lost")
            try expectEqual(calls, 1, "Save recovery sent another request")
        },
        CheckCase("search action: missing completed search remains failed and retains draft") { directory in
            let store = try HistoryStore(directory: directory)
            let execution = AttemptExecution(
                generate: { _, update in
                    var response = ResponseAccumulator()
                    try response.consume(
                        Data(
                            #"{"type":"response.completed","response":{"status":"completed","output":[{"content":[{"type":"output_text","text":"Unverified"}]}]}}"#
                                .utf8))
                    update(response)
                    return .text(response)
                }, append: { try store.append($0) })
            var config = Configuration.starters(model: "fixture", effort: "low", fast: false)
            config.addSearchAndMeme()
            for index in config.presets.indices where config.presets[index].model.isEmpty {
                config.presets[index].model =
                    config.presets[index].capability == .draw ? "gpt-image-2.6-flare" : "test"
            }
            for index in config.presets.indices where config.presets[index].capability == .draw {
                config.presets[index].model = "gpt-image-2.6-flare"
            }
            try ConfigurationStore(directory: directory).save(config)
            let model = AppModel(directory: directory, offline: true, attemptExecution: execution)
            defer { model.shutdown() }
            model.apiConnected = true
            model.chooseAction(config.actions.first { $0.webSearch }!.id)
            model.query = "Question"
            try expect(
                model.compatiblePresets.allSatisfy { $0.connectionKey == "openai-api" },
                "Plan presets offered for search")
            let done = CheckSignal()
            let observer = model.$busy.dropFirst().filter { !$0 }.sink { _ in Task { await done.signal() } }
            defer { observer.cancel() }
            model.send()
            try await done.wait()
            try expectEqual(model.selectedEntry?.status, "failed", "Unsearched answer reported complete")
            try expectEqual(model.query, "Question", "Failed search lost draft")
            try expectEqual(model.selectedEntry?.response, "Unverified", "Failure lost partial answer")
            try expect(
                model.selectedEntry?.error?.contains("required web search") == true, "Search failure hidden")
        },
    ]
}

@MainActor private func newMemeModel(_ directory: URL, execution: AttemptExecution) throws -> AppModel {
    var config = Configuration.starters(model: "fixture", effort: "low", fast: false)
    config.addSearchAndMeme()
    for index in config.presets.indices where config.presets[index].capability == .draw {
        config.presets[index].model = "gpt-image-2.6-flare"
    }
    try ConfigurationStore(directory: directory).save(config)
    let model = AppModel(directory: directory, offline: true, attemptExecution: execution)
    model.apiConnected = true
    model.chooseAction(config.actions.first { $0.imageInput != nil }!.id)
    model.query = "Make a Monday meme"
    return model
}
