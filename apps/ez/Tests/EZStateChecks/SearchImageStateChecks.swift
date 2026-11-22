import Combine
import EZCheckSupport
import EZCore
import Foundation
import ImageIO
import SaulNativeValues
import SaulTestSupport

@testable import EZApplication

@MainActor func searchImageStateChecks() -> [CheckCase] {
    [
        CheckCase("retry: failed image edits retain their frozen source for Retry without saving it") {
            directory in
            let store = try HistoryStore(directory: directory)
            var received: [HistoryEntry] = []
            let execution = AttemptExecution(
                generate: { entry, _ in
                    received.append(entry)
                    throw EZError("Synthetic image failure")
                }, append: { try store.append($0) }, delete: { try store.delete($0) })
            let model = try newMemeModel(directory, execution: execution)
            defer { model.shutdown() }
            model.attachImage(data: fixturePNG, name: "source.png")
            var done = CheckSignal()
            let observer = model.$runningAttempt.dropFirst().filter { $0 == nil }.sink { _ in
                let signal = done
                Task { await signal.signal() }
            }
            defer { observer.cancel() }
            model.send()
            try await done.wait()
            let failed = model.selectedEntry!
            try expect(try store.entry(failed.recordID) == nil, "Failed image edit retained its stored input")
            model.removeImageInput()
            done = CheckSignal()
            model.retry(failed.id)
            try await done.wait()
            try expectEqual(received.count, 2, "Image retry did not send once")
            try expectEqual(
                received[1].inputImage?.data, received[0].inputImage?.data, "Retry used live sketch")
            try expectEqual(received[1].query, received[0].query, "Image prompt changed")
            try expect(!model.hasImageInput, "Image retry changed the draft")
            try expect(try store.load().isEmpty, "Repeated image failures accumulated in history")
        },
        CheckCase("sketch: draw from blank, retain failed draft, and reuse the exact flattened source") {
            directory in
            let store = try HistoryStore(directory: directory)
            var sent: Data?
            let execution = AttemptExecution(
                generate: { entry, _ in
                    let bytes = try entry.inputImage?.validatedData()
                    let pending = try store.load().first { $0.id == entry.id }!
                    try expectEqual(
                        try store.inputImage(for: pending)?.data, bytes, "Sketch sent before save")
                    sent = bytes
                    throw EZError("Synthetic image request failure")
                }, append: { try store.append($0) }, delete: { try store.delete($0) })
            let model = try newMemeModel(directory, execution: execution)
            defer { model.shutdown() }
            try expect(!model.canSend, "An empty sketch could run")
            var scene = model.sketch.scene
            scene.strokes.append(SketchStroke(points: [CGPoint(x: 80, y: 256), CGPoint(x: 420, y: 256)]))
            model.commitSketch(scene)
            try expect(model.canSend, "A drawing still required an attachment")
            let instructions = model.inputValues
            model.query = ""
            model.undoSketch()
            try expect(
                !model.hasImageInput && model.hasRetainedDraft, "A redo-only sketch lost its edit affordance")
            for (field, text) in instructions { model.setInput(text, for: field) }
            try expect(!model.canSend, "Undo left a runnable blank sketch")
            model.redoSketch()
            let pendingImport = model.beginImageImport()
            model.removeImageInput()
            model.finishImageImport(pendingImport) { model.attachImage(data: fixturePNG, name: "late.png") }
            try expect(!model.canSend, "A late image import restored a removed sketch")
            model.undoSketch()
            try expectEqual(model.sketch.scene, scene, "Undo did not restore the removed drawing")
            model.attachImage(data: fixturePNG, name: "photo.png")
            try expectEqual(model.sketch.scene.strokes, scene.strokes, "Pasting discarded the drawing")
            scene = model.sketch.scene
            _ = scene.addCaption()
            scene.captions[0].text = "Already?"
            model.commitSketch(scene)
            model.attachImage(data: Data("bad".utf8), name: "bad.png")
            try expectEqual(model.sketch.scene, scene, "Invalid paste replaced the composition")
            let done = CheckSignal()
            let observer = model.$runningAttempt.dropFirst().filter { $0 == nil }.sink { _ in
                Task { await done.signal() }
            }
            defer { observer.cancel() }
            model.send()
            try await done.wait()
            let failed = model.selectedEntry!
            try expectEqual(failed.status, "failed", "Synthetic failure was lost")
            try expectEqual(model.sketch.scene, scene, "Failure flattened the live editable draft")
            guard let sent, let source = CGImageSourceCreateWithData(sent as CFData, nil),
                let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
            else { throw CheckFailure("Edited sketch did not produce a readable PNG") }
            try expectEqual(image.width, 1024, "Edited sketch had the wrong dimensions")
            try expectEqual(image.height, 1024, "Edited sketch had the wrong dimensions")
            try expect(
                try sketchDarkPixels(image, at: CGRect(x: 512, y: 512, width: 1, height: 1)) == 1,
                "The rendered image lost the center stroke")
            try expect(
                try sketchDarkPixels(image, at: CGRect(x: 68, y: 824, width: 280, height: 100)) > 40,
                "The rendered image lost the caption")
            model.newQuery()
            model.reuse(failed)
            try expectEqual(model.inputImage?.data, sent, "Reuse did not load the exact sent image")
            try expect(
                model.sketch.scene.photo != nil && model.sketch.scene.strokes.isEmpty
                    && model.sketch.scene.captions.isEmpty && !model.sketch.canUndo,
                "Reuse did not open a fresh sketch with just the saved image")
            try expect(model.canSend && model.selection == nil, "Reuse unexpectedly sent or blocked Run")
        },
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
            let model = fixtureModel(directory: local, historyDirectory: shared)
            defer { model.shutdown() }
            await model.refreshHistory()?.value
            model.selection = entry.id
            await model.waitForHistorySelection()
            let loaded = CheckSignal()
            let observer = model.objectWillChange.filter { !model.imageLoading }.sink { _ in
                Task { await loaded.signal() }
            }
            defer { observer.cancel() }
            if model.imageLoading { try await loaded.wait() }
            guard let selected = model.selectedEntry else { throw CheckFailure("Saved image not selected") }
            try expectEqual(
                model.imageData(for: selected), fixturePNG, "Image reader used the configuration directory")
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
                }, append: { try store.append($0) }, delete: { try store.delete($0) })
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
            let observer = model.$runningAttempt.dropFirst().filter { $0 == nil }.sink { _ in
                Task { await done.signal() }
            }
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
                append: { try store.append($0) },
                delete: { try store.delete($0) })
            let model = try newMemeModel(directory, execution: execution)
            defer { model.shutdown() }
            model.attachImage(data: fixturePNG, name: "source.png")
            _ = try historySQL(
                store.url,
                "CREATE TRIGGER fail_save BEFORE INSERT ON ez_entry BEGIN SELECT RAISE(ABORT,'Synthetic initial save failure'); END"
            )
            model.send()
            await execution.waitForSettlement()
            try expectEqual(calls, 0, "Source-save failure sent a request")
            try expect(!model.busy && model.error?.contains("not sent") == true, "Source-save failure hidden")
            try expect(
                model.inputImage != nil && model.query == "Make a Monday meme", "Failed send lost draft")
        },
        CheckCase("image action: failed final save preserves the saved source without claiming a result") {
            directory in
            let store = try HistoryStore(directory: directory)
            var calls = 0
            let execution = AttemptExecution(
                generate: { _, _ in
                    calls += 1
                    return .image(fixturePNG)
                },
                append: { entry in
                    if entry.status != "pending" {
                        throw EZError("Synthetic terminal-save failure")
                    }
                    try store.append(entry)
                },
                delete: { try store.delete($0) })
            let model = try newMemeModel(directory, execution: execution)
            defer { model.shutdown() }
            model.attachImage(data: fixturePNG, name: "source.png")
            let done = CheckSignal()
            let observer = model.$runningAttempt.dropFirst().filter { $0 == nil }.sink { _ in
                Task { await done.signal() }
            }
            defer { observer.cancel() }
            model.send()
            try await done.wait()
            let unsaved = model.selectedEntry!
            try expectEqual(unsaved.status, "unsaved", "Failed save reported success")
            try expectEqual(unsaved.inputImage?.name, "source.png", "Source reference lost")
            try expectEqual(unsaved.imageData, fixturePNG, "Unsaved result lost")
            await model.refreshHistory()?.value
            let saved = try store.load()[0]
            guard let reloaded = model.selectedEntry else { throw CheckFailure("Saved row lost on refresh") }
            try expect(model.imageData(for: reloaded) == nil, "History showed unsaved image bytes")
            try expectEqual(saved.status, "interrupted", "Failed save marked the image complete")
            try expectEqual(
                try store.inputImage(for: saved)?.data, fixturePNG, "Pending save lost the source")
            try expectEqual(try store.image(for: saved), nil, "Unsaved result appeared in storage")
            try expectEqual(calls, 1, "Refresh sent another request")
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
                }, append: { try store.append($0) }, delete: { try store.delete($0) })
            var config = Configuration.starters(model: "fixture", effort: "low", fast: false)
            config.addSearchAndMeme()
            for index in config.presets.indices where config.presets[index].model.isEmpty {
                config.presets[index].model =
                    config.presets[index].capability == .draw ? "gpt-image-2.6-flare" : "fixture"
            }
            for index in config.presets.indices where config.presets[index].capability == .draw {
                config.presets[index].model = "gpt-image-2.6-flare"
            }
            try ConfigurationStore(directory: directory).save(config)
            let model = fixtureModel(directory: directory, attemptExecution: execution)
            defer { model.shutdown() }
            model.chooseAction(config.actions.first { $0.webSearch }!.id)
            model.query = "Question"
            let plan = config.presets.first { $0.connectionKey == "gpt-plan" }!
            model.chooseLookupPreset(plan.id)
            try expectEqual(
                model.currentPreset?.connectionKey, "openai-api", "Chooser switched search to plan billing")
            let done = CheckSignal()
            let observer = model.$runningAttempt.dropFirst().filter { $0 == nil }.sink { _ in
                Task { await done.signal() }
            }
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

private func sketchDarkPixels(_ image: CGImage, at rect: CGRect) throws -> Int {
    let width = Int(rect.width)
    let height = Int(rect.height)
    guard let sample = image.cropping(to: rect),
        let context = CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue),
        let data = context.data
    else { throw CheckFailure("The sketch PNG could not be sampled") }
    context.draw(sample, in: CGRect(origin: .zero, size: rect.size))
    return (0..<(width * height)).filter { data.load(fromByteOffset: $0 * 4, as: UInt8.self) < 40 }.count
}

@MainActor private func newMemeModel(_ directory: URL, execution: AttemptExecution) throws -> AppModel {
    var config = Configuration.starters(model: "fixture", effort: "low", fast: false)
    config.addSearchAndMeme()
    for index in config.presets.indices where config.presets[index].capability == .draw {
        config.presets[index].model = "gpt-image-2.6-flare"
    }
    try ConfigurationStore(directory: directory).save(config)
    let model = fixtureModel(directory: directory, attemptExecution: execution)
    model.chooseAction(config.actions.first { $0.imageInput != nil }!.id)
    model.query = "Make a Monday meme"
    return model
}
