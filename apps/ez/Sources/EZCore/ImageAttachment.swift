import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Exact user-supplied bytes. Codable stores metadata only; History owns the SQLite blob.
public struct ImageAttachment: Codable, Equatable, Sendable {
    public var name: String
    public var mediaType: String
    public var data: Data?
    private enum CodingKeys: String, CodingKey { case name, mediaType }
    public static let byteLimit = 20 * 1024 * 1024

    public init(data: Data, name: String) throws {
        guard !data.isEmpty, data.count <= Self.byteLimit,
            let source = CGImageSourceCreateWithData(data as CFData, nil),
            CGImageSourceGetCount(source) == 1,
            let type = CGImageSourceGetType(source) as String?,
            let mime = [
                UTType.png.identifier: "image/png", UTType.jpeg.identifier: "image/jpeg",
                UTType.webP.identifier: "image/webp",
            ][type],
            let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
            let width = properties[kCGImagePropertyPixelWidth] as? Int,
            let height = properties[kCGImagePropertyPixelHeight] as? Int,
            width > 0, height > 0, width <= 8192, height <= 8192,
            width * height <= 40_000_000,
            CGImageSourceCreateImageAtIndex(source, 0, nil) != nil
        else {
            throw EZError(
                "Choose one PNG, JPEG or WebP image, up to 20 MB and 40 megapixels (8,192 pixels per edge).")
        }
        self.data = data
        self.name = String(URL(fileURLWithPath: name).lastPathComponent.prefix(200))
        self.mediaType = mime
    }

    public func validatedData() throws -> Data {
        guard let data else {
            throw EZError("The input image is unavailable. Attach it again before running.")
        }
        let checked = try Self(data: data, name: name)
        guard checked.mediaType == mediaType else {
            throw EZError("The input image format changed. Attach it again.")
        }
        return data
    }
}
