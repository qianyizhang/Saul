import Foundation
import SaulNativeValues

public enum ConnectionChange {
    case rename(String)
    case move(destination: String, presets: Set<UUID>)
    case delete
}

extension ConnectionDefinition {
    public var managementLabel: String {
        let route =
            kind == .chatGPTPlan
            ? "ChatGPT plan"
            : endpoint == "https://api.openai.com/v1" ? "OpenAI API" : endpoint
        return name == route ? name : "\(name) · \(route)"
    }

    public func supportsMove(of preset: ModelPreset) -> Bool {
        capabilities.contains(preset.capability) && (kind != .chatGPTPlan || accountId != nil)
    }

    public static func nextName(_ base: String, among connections: [ConnectionDefinition]) -> String {
        let names = Set(
            connections.map { $0.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() })
        var name = base
        var suffix = 2
        while names.contains(name.lowercased()) {
            name = "\(base) \(suffix)"
            suffix += 1
        }
        return name
    }
}

extension Configuration {
    public func presets(using connectionKey: String) -> [ModelPreset] {
        presets.filter { $0.connectionKey == connectionKey }
    }

    public mutating func changeConnection(_ key: String, _ change: ConnectionChange) throws {
        guard let index = connections.firstIndex(where: { $0.key == key }) else {
            throw EZError("This connection is unavailable. Reload saved settings.")
        }
        switch change {
        case .rename(let name):
            var updated = connections
            updated[index].name = name.trimmingCharacters(in: .whitespacesAndNewlines)
            try ConnectionDefinition.validate(updated)
            connections = updated
        case .move(let destination, let ids):
            guard let target = connections.first(where: { $0.key == destination }), key != target.key,
                !ids.isEmpty
            else { throw EZError("Choose a destination and presets that still use this connection.") }
            let selected = presets(using: key).filter { ids.contains($0.id) }
            guard selected.count == ids.count else {
                throw EZError("Choose presets that still use this connection.")
            }
            guard selected.allSatisfy({ target.supportsMove(of: $0) }) else {
                throw EZError("The destination must support every selected preset.")
            }
            for index in presets.indices where ids.contains(presets[index].id) {
                presets[index].connectionKey = target.key
            }
        case .delete:
            guard presets(using: key).isEmpty else {
                throw EZError("Move the presets that use this connection before deleting it.")
            }
            connections.remove(at: index)
        }
    }
}
