import CSQLite
import Darwin
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

/// Shared connection/preset configuration. Secrets stay with their credential owner.
public final class SharedPresetsStore {
    public static var defaultURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Little Clarity/settings.json")
    }
    public let url: URL
    public init(url: URL = SharedPresetsStore.defaultURL) { self.url = url }

    private func update<T>(_ change: (inout [String: Any]) throws -> T) throws -> T {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        let lockURL = URL(fileURLWithPath: url.path + ".lock.sqlite3")
        for path in [url, lockURL] {
            if let kind = try? FileManager.default.attributesOfItem(atPath: path.path)[.type],
                kind as? FileAttributeType != .typeRegular
            {
                throw EZError("Settings paths must be regular files.")
            }
        }
        var lock: OpaquePointer?
        guard
            sqlite3_open_v2(lockURL.path, &lock, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nil) == SQLITE_OK
        else {
            sqlite3_close(lock)
            throw EZError("Cannot open the configuration lock.")
        }
        defer { sqlite3_close(lock) }
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: lockURL.path)
        sqlite3_busy_timeout(lock, 5000)
        guard sqlite3_exec(lock, "BEGIN IMMEDIATE", nil, nil, nil) == SQLITE_OK else {
            throw EZError("Configuration is busy. Try Save again.")
        }
        defer { sqlite3_exec(lock, "ROLLBACK", nil, nil, nil) }
        var document = try ConnectionMigration.document(document())
        _ = try library(document)
        let result = try change(&document)
        try writeDocument(document)
        return result
    }

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
    private func readDocument() throws -> [String: Any] {
        let original = try document()
        let upgraded = try ConnectionMigration.document(original)
        if NSDictionary(dictionary: original).isEqual(to: upgraded) { return original }
        return try update { $0 }
    }
    public func readAppSection(_ section: String) throws -> (revision: Int, value: [String: Any]?) {
        try appSection(readDocument(), section)
    }
    private func appSection(_ document: [String: Any], _ section: String) throws -> (
        revision: Int, value: [String: Any]?
    ) {
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
        try update { document in
            try setAppSection(&document, section, value: value, revision: revision)
        }
    }
    private func setAppSection(
        _ document: inout [String: Any], _ section: String, value: [String: Any], revision: Int
    ) throws -> Int {
        guard try appSection(document, section).revision == revision else {
            throw EZError("EZ settings changed. Reload before saving again.")
        }
        var apps = document["apps"] as? [String: Any] ?? [:]
        var ez = apps["ez"] as? [String: Any] ?? [:]
        ez[section] = ["revision": revision + 1, "value": value]
        apps["ez"] = ez
        document["apps"] = apps
        return revision + 1
    }
    private func writeDocument(_ document: [String: Any]) throws {
        let data = try JSONSerialization.data(
            withJSONObject: document, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        let temporary = url.deletingLastPathComponent().appendingPathComponent(".settings-\(UUID()).tmp")
        defer { try? FileManager.default.removeItem(at: temporary) }
        guard
            FileManager.default.createFile(
                atPath: temporary.path, contents: data, attributes: [.posixPermissions: 0o600])
        else {
            throw EZError("Cannot stage configuration. Previous settings are preserved.")
        }
        let handle = try FileHandle(forWritingTo: temporary)
        do {
            try handle.synchronize()
            try handle.close()
        } catch {
            try? handle.close()
            throw error
        }
        guard Darwin.rename(temporary.path, url.path) == 0 else {
            throw EZError("Cannot replace configuration. Previous settings are preserved.")
        }
    }
    public func read() throws -> SharedPresets {
        try library(readDocument())
    }
    private func library(_ document: [String: Any]) throws -> SharedPresets {
        var section: [String: Any]
        if let raw = document["modelPresets"] {
            guard let value = raw as? [String: Any] else {
                throw EZError("Model presets must be a JSON object.")
            }
            section = value
        } else {
            return SharedPresets(revision: 0, presets: [])
        }
        let result = try JSONDecoder().decode(
            SharedPresets.self,
            from: JSONSerialization.data(withJSONObject: section))
        guard result.revision >= 0 else { throw EZError("Invalid shared preset revision.") }
        try validate(result.presets)
        try ConnectionDefinition.validate(result.connections)
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
            guard preset.connectionKey.range(of: "^[a-z][a-z0-9-]{0,63}$", options: .regularExpression) != nil
            else { throw EZError("Invalid connection key in shared presets.") }
            if let options = preset.imageOptions { try options.validate() }
            if let options = preset.speechOptions { try options.validate() }
        }
    }
    public func save(_ presets: [ModelPreset], revision: Int, connections: [ConnectionDefinition]? = nil)
        throws
        -> SharedPresets
    {
        try update { document in
            try setPresets(&document, presets, revision: revision, connections: connections)
        }
    }
    private func setPresets(
        _ document: inout [String: Any], _ presets: [ModelPreset], revision: Int,
        connections: [ConnectionDefinition]?
    ) throws -> SharedPresets {
        try validate(presets)
        let current = try library(document)
        guard current.revision == revision else {
            throw EZError(
                "Shared presets changed in the other app. Reload saved settings before saving again.")
        }
        let definitions = connections ?? current.connections
        try ConnectionDefinition.validate(definitions)
        for existing in current.connections {
            guard let next = definitions.first(where: { $0.key == existing.key }) else { continue }
            guard next.kind == existing.kind,
                existing.accountId == nil || next.accountId == existing.accountId,
                existing.kind != .openAIAPI || next.endpoint == existing.endpoint
            else {
                throw EZError("A connection cannot change its account or endpoint. Add another connection.")
            }
        }
        let saved = SharedPresets(revision: revision + 1, presets: presets, connections: definitions)
        var section = document["modelPresets"] as? [String: Any] ?? [:]
        let fields =
            try JSONSerialization.jsonObject(with: JSONEncoder().encode(saved)) as? [String: Any] ?? [:]
        section.merge(fields) { _, new in new }
        document["modelPresets"] = section
        return saved
    }
    public func migrate(_ presets: [ModelPreset], connections: [ConnectionDefinition]? = nil) throws
        -> SharedPresets
    {
        try update { document in try importPresets(&document, presets, connections: connections) }
    }
    private func importPresets(
        _ document: inout [String: Any], _ presets: [ModelPreset], connections: [ConnectionDefinition]?
    ) throws -> SharedPresets {
        let current = try library(document)
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
        let owned = (document["modelPresets"] as? [String: Any])?["connections"] != nil
        let definitions = owned ? current.connections : (connections ?? current.connections)
        try ConnectionDefinition.validate(definitions)
        return try imported == current.presets && definitions == current.connections && owned
            ? current
            : setPresets(&document, imported, revision: current.revision, connections: definitions)
    }
    public func saveConfiguration(_ configuration: Configuration, scopedRevision: Int) throws -> Int {
        try update { document in
            guard try appSection(document, "configuration").revision == scopedRevision else {
                throw EZError("EZ settings changed. Reload before saving again.")
            }
            if let revision = configuration.sharedPresetRevision {
                _ = try setPresets(
                    &document, configuration.presets, revision: revision,
                    connections: configuration.connections)
            } else {
                _ = try importPresets(
                    &document, configuration.presets, connections: configuration.connections)
            }
            guard
                var value = try JSONSerialization.jsonObject(with: JSONEncoder().encode(configuration))
                    as? [String: Any]
            else {
                throw EZError("Configuration must be an object.")
            }
            for key in ["presets", "connections", "sharedPresetRevision"] { value.removeValue(forKey: key) }
            return try setAppSection(&document, "configuration", value: value, revision: scopedRevision)
        }
    }
}
