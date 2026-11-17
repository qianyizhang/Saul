import Foundation

public struct SharedPresets: Codable {
  public let revision: Int
  public var presets: [ModelPreset]
  public var connections: [ConnectionDefinition]
  public init(
    revision: Int, presets: [ModelPreset],
    connections: [ConnectionDefinition] = ConnectionDefinition.defaults
  ) {
    self.revision = revision
    self.presets = presets
    self.connections = connections
  }
  private enum CodingKeys: String, CodingKey { case revision, presets, connections }
  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    revision = try c.decode(Int.self, forKey: .revision)
    presets = try c.decode([ModelPreset].self, forKey: .presets)
    connections = try c.decode([ConnectionDefinition].self, forKey: .connections)
  }
}

/// The shared settings envelope is read by the signed owner and edited by EZ.
public enum SharedSettingsDocument {
  public static var defaultURL: URL {
    FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("Little Clarity/settings.json")
  }

  public static func readLibrary(at url: URL = defaultURL) throws -> SharedPresets {
    try library(ConnectionSettingsMigration.document(load(at: url)))
  }

  public static func load(at url: URL) throws -> [String: Any] {
    let data: Data
    do { data = try Data(contentsOf: url) } catch CocoaError.fileReadNoSuchFile {
      return [:]
    }
    guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw NativeValueError("Shared settings must be a JSON object.")
    }
    return value
  }
  public static func library(_ document: [String: Any]) throws -> SharedPresets {
    var section: [String: Any]
    if let raw = document["modelPresets"] {
      guard let value = raw as? [String: Any] else {
        throw NativeValueError("Model presets must be a JSON object.")
      }
      section = value
    } else {
      return SharedPresets(revision: 0, presets: [])
    }
    let result = try JSONDecoder().decode(
      SharedPresets.self,
      from: JSONSerialization.data(withJSONObject: section))
    guard result.revision >= 0 else { throw NativeValueError("Invalid shared preset revision.") }
    try validate(result.presets)
    try ConnectionDefinition.validate(result.connections)
    return result
  }
  public static func validate(_ presets: [ModelPreset]) throws {
    guard presets.count <= 128, Set(presets.map(\.id)).count == presets.count,
      Set(presets.map { $0.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() })
        .count
        == presets.count,
      presets.allSatisfy({
        !$0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
          && $0.name.utf16.count <= 80
          && $0.model.utf16.count <= 256 && $0.effort.utf16.count <= 64
      })
    else {
      throw NativeValueError(
        "Shared presets need unique IDs and names, a model, effort, and speed.")
    }
    for preset in presets {
      guard
        preset.connectionKey.range(of: "^[a-z][a-z0-9-]{0,63}$", options: .regularExpression) != nil
      else { throw NativeValueError("Invalid connection key in shared presets.") }
      if let options = preset.imageOptions { try options.validate() }
      if let options = preset.speechOptions { try options.validate() }
    }
  }
}
