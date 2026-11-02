import Foundation

public struct SharedPresets: Codable {
    public let revision: Int
    public var presets: [ModelPreset]
}

/// A small shared settings file. Accounts, recipes and history remain app-owned.
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
        guard let raw = try document()["modelPresets"] else {
            return SharedPresets(revision: 0, presets: [])
        }
        guard let section = raw as? [String: Any] else {
            throw EZError("Model presets must be a JSON object.")
        }
        let data = try JSONSerialization.data(withJSONObject: section)
        let result = try JSONDecoder().decode(SharedPresets.self, from: data)
        guard result.revision >= 0 else { throw EZError("Invalid shared preset revision.") }
        try validate(result.presets)
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
    }
    public func save(_ presets: [ModelPreset], revision: Int) throws -> SharedPresets {
        try validate(presets)
        guard try read().revision == revision else {
            throw EZError(
                "Shared presets changed in the other app. Reload saved settings before saving again.")
        }
        let saved = SharedPresets(revision: revision + 1, presets: presets)
        var document = try document()
        document["modelPresets"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(saved))
        try writeDocument(document)
        return saved
    }
    public func migrate(_ presets: [ModelPreset]) throws -> SharedPresets {
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
        return try imported == current.presets ? current : save(imported, revision: current.revision)
    }
}
