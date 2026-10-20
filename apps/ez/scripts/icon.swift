import AppKit
import Foundation

let directory = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8,
            samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0,
            bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        let inset = Double(pixels) * 0.06
        let rect = NSRect(
            x: inset, y: inset, width: Double(pixels) - inset * 2, height: Double(pixels) - inset * 2)
        NSColor(calibratedRed: 0.14, green: 0.40, blue: 0.32, alpha: 1).setFill()
        NSBezierPath(roundedRect: rect, xRadius: Double(pixels) * 0.2, yRadius: Double(pixels) * 0.2).fill()
        let font = NSFont.systemFont(ofSize: Double(pixels) * 0.56, weight: .bold)
        let text = NSAttributedString(
            string: "ez", attributes: [.font: font, .foregroundColor: NSColor.white])
        let textSize = text.size()
        text.draw(
            at: NSPoint(
                x: (Double(pixels) - textSize.width) / 2,
                y: (Double(pixels) - textSize.height) / 2 + Double(pixels) * 0.04))
        NSGraphicsContext.restoreGraphicsState()
        let name = "icon_\(size)x\(size)\(scale == 2 ? "@2x" : "").png"
        try bitmap.representation(using: .png, properties: [:])!.write(
            to: directory.appendingPathComponent(name))
    }
}
