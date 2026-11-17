import Foundation

public struct ImageGenerationRequest: Equatable, Sendable {
  public var prompt: String
  public var model: String
  public var size: String
  public var quality: String
  public var outputFormat: String
  public var image: ImageAttachment?
  public var connectionKey: String?

  public init(
    prompt: String, model: String = "",
    size: String = "1024x1024", quality: String = "low", outputFormat: String = "png",
    image: ImageAttachment? = nil, connectionKey: String? = nil
  ) {
    self.prompt = prompt
    self.model = model
    self.size = size
    self.quality = quality
    self.outputFormat = outputFormat
    self.image = image
    self.connectionKey = connectionKey
  }

  public func validate() throws {
    guard ImageOptions.formats.contains(outputFormat) else {
      throw NativeValueError("Choose PNG or GIF output.")
    }
    if outputFormat == "gif" {
      guard model.hasPrefix("gpt-image-2.6-") else {
        throw NativeValueError("GIF output requires GPT Image 2.6.")
      }
      guard image == nil else {
        throw NativeValueError(
          "GIF output is unavailable for image edits. Choose PNG or an action without an input image."
        )
      }
    }
    if let image { _ = try image.validatedData() }
    guard !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw NativeValueError("Enter some context to illustrate.")
    }
    guard prompt.unicodeScalars.count <= 32_000, prompt.utf8.count <= 128_000 else {
      throw NativeValueError("Shorten the prompt to fit 32,000 characters.")
    }
    guard !model.isEmpty, model.utf8.count <= 256,
      ImageOptions.sizes.contains(size), ImageOptions.qualities.contains(quality)
    else { throw NativeValueError("Choose a supported image model, size and quality.") }
  }
}
