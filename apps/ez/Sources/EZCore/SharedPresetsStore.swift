import Foundation

public struct SharedPresets: Codable {
    public let revision: Int
    public var presets: [ModelPreset]
    public var providers: [ProviderDefinition]
    public init(
        revision: Int, presets: [ModelPreset], providers: [ProviderDefinition] = ProviderDefinition.defaults
    ) {
        self.revision = revision
        self.presets = presets
        self.providers = providers
    }
    private enum CodingKeys: String, CodingKey { case revision, presets, providers }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        revision = try c.decode(Int.self, forKey: .revision)
        presets = try c.decode([ModelPreset].self, forKey: .presets)
        providers =
            c.contains(.providers)
            ? try c.decode([ProviderDefinition].self, forKey: .providers) : ProviderDefinition.defaults
    }
}

/// One shared Provider/Preset library; credentials, action inputs and history remain app-owned.
public final class SharedPresetsStore {
    public static var defaultURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Little Clarity/settings.json")
    }
    public let url: URL
    public init(url: URL = SharedPresetsStore.defaultURL) { self.url = url }

    private func document() throws -> [String: Any] {
        let data: Data
        do { data = try Data(contentsOf: url) } catch CocoaError.fileReadNoSuchFile {
            return [:]
        }
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw EZError("Shared settings must be a JSON object.")
        }
        return value
    }
    public func readAppSection(_ section: String) throws -> (revision: Int, value: [String: Any]?) {
        let document = try document()
        guard let rawApps = document["apps"] else { return (0, nil) }
        guard let apps = rawApps as? [String: Any] else { throw EZError("Invalid app settings.") }
        guard let rawEZ = apps["ez"] else { return (0, nil) }
        guard let ez = rawEZ as? [String: Any] else { throw EZError("Invalid EZ settings.") }
        guard let raw = ez[section] else { return (0, nil) }
        guard let saved = raw as? [String: Any], let revision = saved["revision"] as? Int,
            revision >= 0, let value = saved["value"] as? [String: Any]
        else { throw EZError("Invalid scoped settings. Original file preserved.") }
        return (revision, value)
    }
    @discardableResult public func saveAppSection(_ section: String, value: [String: Any], revision: Int)
        throws -> Int
    {
        guard try readAppSection(section).revision == revision else {
            throw EZError("EZ settings changed. Reload before saving again.")
        }
        var document = try document()
        var apps = document["apps"] as? [String: Any] ?? [:]
        var ez = apps["ez"] as? [String: Any] ?? [:]
        ez[section] = ["revision": revision + 1, "value": value]
        apps["ez"] = ez
        document["apps"] = apps
        try writeDocument(document)
        return revision + 1
    }
    private func writeDocument(_ document: [String: Any]) throws {
        let data = try JSONSerialization.data(
            withJSONObject: document, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        try data.write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
    public func read() throws -> SharedPresets {
        let document = try document()
        let legacy =
            (((document["apps"] as? [String: Any])?["ez"] as? [String: Any])?["configuration"]
            as? [String: Any])?["value"] as? [String: Any]
        var section: [String: Any]
        if let raw = document["modelPresets"] {
            guard let value = raw as? [String: Any] else {
                throw EZError("Model presets must be a JSON object.")
            }
            section = value
        } else {
            section = ["revision": 0, "presets": []]
        }
        if section["providers"] == nil, let providers = legacy?["providers"] {
            section["providers"] = providers
        }
        let result = try JSONDecoder().decode(
            SharedPresets.self,
            from: JSONSerialization.data(withJSONObject: section))
        guard result.revision >= 0 else { throw EZError("Invalid shared preset revision.") }
        try validate(result.presets)
        try ProviderDefinition.validate(result.providers)
        return result
    }
    private func validate(_ presets: [ModelPreset]) throws {
        guard presets.count <= 128, Set(presets.map(\.id)).count == presets.count,
            Set(presets.map { $0.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }).count
                == presets.count,
            presets.allSatisfy({
                !$0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.name.utf16.count <= 80
                    && $0.model.utf16.count <= 256 && $0.effort.utf16.count <= 64
            })
        else { throw EZError("Shared presets need unique IDs and names, a model, effort, and speed.") }
        for preset in presets {
            guard preset.providerKey.range(of: "^[a-z][a-z0-9-]{0,63}$", options: .regularExpression) != nil
            else { throw EZError("Invalid provider key in shared presets.") }
            if let options = preset.imageOptions { try options.validate() }
        }
    }
    public func save(_ presets: [ModelPreset], revision: Int, providers: [ProviderDefinition]? = nil) throws
        -> SharedPresets
    {
        try validate(presets)
        let current = try read()
        guard current.revision == revision else {
            throw EZError(
                "Shared presets changed in the other app. Reload saved settings before saving again.")
        }
        let definitions = providers ?? current.providers
        try ProviderDefinition.validate(definitions)
        let saved = SharedPresets(revision: revision + 1, presets: presets, providers: definitions)
        var document = try document()
        var section = document["modelPresets"] as? [String: Any] ?? [:]
        let fields =
            try JSONSerialization.jsonObject(with: JSONEncoder().encode(saved)) as? [String: Any] ?? [:]
        section.merge(fields) { _, new in new }
        document["modelPresets"] = section
        try writeDocument(document)
        return saved
    }
    public func migrate(_ presets: [ModelPreset], providers: [ProviderDefinition]? = nil) throws
        -> SharedPresets
    {
        let current = try read()
        var imported = current.presets
        for var preset in presets where !imported.contains(where: { $0.id == preset.id }) {
            let original = preset.name
            var suffix = 2
            while imported.contains(where: {
                $0.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                    == preset.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            }) {
                preset.name = "\(original.prefix(65)) (\(suffix))"
                suffix += 1
            }
            imported.append(preset)
        }
        let owned = (try document()["modelPresets"] as? [String: Any])?["providers"] != nil
        let definitions = owned ? current.providers : (providers ?? current.providers)
        try ProviderDefinition.validate(definitions)
        return try imported == current.presets && definitions == current.providers && owned
            ? current
            : save(imported, revision: current.revision, providers: definitions)
    }
}
