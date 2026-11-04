import Foundation
import ImageIO

public struct ImageGenerationRequest: Equatable, Sendable {
    public var prompt: String
    public var model: String
    public var size: String
    public var quality: String

    public init(
        prompt: String, model: String = "gpt-image-2.5-flare",
        size: String = "1024x1024", quality: String = "low"
    ) {
        self.prompt = prompt
        self.model = model
        self.size = size
        self.quality = quality
    }

    public func validate() throws {
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
        var request = URLRequest(url: URL(string: "https://api.openai.com/v1/images/generations")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 180
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "model": input.model, "prompt": input.prompt, "n": 1,
            "size": input.size, "quality": input.quality, "output_format": "png",
        ])
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
        return try Self.decodePNG(data)
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

    public static func decodePNG(_ data: Data) throws -> Data {
        guard data.count <= responseLimit,
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            let images = object["data"] as? [[String: Any]], images.count == 1,
            let encoded = images.first?["b64_json"] as? String,
            let png = Data(base64Encoded: encoded), !png.isEmpty, png.count <= 20 * 1024 * 1024,
            png.starts(with: [137, 80, 78, 71, 13, 10, 26, 10]),
            let source = CGImageSourceCreateWithData(png as CFData, nil),
            CGImageSourceGetCount(source) == 1,
            let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
            let width = properties[kCGImagePropertyPixelWidth] as? Int,
            let height = properties[kCGImagePropertyPixelHeight] as? Int,
            width > 0, height > 0, width <= 4096, height <= 4096,
            CGImageSourceCreateImageAtIndex(source, 0, nil) != nil
        else { throw EZError("OpenAI returned no valid PNG image. The previous image has been kept.") }
        return png
    }
}

private final class ImageRedirectPolicy: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(
        _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
    ) { completionHandler(nil) }
}
