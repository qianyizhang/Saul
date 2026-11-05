import Foundation
import ImageIO

public struct ImageGenerationRequest: Equatable, Sendable {
    public var prompt: String
    public var model: String
    public var size: String
    public var quality: String
    public var outputFormat: String
    public var image: ImageAttachment?

    public init(
        prompt: String, model: String = "gpt-image-2.6-flare",
        size: String = "1024x1024", quality: String = "low", outputFormat: String = "png",
        image: ImageAttachment? = nil
    ) {
        self.prompt = prompt
        self.model = model
        self.size = size
        self.quality = quality
        self.outputFormat = outputFormat
        self.image = image
    }

    public func validate() throws {
        guard ImageModelOption.formats.contains(outputFormat) else {
            throw EZError("Choose PNG or GIF output.")
        }
        if outputFormat == "gif" {
            guard model.hasPrefix("gpt-image-2.6-") else {
                throw EZError("GIF output requires GPT Image 2.6.")
            }
            guard image == nil else {
                throw EZError(
                    "GIF output is unavailable for image edits. Choose PNG or an action without an input image."
                )
            }
        }
        if let image { _ = try image.validatedData() }
        guard !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw EZError("Enter some context to illustrate.")
        }
        guard prompt.unicodeScalars.count <= 32_000, prompt.utf8.count <= 128_000 else {
            throw EZError("Shorten the prompt to fit 32,000 characters.")
        }
        guard ImageModelOption.openAIModels.contains(where: { $0.id == model }),
            ImageModelOption.sizes.contains(size), ImageModelOption.qualities.contains(quality)
        else { throw EZError("Choose a supported image model, size and quality.") }
    }
}

public struct ImagesClient: Sendable {
    private let session: URLSession
    private static let responseLimit = 28 * 1024 * 1024

    public init(session: URLSession? = nil) {
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.httpShouldSetCookies = false
            configuration.urlCache = nil
            configuration.timeoutIntervalForRequest = 180
            configuration.timeoutIntervalForResource = 180
            self.session = URLSession(configuration: configuration)
        }
    }

    public func generate(_ input: ImageGenerationRequest, apiKey: String) async throws
        -> Data
    {
        try input.validate()
        let key = try validatedOpenAIKey(apiKey)
        try Task.checkCancellation()
        let endpoint = input.image == nil ? "generations" : "edits"
        var request = URLRequest(url: URL(string: "https://api.openai.com/v1/images/\(endpoint)")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 180
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        let fields = [
            "model": input.model, "prompt": input.prompt, "n": "1",
            "size": input.size, "quality": input.quality, "output_format": input.outputFormat,
        ]
        if let image = input.image {
            let boundary = "EZ-" + UUID().uuidString
            request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            var body = Data()
            func add(_ text: String) { body.append(Data(text.utf8)) }
            for key in fields.keys.sorted() {
                add(
                    "--\(boundary)\r\nContent-Disposition: form-data; name=\"\(key)\"\r\n\r\n\(fields[key]!)\r\n"
                )
            }
            // A constant filename keeps user filenames out of multipart headers.
            add(
                "--\(boundary)\r\nContent-Disposition: form-data; name=\"image[]\"; filename=\"input\"\r\nContent-Type: \(image.mediaType)\r\n\r\n"
            )
            body.append(try image.validatedData())
            add("\r\n--\(boundary)--\r\n")
            request.httpBody = body
        } else {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            var object: [String: Any] = fields
            object["n"] = 1
            request.httpBody = try JSONSerialization.data(withJSONObject: object)
        }
        let (bytes, response) = try await session.bytes(for: request, delegate: ImageRedirectPolicy())
        guard let response = response as? HTTPURLResponse else {
            throw EZError("OpenAI returned an invalid image response.")
        }
        let limit = (200..<300).contains(response.statusCode) ? Self.responseLimit : 64 * 1024
        guard response.expectedContentLength <= limit else {
            throw EZError("OpenAI's image response is too large. Try a smaller image.")
        }
        var data = Data()
        for try await byte in bytes {
            guard data.count < limit else {
                throw EZError("OpenAI's image response is too large. Try a smaller image.")
            }
            data.append(byte)
        }
        try Task.checkCancellation()
        guard (200..<300).contains(response.statusCode) else {
            throw Self.rejection(data: data, status: response.statusCode)
        }
        return try Self.decodeImage(data, format: input.outputFormat)
    }

    private static func rejection(data: Data, status: Int) -> EZError {
        let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let error = object?["error"] as? [String: Any]
        let code = error?["code"] as? String
        if code == "moderation_blocked" || code == "content_policy_violation" {
            return EZError("OpenAI blocked this image request. Revise the action inputs or prompt.")
        }
        if code == "insufficient_quota" || code == "billing_hard_limit_reached" {
            return EZError("OpenAI API quota is unavailable. Check your API billing and limits.")
        }
        if code == "model_not_found" {
            return EZError(
                "This API key cannot use the selected image model. Check model access or choose another model."
            )
        }
        switch status {
        case 401: return EZError("OpenAI rejected the API key. Replace it in Connection.")
        case 403:
            return EZError(
                "Image access was denied. Check this API project's permissions and organization verification."
            )
        case 429:
            return EZError(
                "OpenAI's API rate or quota limit was reached. Check API billing and limits before trying again."
            )
        case 500...599: return EZError("OpenAI could not finish the image request. Try again later.")
        default:
            return EZError(
                "OpenAI rejected the image request (HTTP \(status)). Check the context and image settings.")
        }
    }

    public static func decodePNG(_ data: Data) throws -> Data { try decodeImage(data, format: "png") }

    public static func decodeImage(_ data: Data, format: String) throws -> Data {
        guard data.count <= responseLimit,
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            let images = object["data"] as? [[String: Any]], images.count == 1,
            let encoded = images.first?["b64_json"] as? String,
            let png = Data(base64Encoded: encoded), !png.isEmpty, png.count <= 20 * 1024 * 1024,
            format == "png"
                ? png.starts(with: [137, 80, 78, 71, 13, 10, 26, 10])
                : format == "gif"
                    && (png.starts(with: Array("GIF89a".utf8)) || png.starts(with: Array("GIF87a".utf8))),
            let source = CGImageSourceCreateWithData(png as CFData, nil),
            format == "png"
                ? CGImageSourceGetCount(source) == 1 : (2...64).contains(CGImageSourceGetCount(source)),
            let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
            let width = properties[kCGImagePropertyPixelWidth] as? Int,
            let height = properties[kCGImagePropertyPixelHeight] as? Int,
            width > 0, height > 0, width <= 4096, height <= 4096,
            CGImageSourceCreateImageAtIndex(source, 0, nil) != nil
        else {
            throw EZError(
                "OpenAI returned no valid \(format.uppercased()) image. The previous image has been kept.")
        }
        if let source = CGImageSourceCreateWithData(png as CFData, nil), format == "gif" {
            for index in 0..<CGImageSourceGetCount(source) {
                guard CGImageSourceCreateImageAtIndex(source, index, nil) != nil else {
                    throw EZError("OpenAI returned an invalid GIF frame.")
                }
            }
        }
        return png
    }
}

private final class ImageRedirectPolicy: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(
        _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
    ) { completionHandler(nil) }
}
