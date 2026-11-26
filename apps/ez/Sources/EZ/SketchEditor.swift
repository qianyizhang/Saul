import SwiftUI

struct SketchEditor: View {
    private enum Tool: Hashable { case draw, select }
    private enum GestureEdit {
        case draw(SketchStroke)
        case move(SketchScene.Item)
        case resizePhoto
    }

    @ObservedObject var lookup: LookupSession
    let label: String
    @State private var tool = Tool.draw
    @State private var selection: SketchScene.Item?
    @State private var gestureEdit: GestureEdit?
    @State private var gestureBase: SketchScene?
    @State private var gesturePreview: SketchScene?
    @FocusState private var canvasFocused: Bool
    @FocusState private var captionFocused: Bool

    private var scene: SketchScene { lookup.sketch.scene }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(label).font(AppStyle.caption).foregroundStyle(AppStyle.secondaryText)
                Spacer()
                Button("Paste") { ImageImport.paste(lookup) }.accessibilityLabel("Paste image into sketch")
                    .help(scene.photo == nil ? "Paste an image" : "Replace the image in the sketch")
                Button(scene.photo == nil ? "Choose…" : "Replace…") { ImageImport.choose(lookup) }
                    .accessibilityLabel(scene.photo == nil ? "Choose sketch image" : "Replace sketch image")
            }
            HStack(spacing: 8) {
                Picker("Tool", selection: $tool) {
                    Text("Draw").tag(Tool.draw)
                    Text("Select").tag(Tool.select)
                }.pickerStyle(.segmented).labelsHidden().frame(width: 126)
                Spacer(minLength: 0)
                iconButton("Undo sketch edit", "arrow.uturn.backward", action: lookup.undoSketch)
                    .disabled(!lookup.sketch.canUndo)
                iconButton("Redo sketch edit", "arrow.uturn.forward", action: lookup.redoSketch)
                    .disabled(!lookup.sketch.canRedo)
                Button("Add text", systemImage: "textformat", action: addCaption)
                    .disabled(scene.captions.count >= SketchScene.captionLimit)
            }
            artboard
            if tool == .draw && scene.strokes.count >= SketchScene.strokeLimit {
                Text("Stroke limit reached. Select and remove a stroke to keep drawing.").font(
                    AppStyle.caption)
            }
            if let selection, scene.frame(for: selection) != nil {
                HStack {
                    if case .caption(let id) = selection {
                        TextField("Caption", text: captionText(id))
                            .textFieldStyle(.roundedBorder).accessibilityLabel("Caption text")
                            .focused($captionFocused)
                    }
                    Spacer(minLength: 0)
                    Button("Remove selected item", systemImage: "trash", action: removeSelection)
                        .labelStyle(.iconOnly).help("Remove selected item")
                }
            }
            ImageInputFeedback(lookup: lookup)
        }
        .controlSize(.small)
        .disabled(!lookup.canEditSketch)
        .onChange(of: tool) { _, value in if value == .draw { selection = nil } }
        .onChange(of: scene) { _, value in
            if let selection, value.frame(for: selection) == nil { self.selection = nil }
        }
        .onChange(of: lookup.canEditSketch) { _, enabled in if !enabled { finishGesture() } }
    }

    private var artboard: some View {
        let displayed = gesturePreview ?? scene
        return GeometryReader { geometry in
            let scale = geometry.size.width / SketchScene.side
            ZStack {
                SketchArtwork(scene: displayed, drawing: drawing)
                if !displayed.hasContent && drawing == nil && selection == nil {
                    Text("Draw or paste an image")
                        .font(AppStyle.caption).foregroundStyle(Color(nsColor: .darkGray))
                        .allowsHitTesting(false).accessibilityHidden(true)
                }
                if let selection, let frame = displayed.frame(for: selection) {
                    selectionOutline(frame, scale: scale, resize: selection == .photo)
                }
            }
            .clipShape(.rect(cornerRadius: 6))
            .overlay { RoundedRectangle(cornerRadius: 6).strokeBorder(.quaternary, lineWidth: 1) }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { changeGesture($0, scale: scale) }
                    .onEnded { endGesture($0, scale: scale) }
            )
            .focusable()
            .focused($canvasFocused)
            .onPasteCommand(of: ImageImport.types) { _ = ImageImport.receive($0, lookup: lookup) }
            .onDeleteCommand(perform: removeSelection)
            .onKeyPress(.space) { selectNext() ? .handled : .ignored }
            .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow], action: adjustSelection)
            .accessibilityLabel("Sketch canvas")
            .accessibilityHint(
                "Space selects the next item. Arrow keys move it; Shift with arrows resizes an image."
            )
            .accessibilityAction(named: "Select next sketch item") { _ = selectNext() }
            .modifier(ImageDropTarget(lookup: lookup))
        }
        .aspectRatio(1, contentMode: .fit)
        .frame(maxWidth: 392)
        .frame(maxWidth: .infinity)
    }

    private var drawing: SketchStroke? {
        if case .draw(let stroke) = gestureEdit { return stroke }
        return nil
    }

    private func selectionOutline(_ frame: CGRect, scale: CGFloat, resize: Bool) -> some View {
        let scaled = frame.applying(CGAffineTransform(scaleX: scale, y: scale))
        return ZStack(alignment: .topLeading) {
            Rectangle().strokeBorder(Color.accentColor, style: StrokeStyle(lineWidth: 2, dash: [5, 3]))
                .frame(width: scaled.width, height: scaled.height)
                .position(x: scaled.midX, y: scaled.midY)
            if resize {
                RoundedRectangle(cornerRadius: 2).fill(Color.accentColor)
                    .overlay { RoundedRectangle(cornerRadius: 2).strokeBorder(.white, lineWidth: 1) }
                    .frame(width: 13, height: 13)
                    .position(
                        x: max(scaled.minX + 6.5, scaled.maxX - 6.5),
                        y: max(scaled.minY + 6.5, scaled.maxY - 6.5))
            }
        }.allowsHitTesting(false).accessibilityHidden(true)
    }

    private func iconButton(_ name: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: symbol) }
            .accessibilityLabel(name).help(name)
    }

    private func addCaption() {
        var next = scene
        guard let id = next.addCaption() else { return }
        lookup.commitSketch(next)
        tool = .select
        selection = .caption(id)
        captionFocused = true
    }

    private func captionText(_ id: UUID) -> Binding<String> {
        Binding {
            scene.captions.first { $0.id == id }?.text ?? ""
        } set: { value in
            var next = scene
            guard let index = next.captions.firstIndex(where: { $0.id == id }) else { return }
            next.captions[index].text = String(value.unicodeScalars.prefix(120))
            lookup.commitSketch(next)
        }
    }

    private func removeSelection() {
        guard let selection else { return }
        var next = scene
        next.remove(selection)
        lookup.commitSketch(next)
        self.selection = nil
    }

    private func selectNext() -> Bool {
        let items = scene.items
        guard !items.isEmpty else { return false }
        let index = selection.flatMap { items.firstIndex(of: $0) } ?? -1
        tool = .select
        selection = items[(index + 1) % items.count]
        return true
    }

    private func adjustSelection(_ press: KeyPress) -> KeyPress.Result {
        guard let selection, press.modifiers.intersection([.command, .option, .control]).isEmpty
        else { return .ignored }
        let dx: CGFloat = press.key == .leftArrow ? -8 : press.key == .rightArrow ? 8 : 0
        let dy: CGFloat = press.key == .upArrow ? -8 : press.key == .downArrow ? 8 : 0
        var next = scene
        if selection == .photo && press.modifiers.contains(.shift) {
            next.resizePhoto(dx: dx, dy: dy)
        } else {
            next.move(selection, dx: dx, dy: dy)
        }
        lookup.commitSketch(next)
        return .handled
    }

    private func changeGesture(_ value: DragGesture.Value, scale: CGFloat) {
        guard lookup.canEditSketch, scale > 0 else { return }
        if gestureBase == nil {
            let start = SketchScene.clamped(
                CGPoint(x: value.startLocation.x / scale, y: value.startLocation.y / scale))
            canvasFocused = true
            gestureBase = scene
            if tool == .draw {
                guard scene.strokes.count < SketchScene.strokeLimit else { return }
                gestureEdit = .draw(SketchStroke(points: [start]))
            } else if selection == .photo, let photo = scene.photo,
                abs(photo.frame.maxX - start.x) * scale <= 19,
                abs(photo.frame.maxY - start.y) * scale <= 19
            {
                gestureEdit = .resizePhoto
            } else {
                selection = scene.hit(at: start)
                if let selection { gestureEdit = .move(selection) }
            }
            if gestureEdit != nil { lookup.beginSketchEdit() }
        }
        switch gestureEdit {
        case .draw(var stroke):
            let point = SketchScene.clamped(CGPoint(x: value.location.x / scale, y: value.location.y / scale))
            if stroke.points.count < 1024, let last = stroke.points.last,
                SketchScene.distance(last, point) >= 1.5
            {
                stroke.points.append(point)
                gestureEdit = .draw(stroke)
            }
        case .move(let item):
            var preview = gestureBase
            preview?.move(item, dx: value.translation.width / scale, dy: value.translation.height / scale)
            gesturePreview = preview
        case .resizePhoto:
            var preview = gestureBase
            preview?.resizePhoto(dx: value.translation.width / scale, dy: value.translation.height / scale)
            gesturePreview = preview
        case nil:
            break
        }
    }

    private func endGesture(_ value: DragGesture.Value, scale: CGFloat) {
        defer { finishGesture() }
        changeGesture(value, scale: scale)
        guard scene == gestureBase else { return }
        if let drawing {
            var next = scene
            next.strokes.append(drawing)
            lookup.commitSketch(next)
        } else if let gesturePreview {
            lookup.commitSketch(gesturePreview)
        }
    }

    private func finishGesture() {
        gestureBase = nil
        gestureEdit = nil
        gesturePreview = nil
    }
}
