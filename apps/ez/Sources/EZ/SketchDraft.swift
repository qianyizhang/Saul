import CoreText
import EZCore
import ImageIO
import SaulNativeValues
import SwiftUI
import UniformTypeIdentifiers

/// In-memory composition. History stores only the image that was sent.
struct SketchDraft {
    private(set) var scene = SketchScene()
    private var past: [SketchScene] = []
    private var future: [SketchScene] = []
    var canUndo: Bool { !past.isEmpty }
    var canRedo: Bool { !future.isEmpty }

    mutating func commit(_ next: SketchScene) {
        guard next != scene else { return }
        past.append(scene)
        scene = next
        future.removeAll()
        // Snapshots share their photo data. Keep at most two distinct photos in memory.
        while past.count > 24 || Set((past + [scene]).compactMap { $0.photo?.asset.id }).count > 2 {
            past.removeFirst()
        }
    }

    mutating func undo() {
        guard let previous = past.popLast() else { return }
        future.append(scene)
        scene = previous
    }

    mutating func redo() {
        guard let next = future.popLast() else { return }
        past.append(scene)
        scene = next
    }

    init(restoring photo: SketchPhoto) {
        scene.photo = photo
    }

    init() {}
}

struct SketchPhoto: Equatable, Sendable {
    struct Asset: Equatable, Sendable {
        let id = UUID()
        let attachment: ImageAttachment
        let image: CGImage

        static func == (lhs: Self, rhs: Self) -> Bool { lhs.id == rhs.id }
    }

    let asset: Asset
    var frame: CGRect
    let originalFrame: CGRect

    static func prepareRestoration(_ attachment: ImageAttachment) async throws -> Self {
        let work = Task.detached {
            try Task.checkCancellation()
            return try Self(attachment)
        }
        return try await withTaskCancellationHandler {
            try await work.value
        } onCancel: {
            work.cancel()
        }
    }

    init(_ attachment: ImageAttachment) throws {
        guard let data = attachment.data,
            let source = CGImageSourceCreateWithData(data as CFData, nil),
            let image = CGImageSourceCreateThumbnailAtIndex(
                source, 0,
                [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                    kCGImageSourceThumbnailMaxPixelSize: SketchScene.pixelSize,
                ] as CFDictionary)
        else { throw EZError("This image could not be opened in the sketch.") }
        asset = Asset(attachment: attachment, image: image)
        let width = CGFloat(image.width)
        let height = CGFloat(image.height)
        let scale = SketchScene.side / max(width, height)
        originalFrame = CGRect(
            x: (SketchScene.side - width * scale) / 2, y: (SketchScene.side - height * scale) / 2,
            width: width * scale, height: height * scale)
        frame = originalFrame
    }
}

struct SketchStroke: Equatable, Identifiable {
    let id = UUID()
    var points: [CGPoint]
    var bounds: CGRect {
        guard let first = points.first else { return .zero }
        return points.dropFirst().reduce(CGRect(origin: first, size: .zero)) { bounds, point in
            bounds.union(CGRect(origin: point, size: .zero))
        }
    }
}

struct SketchCaption: Equatable, Identifiable {
    let id = UUID()
    var text = ""
    var frame: CGRect
    var hasText: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}

struct SketchScene: Equatable {
    enum Item: Hashable {
        case photo
        case stroke(UUID)
        case caption(UUID)
    }

    static let side: CGFloat = 512
    static let pixelSize = 1024
    static let bounds = CGRect(x: 0, y: 0, width: side, height: side)
    static let strokeWidth: CGFloat = 5
    static let strokeLimit = 128
    static let captionLimit = 16
    var photo: SketchPhoto?
    var strokes: [SketchStroke] = []
    var captions: [SketchCaption] = []
    var hasContent: Bool { photo != nil || !strokes.isEmpty || captions.contains(where: \.hasText) }
    var items: [Item] {
        (photo == nil ? [] : [.photo]) + strokes.map { .stroke($0.id) } + captions.map { .caption($0.id) }
    }

    func frame(for item: Item) -> CGRect? {
        switch item {
        case .photo: photo?.frame
        case .stroke(let id): strokes.first { $0.id == id }?.bounds.insetBy(dx: -7, dy: -7)
        case .caption(let id): captions.first { $0.id == id }?.frame
        }
    }

    func hit(at point: CGPoint) -> Item? {
        if let caption = captions.last(where: { $0.frame.contains(point) }) { return .caption(caption.id) }
        if let stroke = strokes.last(where: { stroke in
            guard stroke.bounds.insetBy(dx: -9, dy: -9).contains(point), let first = stroke.points.first
            else { return false }
            if stroke.points.count == 1 { return Self.distance(point, first) < 9 }
            return zip(stroke.points, stroke.points.dropFirst()).contains { a, b in
                let dx = b.x - a.x
                let dy = b.y - a.y
                let length = dx * dx + dy * dy
                guard length > 0 else { return Self.distance(point, a) < 9 }
                let t = min(1, max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length))
                return Self.distance(point, CGPoint(x: a.x + dx * t, y: a.y + dy * t)) < 9
            }
        }) {
            return .stroke(stroke.id)
        }
        return photo?.frame.contains(point) == true ? .photo : nil
    }

    mutating func move(_ item: Item, dx: CGFloat, dy: CGFloat) {
        switch item {
        case .photo:
            if let frame = photo?.frame { photo?.frame = Self.moved(frame, dx, dy) }
        case .caption(let id):
            if let index = captions.firstIndex(where: { $0.id == id }) {
                captions[index].frame = Self.moved(captions[index].frame, dx, dy)
            }
        case .stroke(let id):
            if let index = strokes.firstIndex(where: { $0.id == id }) {
                let bounds = strokes[index].bounds
                let moved = Self.moved(bounds, dx, dy)
                strokes[index].points = strokes[index].points.map {
                    CGPoint(x: $0.x + moved.minX - bounds.minX, y: $0.y + moved.minY - bounds.minY)
                }
            }
        }
    }

    mutating func resizePhoto(dx: CGFloat, dy: CGFloat) {
        guard let frame = photo?.frame else { return }
        let maxScale = min((Self.side - frame.minX) / frame.width, (Self.side - frame.minY) / frame.height)
        let primary =
            (dx * frame.width + dy * frame.height) / (frame.width * frame.width + frame.height * frame.height)
        let scale = min(maxScale, max(36 / max(frame.width, frame.height), 1 + primary))
        photo?.frame.size = CGSize(width: frame.width * scale, height: frame.height * scale)
    }

    mutating func remove(_ item: Item) {
        switch item {
        case .photo: photo = nil
        case .stroke(let id): strokes.removeAll { $0.id == id }
        case .caption(let id): captions.removeAll { $0.id == id }
        }
    }

    mutating func addCaption() -> UUID? {
        guard captions.count < Self.captionLimit else { return nil }
        let offset = CGFloat(captions.count % 6) * 37
        let caption = SketchCaption(frame: CGRect(x: 24, y: 404 - offset, width: 464, height: 84))
        captions.append(caption)
        return caption.id
    }

    func attachmentForRun() throws -> ImageAttachment? {
        guard hasContent else { return nil }
        if let photo, photo.frame == photo.originalFrame, strokes.isEmpty,
            !captions.contains(where: \.hasText)
        {
            return photo.asset.attachment
        }
        let pixels = Self.pixelSize
        guard
            let context = CGContext(
                data: nil, width: pixels, height: pixels, bitsPerComponent: 8, bytesPerRow: 0,
                space: CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { throw EZError("The sketch could not be rendered. Your draft is still open.") }
        context.translateBy(x: 0, y: CGFloat(pixels))
        context.scaleBy(x: 1, y: -1)
        draw(in: context, size: CGSize(width: pixels, height: pixels))
        let png = NSMutableData()
        guard let image = context.makeImage(),
            let output = CGImageDestinationCreateWithData(png, UTType.png.identifier as CFString, 1, nil)
        else { throw EZError("The sketch could not be rendered. Your draft is still open.") }
        CGImageDestinationAddImage(output, image, nil)
        guard CGImageDestinationFinalize(output) else {
            throw EZError("The sketch could not be saved as PNG. Your draft is still open.")
        }
        return try ImageAttachment(data: png as Data, name: "Sketch.png")
    }

    /// Artwork uses top-left coordinates in both the view and the flattened source.
    func draw(in context: CGContext, size: CGSize, drawing: SketchStroke? = nil) {
        context.saveGState()
        defer { context.restoreGState() }
        context.scaleBy(x: size.width / Self.side, y: size.height / Self.side)
        context.clip(to: Self.bounds)
        context.setFillColor(gray: 1, alpha: 1)
        context.fill(Self.bounds)
        if let photo {
            context.saveGState()
            context.translateBy(x: photo.frame.minX, y: photo.frame.maxY)
            context.scaleBy(x: 1, y: -1)
            context.draw(photo.asset.image, in: CGRect(origin: .zero, size: photo.frame.size))
            context.restoreGState()
        }
        for stroke in strokes { draw(stroke, in: context) }
        if let drawing { draw(drawing, in: context) }
        for caption in captions where caption.hasText { draw(caption, in: context) }
    }

    private func draw(_ stroke: SketchStroke, in context: CGContext) {
        guard let first = stroke.points.first else { return }
        let width = Self.strokeWidth
        if stroke.points.count == 1 {
            context.setFillColor(gray: 0, alpha: 1)
            context.fillEllipse(
                in: CGRect(
                    x: first.x - width / 2, y: first.y - width / 2,
                    width: width, height: width))
        } else {
            context.setStrokeColor(gray: 0, alpha: 1)
            context.setLineWidth(width)
            context.setLineCap(.round)
            context.setLineJoin(.round)
            context.addLines(between: stroke.points)
            context.strokePath()
        }
    }

    private func draw(_ caption: SketchCaption, in context: CGContext) {
        context.setFillColor(gray: 1, alpha: 1)
        context.addPath(CGPath(roundedRect: caption.frame, cornerWidth: 7, cornerHeight: 7, transform: nil))
        context.fillPath()
        let frame = caption.frame.insetBy(dx: 10, dy: 8)
        let bounds = CGRect(origin: .zero, size: frame.size)
        context.saveGState()
        defer { context.restoreGState() }
        context.translateBy(x: frame.minX, y: frame.maxY)
        context.scaleBy(x: 1, y: -1)
        context.textMatrix = .identity
        for size in [CGFloat(26), 22, 18, 14] {
            let attributed = NSAttributedString(
                string: caption.text,
                attributes: [
                    NSAttributedString.Key(kCTFontAttributeName as String):
                        CTFontCreateWithName("HelveticaNeue-Bold" as CFString, size, nil),
                    NSAttributedString.Key(kCTForegroundColorAttributeName as String):
                        CGColor(gray: 0, alpha: 1),
                ])
            let setter = CTFramesetterCreateWithAttributedString(attributed)
            let layout = CTFramesetterCreateFrame(
                setter, CFRange(), CGPath(rect: bounds, transform: nil), nil)
            if CTFrameGetVisibleStringRange(layout).length == attributed.length || size == 14 {
                CTFrameDraw(layout, context)
                break
            }
        }
    }

    static func distance(_ a: CGPoint, _ b: CGPoint) -> CGFloat { hypot(a.x - b.x, a.y - b.y) }

    static func clamped(_ point: CGPoint) -> CGPoint {
        CGPoint(x: min(side, max(0, point.x)), y: min(side, max(0, point.y)))
    }

    private static func moved(_ frame: CGRect, _ dx: CGFloat, _ dy: CGFloat) -> CGRect {
        CGRect(
            x: min(side - frame.width, max(0, frame.minX + dx)),
            y: min(side - frame.height, max(0, frame.minY + dy)),
            width: frame.width, height: frame.height)
    }
}

struct SketchArtwork: View {
    let scene: SketchScene
    var drawing: SketchStroke?

    var body: some View {
        Canvas(opaque: true) { context, size in
            context.withCGContext { scene.draw(in: $0, size: size, drawing: drawing) }
        }
    }
}
