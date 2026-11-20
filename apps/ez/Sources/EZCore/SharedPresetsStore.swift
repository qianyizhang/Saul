import CSQLite
import Darwin
import Foundation
import SaulNativeValues

/// Shared connection/preset configuration. Secrets stay with their credential owner.
public final class SharedPresetsStore {
    public let url: URL
    public init(url: URL = SharedSettingsDocument.defaultURL) { self.url = url }

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
        var document = try ConnectionSettingsMigration.document(SharedSettingsDocument.load(at: url))
        _ = try SharedSettingsDocument.library(document)
        let result = try change(&document)
        try writeDocument(document)
        return result
    }

    private func readDocument() throws -> [String: Any] {
        let original = try SharedSettingsDocument.load(at: url)
        let upgraded = try ConnectionSettingsMigration.document(original)
        if NSDictionary(dictionary: original).isEqual(to: upgraded) { return original }
        return try update { $0 }
    }
    public func readAppSection(_ section: String) throws -> (revision: Int, value: [String: Any]?) {
        try appSection(readDocument(), section)
    }
    func configurationSnapshot() throws -> (revision: Int, value: [String: Any]?, library: SharedPresets) {
        let document = try readDocument()
        let scope = try appSection(document, "configuration")
        return (scope.revision, scope.value, try SharedSettingsDocument.library(document))
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
        do {
            try AtomicFile.write(data, to: url)
        } catch AtomicFile.Failure.staging {
            throw EZError("Cannot stage configuration. Previous settings are preserved.")
        } catch AtomicFile.Failure.replacing {
            throw EZError("Cannot replace configuration. Previous settings are preserved.")
        }
    }
    public func read() throws -> SharedPresets {
        try SharedSettingsDocument.library(readDocument())
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
        try SharedSettingsDocument.validate(presets)
        let current = try SharedSettingsDocument.library(document)
        guard current.revision == revision else {
            throw EZError(
                "Shared presets changed in the other app. Reload saved settings before saving again.")
        }
        let definitions = connections ?? current.connections
        try ConnectionDefinition.validate(definitions)
        let deleted = Set(current.connections.map(\.key)).subtracting(definitions.map(\.key))
        guard !presets.contains(where: { deleted.contains($0.connectionKey) }) else {
            throw EZError("Move the presets that use this connection before deleting it.")
        }
        if !deleted.isEmpty,
            let saul = (document["apps"] as? [String: Any])?["saul"] as? [String: Any],
            let settings = saul["settings"] as? [String: Any],
            let value = settings["value"] as? [String: Any],
            let configuration = value["configuration"] as? [String: Any],
            let local = configuration["presets"] as? [[String: Any]],
            local.contains(where: { ($0["connectionKey"] as? String).map(deleted.contains) == true })
        {
            throw EZError("Move the browser-local presets in Saul before deleting this connection.")
        }
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
        let current = try SharedSettingsDocument.library(document)
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
    func saveConfiguration(_ configuration: Configuration, scopedRevision: Int) throws -> (
        scopedRevision: Int, library: SharedPresets
    ) {
        try update { document in
            guard try appSection(document, "configuration").revision == scopedRevision else {
                throw EZError("EZ settings changed. Reload before saving again.")
            }
            let library: SharedPresets
            if let revision = configuration.sharedPresetRevision {
                library = try setPresets(
                    &document, configuration.presets, revision: revision,
                    connections: configuration.connections)
            } else {
                library = try importPresets(
                    &document, configuration.presets, connections: configuration.connections)
            }
            guard
                var value = try JSONSerialization.jsonObject(with: JSONEncoder().encode(configuration))
                    as? [String: Any]
            else {
                throw EZError("Configuration must be an object.")
            }
            for key in ["presets", "connections", "sharedPresetRevision"] { value.removeValue(forKey: key) }
            let savedScope = try setAppSection(
                &document, "configuration", value: value, revision: scopedRevision)
            return (savedScope, library)
        }
    }
}
