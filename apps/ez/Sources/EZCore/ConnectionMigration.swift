import Foundation

/// One-time storage upgrade. Current types and wire requests use only connection names.
enum ConnectionMigration {
    private static func rename(_ value: inout [String: Any], _ from: String, _ to: String) throws {
        guard let old = value[from] else { return }
        guard value[to] == nil else {
            throw EZError("Conflicting \(from)/\(to) fields. Original data preserved.")
        }
        value[to] = old
        value.removeValue(forKey: from)
    }
    static func preset(_ source: [String: Any]) throws -> [String: Any] {
        var value = source
        try rename(&value, "providerKey", "connectionKey")
        return value
    }
    static func configuration(_ source: [String: Any]) throws -> [String: Any] {
        var value = source
        try rename(&value, "providers", "connections")
        if let presets = value["presets"] as? [[String: Any]] {
            value["presets"] = try presets.map(preset)
        }
        return value
    }
    static func document(_ source: [String: Any]) throws -> [String: Any] {
        var value = source
        if let apps = value["apps"], !(apps is [String: Any]) {
            throw EZError("Invalid app settings. Original file preserved.")
        }
        var apps = value["apps"] as? [String: Any] ?? [:]
        var ez = apps["ez"] as? [String: Any] ?? [:]
        var scope = ez["configuration"] as? [String: Any] ?? [:]
        if let config = scope["value"] as? [String: Any] {
            scope["value"] = try configuration(config)
            ez["configuration"] = scope
            apps["ez"] = ez
        }
        var saul = apps["saul"] as? [String: Any] ?? [:]
        if var settingsScope = saul["settings"] as? [String: Any],
            var settings = settingsScope["value"] as? [String: Any]
        {
            try rename(&settings, "providers", "connections")
            try rename(&settings, "providerConnections", "connectionProfiles")
            if let config = settings["configuration"] as? [String: Any] {
                settings["configuration"] = try configuration(config)
            }
            settingsScope["value"] = settings
            saul["settings"] = settingsScope
            apps["saul"] = saul
        }
        if source["apps"] != nil { value["apps"] = apps }
        let scopedConnections = (scope["value"] as? [String: Any])?["connections"]
        if let raw = value["modelPresets"] as? [String: Any] {
            var library = try configuration(raw)
            if library["connections"] == nil {
                library["connections"] =
                    try scopedConnections
                    ?? JSONSerialization.jsonObject(
                        with: JSONEncoder().encode(ConnectionDefinition.defaults))
            }
            value["modelPresets"] = library
        } else if value["modelPresets"] == nil, let scopedConnections {
            value["modelPresets"] = ["revision": 0, "presets": [], "connections": scopedConnections]
        }
        return value
    }
    static func history(_ source: [String: Any]) throws -> [String: Any] {
        var value = source
        try rename(&value, "providerSnapshot", "connectionSnapshot")
        if let saved = value["presetSnapshot"] as? [String: Any] {
            value["presetSnapshot"] = try preset(saved)
        }
        return value
    }
    static func run(_ source: [String: Any]) throws -> [String: Any] {
        var value = source
        if let saved = value["preset"] as? [String: Any] { value["preset"] = try preset(saved) }
        return value
    }
}
