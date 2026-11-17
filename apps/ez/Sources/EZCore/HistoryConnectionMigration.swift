import Foundation
import SaulNativeValues

enum HistoryConnectionMigration {
    private static func rename(_ value: inout [String: Any], _ from: String, _ to: String) throws {
        guard let old = value[from] else { return }
        guard value[to] == nil else {
            throw EZError("Conflicting \(from)/\(to) fields. Original data preserved.")
        }
        value[to] = old
        value.removeValue(forKey: from)
    }
    static func history(_ source: [String: Any]) throws -> [String: Any] {
        var value = source
        try rename(&value, "providerSnapshot", "connectionSnapshot")
        if let saved = value["presetSnapshot"] as? [String: Any] {
            value["presetSnapshot"] = try ConnectionSettingsMigration.preset(saved)
        }
        return value
    }
    static func run(_ source: [String: Any]) throws -> [String: Any] {
        var value = source
        if let saved = value["preset"] as? [String: Any] {
            value["preset"] = try ConnectionSettingsMigration.preset(saved)
        }
        return value
    }
}
