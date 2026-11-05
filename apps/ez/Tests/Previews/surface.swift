import EZCore
import SwiftUI

// Production surfaces, disposable storage, no auth connection or global shortcut.
@main struct EZSurfacePreview: App {
    @StateObject private var model: AppModel
    private let controller: QuickLookupController
    private let syntheticAttempt: Bool

    init() {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ez-surface-preview-\(UUID())", isDirectory: true)
        let failFirstSave = CommandLine.arguments.contains("--unsaved-attempt")
        syntheticAttempt = failFirstSave || CommandLine.arguments.contains("--actions")
        let execution: AttemptExecution?
        do {
            let history = try? HistoryStore(directory: directory)
            var failedTerminal = false
            execution = AttemptExecution(
                generate: { entry, update in
                    if entry.capability == .draw {
                        if entry.query.contains("[slow]") { try await Task.sleep(for: .seconds(120)) }
                        if entry.query.contains("[fail]") {
                            throw EZError("Synthetic image request failure. Your draft is retained.")
                        }
                        if entry.presetSnapshot?.imageOptions?.outputFormat == "gif" {
                            let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
                                .appendingPathComponent("../../../../contracts/fixtures/animation.gif")
                            return .image(try Data(contentsOf: url))
                        }
                        return .image(try previewPNG())
                    }
                    if entry.usesWebSearch {
                        var result = ResponseAccumulator()
                        try result.consume(Data(#"{"type":"response.web_search_call.searching"}"#.utf8))
                        update(result)
                        if entry.query.contains("[slow]") { try await Task.sleep(for: .seconds(120)) }
                        if entry.query.contains("[fail]") {
                            throw EZError("Synthetic search failed. Your draft is retained.")
                        }
                        let text = "The sketch becomes a meme through an image edit. OpenAI documentation"
                        try result.consume(
                            JSONSerialization.data(withJSONObject: [
                                "type": "response.completed",
                                "response": [
                                    "status": "completed",
                                    "output": [
                                        [
                                            "type": "web_search_call", "status": "completed",
                                            "action": ["type": "search"],
                                        ],
                                        [
                                            "type": "message",
                                            "content": [
                                                [
                                                    "type": "output_text", "text": text,
                                                    "annotations": [
                                                        [
                                                            "type": "url_citation",
                                                            "start_index": text.unicodeScalars.count
                                                                - "OpenAI documentation".unicodeScalars.count,
                                                            "end_index": text.unicodeScalars.count,
                                                            "url":
                                                                "https://developers.openai.com/api/docs/guides/image-generation",
                                                            "title": "OpenAI image generation",
                                                        ]
                                                    ],
                                                ]
                                            ],
                                        ],
                                    ],
                                ],
                            ]))
                        return .text(result)
                    }
                    var result = ResponseAccumulator()
                    try result.consume(
                        JSONSerialization.data(withJSONObject: [
                            "type": "response.output_text.delta",
                            "delta":
                                "**Serendipity** means finding something valuable or pleasant by chance.\n\nThis synthetic answer exercises recovery without network or account access.",
                        ]))
                    try result.consume(
                        JSONSerialization.data(withJSONObject: [
                            "type": "response.completed", "response": ["status": "completed"],
                        ]))
                    update(result)
                    return .text(result)
                },
                append: { entry in
                    guard let history else { throw EZError("Preview history is unavailable.") }
                    if entry.status != "pending", !failedTerminal, failFirstSave {
                        failedTerminal = true
                        throw EZError(
                            "Synthetic final-save failure. Save again will use disposable local history.")
                    }
                    try history.append(entry)
                })
        }
        let model = AppModel(directory: directory, offline: true, attemptExecution: execution)
        _model = StateObject(wrappedValue: model)
        controller = QuickLookupController(model: model)
    }

    var body: some Scene {
        Window("EZ Surface Preview", id: "main") {
            SurfacePreviewControls(model: model, controller: controller, syntheticAttempt: syntheticAttempt)
                .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification))
            { _ in
                controller.shutdown()
                model.shutdown()
                try? FileManager.default.removeItem(at: model.directory)
            }
        }.defaultSize(width: 780, height: 640)
    }
}

private struct SurfacePreviewControls: View {
    @ObservedObject var model: AppModel
    @ObservedObject var controller: QuickLookupController
    let syntheticAttempt: Bool
    @State private var scenario = "Empty"
    @State private var dark = false
    @State private var reduceMotion = false
    init(model: AppModel, controller: QuickLookupController, syntheticAttempt: Bool) {
        self.model = model
        self.controller = controller
        self.syntheticAttempt = syntheticAttempt
        _scenario = State(
            initialValue: CommandLine.arguments.contains("--actions")
                ? "Draw" : syntheticAttempt ? "Unsaved" : "Empty")
    }
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Picker("Fixture", selection: $scenario) {
                    ForEach(
                        [
                            "Empty", "Signed out", "Two inputs", "Many inputs", "Answer", "Waiting",
                            "Thinking",
                            "Streaming", "Blocked", "Prose corrections",
                            "No actions", "Selector hitboxes", "Long metadata", "Legacy answer",
                            "Draw", "Draw result", "Draw GIF", "Draw waiting", "Draw error",
                            "Research", "Research result", "Research waiting", "Research error",
                            "Meme", "Meme result", "Meme invalid",
                        ] + (syntheticAttempt ? ["Unsaved"] : []), id: \.self
                    ) {
                        Text($0)
                    }
                }
                Toggle("Dark", isOn: $dark)
                Button("Show Quick Lookup") { controller.show() }
                Button("Minimum panel") {
                    controller.show()
                    if let panel = NSApp.windows.first(where: { $0.title == "EZ Quick Lookup" }) {
                        panel.setContentSize(panel.contentMinSize)
                    }
                }
            }.padding(12)
            HStack(spacing: 20) {
                Button("Invoke Quick Lookup") { controller.toggle() }
                Toggle("Min Mode", isOn: $model.minimumMode)
                Toggle("Reduce motion (main preview)", isOn: $reduceMotion)
            }.toggleStyle(.checkbox).font(.caption).padding(.bottom, 6)
            Text(
                syntheticAttempt
                    ? "Disposable synthetic requests · No account or network access"
                    : "Offline fixture · synthetic Write/Draw · no API requests"
            )
            .font(.caption).foregroundStyle(.secondary).padding(.bottom, 8)
            Divider()
            ContentView(model: model)
                .environment(\.thinkingLightMotionDisabled, reduceMotion)
        }
        .preferredColorScheme(dark ? .dark : .light)
        .onAppear {
            NSApp.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
            loadFixture()
        }
        .onChange(of: scenario) { _, _ in loadFixture() }
        .onChange(of: dark) { _, value in
            NSApp.appearance = NSAppearance(named: value ? .darkAqua : .aqua)
        }
    }

    private func loadFixture() {
        model.stop()
        model.busy = false
        model.responseActivity = .waiting
        model.launcherPending = false
        model.newQuery()
        model.storageWarning = nil
        model.error = nil
        model.search = ""
        model.models = [
            ModelOption(catalog: [
                "visibility": "list", "slug": "fixture-luna", "display_name": "Luna (offline fixture)",
                "supported_reasoning_levels": [["effort": "medium"], ["effort": "high"]],
                "additional_speed_tiers": ["priority"],
            ])!
        ]
        var config = Configuration.starters(model: "fixture-luna", effort: "medium", fast: true)
        config.presets[0].name = "lit"
        config.presets.append(ModelPreset(name: "steady", model: "fixture-luna", effort: "high", fast: false))
        if scenario == "Selector hitboxes" {
            config.actions[0].name = "A deliberately long action title for checking the full selector hitbox"
            config.actions[1].name = "S"
            config.presets[0].name = "A deliberately long preset title"
            config.presets[1].name = "S"
        }
        if scenario == "Many inputs" {
            config.actions.append(
                Action(
                    name: "Long form", presetID: config.presets[0].id,
                    template: (1...8).map { "{{Input \($0)}}" }.joined(separator: "\n")))
        }
        if scenario.hasPrefix("Draw") { config.addIllustration() }
        if scenario.hasPrefix("Meme") || scenario.hasPrefix("Research") { config.addSearchAndMeme() }
        if scenario == "No actions" { config.actions = [] }
        do { try model.saveConfiguration(config) } catch { model.error = error.localizedDescription }
        let action: Action?
        if scenario.hasPrefix("Meme") {
            action = config.actions.first { $0.imageInput != nil }
        } else if scenario.hasPrefix("Research") {
            action = config.actions.first { $0.webSearch }
        } else if scenario.hasPrefix("Draw") {
            action = config.actions.first { $0.capability == .draw }
        } else if scenario == "Two inputs" {
            action = config.actions[3]
        } else if scenario == "Many inputs" {
            action = config.actions.last
        } else {
            action = config.actions.first
        }
        model.chooseAction(action?.id)
        model.signedIn = scenario != "Signed out"
        model.planEnabled = scenario != "Signed out"
        model.entries = []
        model.apiConnected = true
        if scenario.hasPrefix("Meme") {
            model.query = "Make this a Monday meme. Caption: already?"
            if scenario == "Meme invalid" {
                model.attachImage(data: Data("invalid".utf8), name: "bad.png")
            } else if let png = try? previewPNG() {
                model.attachImage(data: png, name: "sketch.png")
            }
            if scenario == "Meme result" { model.send() }
        }
        if scenario.hasPrefix("Research") {
            model.query = "How does sketch-to-meme work?"
            if scenario == "Research waiting" { model.query += " [slow]" }
            if scenario == "Research error" { model.query += " [fail]" }
            if scenario != "Research" { model.send() }
        }
        if scenario.hasPrefix("Draw") {
            if scenario == "Draw GIF" { model.outputFormatOverride = "gif" }
            model.query = "A tree shares nutrients through its roots and fungi."
            if scenario == "Draw waiting" { model.query += " [slow]" }
            if scenario == "Draw error" { model.query += " [fail]" }
            if scenario != "Draw" { model.send() }
        }
        if ["Answer", "Waiting", "Thinking", "Streaming", "Blocked", "Long metadata", "Legacy answer"]
            .contains(scenario)
        {
            model.query = "Serendipity"
        }
        if ["Answer", "Waiting", "Thinking", "Streaming", "Blocked", "Long metadata", "Legacy answer"]
            .contains(scenario), let action,
            let preset = model.currentPreset
        {
            if var entry = try? action.prepare(
                values: model.inputValues, preset: preset, models: model.models, provider: .chatGPTPlan)
            {
                entry.response =
                    "**Serendipity** means finding something valuable or pleasant by chance.\n\nExample: finding a book you love while searching for something else."
                let pending = ["Waiting", "Thinking", "Streaming"].contains(scenario)
                if ["Waiting", "Thinking"].contains(scenario) { entry.response = "" }
                model.responseActivity =
                    scenario == "Thinking" ? .thinking : scenario == "Streaming" ? .responding : .waiting
                entry.status = pending ? "pending" : "completed"
                entry.actualServiceTier = pending ? nil : "default"
                entry.metrics = ResponseMetrics(
                    inputTokens: pending ? nil : 128,
                    reasoningTokens: pending ? nil : 256,
                    outputTokens: pending ? nil : 320,
                    timeToFirstTokenSeconds: ["Waiting", "Thinking"].contains(scenario) ? nil : 0.82,
                    durationSeconds: pending ? nil : 4.2)
                if scenario == "Long metadata" {
                    entry.model = "fixture-model-with-a-deliberately-long-identifier-for-wrapping"
                    entry.presetSnapshot?.name =
                        "A deliberately long saved preset name for detailed translation"
                }
                if scenario == "Legacy answer" {
                    entry.presetSnapshot = nil
                    entry.metrics = nil
                    entry.actualServiceTier = nil
                }
                model.entries = [entry]
                model.selection = entry.id
                model.busy = pending
            }
        }
        if scenario == "Prose corrections" {
            var entry = HistoryEntry(
                mode: .spelling,
                query: """
                    our comunity garden opens on saturday.
                    please brings a small shovel and some water, we has extra gloves for everyone.

                    first, meet by the wooden gate so the organiser can explain the planting plan.

                    - label each row befor planting the seeds
                    - the new watering schedule should posted imediately
                    """,
                model: "fixture-luna", effort: "medium", requestedServiceTier: nil)
            entry.response = """
                Our community garden opens on Saturday.
                Please bring a small shovel and some water. We have extra gloves for everyone.

                First, meet by the wooden gate so the organizer can explain the planting plan.

                - Label each row before planting the seeds.
                - The new watering schedule should be posted immediately.

                Changes: Fixed spelling, agreement, capitalization, and punctuation.
                """
            entry.status = "completed"
            model.entries = [entry]
            model.selection = entry.id
        }
        if scenario == "Blocked" {
            model.models = []
            model.error =
                "The selected preset is unavailable. Open Configuration to choose a supported model."
            model.storageWarning = "Answer could not be saved. Copy it before quitting."
        }
        if scenario == "Unsaved" {
            model.query = "Serendipity"
            model.send()
        }
    }
}

@MainActor private func previewPNG() throws -> Data {
    let image = NSImage(size: NSSize(width: 720, height: 460), flipped: false) { bounds in
        NSColor(calibratedRed: 0.95, green: 0.96, blue: 0.92, alpha: 1).setFill()
        bounds.fill()
        NSColor(calibratedRed: 0.16, green: 0.43, blue: 0.35, alpha: 1).setFill()
        NSBezierPath(ovalIn: NSRect(x: 210, y: 135, width: 300, height: 240)).fill()
        NSColor(calibratedRed: 0.55, green: 0.37, blue: 0.22, alpha: 1).setFill()
        NSRect(x: 345, y: 50, width: 30, height: 180).fill()
        return true
    }
    guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
        let png = bitmap.representation(using: .png, properties: [:])
    else { throw EZError("Cannot create fixture PNG.") }
    return png
}
