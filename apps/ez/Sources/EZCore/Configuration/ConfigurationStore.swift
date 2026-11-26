import Foundation
import SaulNativeValues

public final class ConfigurationStore {
    public let url: URL
    private let shared: SharedPresetsStore?
    private var scopedRevision = 0
    public init(directory: URL, shared: SharedPresetsStore? = nil) {
        url = directory.appendingPathComponent("configuration.json")
        self.shared = shared
    }

    public func load() throws -> Configuration? {
        if let shared {
            let section = try shared.configurationSnapshot()
            if var value = section.value {
                let library = section.library
                value["presets"] = try JSONSerialization.jsonObject(
                    with: JSONEncoder().encode(library.presets))
                value["connections"] = try JSONSerialization.jsonObject(
                    with: JSONEncoder().encode(library.connections))
                value["sharedPresetRevision"] = library.revision
                let result = try JSONDecoder().decode(
                    Configuration.self, from: JSONSerialization.data(withJSONObject: value))
                try result.validate()
                scopedRevision = section.revision
                return result
            }
            scopedRevision = section.revision
        }
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let data = try Data(contentsOf: url)
        guard data.count <= 1_048_576 else {
            throw EZError("Configuration file is too large. Original file is preserved.")
        }
        let original: [String: Any]
        do {
            guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw EZError("Configuration must be an object.")
            }
            original = object
        } catch {
            throw DecodingError.dataCorrupted(
                .init(
                    codingPath: [],
                    debugDescription: "Invalid configuration JSON. Original file is preserved.",
                    underlyingError: error))
        }
        let upgraded = try ConnectionSettingsMigration.configuration(original)
        var result = try JSONDecoder().decode(
            Configuration.self, from: JSONSerialization.data(withJSONObject: upgraded))
        try result.validate()
        if !NSDictionary(dictionary: original).isEqual(to: upgraded) { try writeLocal(result) }
        if let shared {
            let migrating = result.sharedPresetRevision == nil
            let library =
                try migrating
                ? shared.migrate(result.presets, connections: result.connections) : shared.read()
            result.presets = library.presets
            result.connections = library.connections
            result.sharedPresetRevision = library.revision
            if migrating { try writeLocal(result) }
            try writeScope(result, shared: shared)
        }
        return result
    }

    @discardableResult public func save(_ configuration: Configuration, fence: ConnectionFence? = nil) throws
        -> Configuration
    {
        try configuration.validate()
        guard let shared else {
            if fence != nil { throw EZError("Shared configuration is unavailable.") }
            try writeLocal(configuration)
            return configuration
        }
        let committed = try shared.saveConfiguration(
            configuration, scopedRevision: scopedRevision, fence: fence)
        scopedRevision = committed.scopedRevision
        var saved = configuration
        saved.connections = committed.library.connections
        saved.presets = committed.library.presets
        saved.sharedPresetRevision = committed.library.revision
        return saved
    }
    private func writeScope(_ configuration: Configuration, shared: SharedPresetsStore) throws {
        guard
            var value = try JSONSerialization.jsonObject(with: JSONEncoder().encode(configuration))
                as? [String: Any]
        else { throw EZError("Configuration must be an object.") }
        value.removeValue(forKey: "presets")
        value.removeValue(forKey: "connections")
        value.removeValue(forKey: "sharedPresetRevision")
        scopedRevision = try shared.saveAppSection("configuration", value: value, revision: scopedRevision)
    }
    private func writeLocal(_ configuration: Configuration) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(configuration)
        guard data.count <= 1_048_576 else { throw EZError("Configuration exceeds the 1 MB storage limit.") }
        do {
            try AtomicFile.write(data, to: url)
        } catch AtomicFile.Failure.staging {
            throw EZError("Cannot write configuration. Previous configuration is preserved.")
        } catch AtomicFile.Failure.replacing(let error) {
            throw EZError(
                "Cannot replace configuration: \(error.localizedDescription). Previous configuration is preserved."
            )
        }
    }
}
