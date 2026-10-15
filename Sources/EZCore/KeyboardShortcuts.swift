import Darwin
import Foundation

public enum LookupCommand: String, Codable, CaseIterable {
    case newLookup, send, stop, nextRecipe, previousRecipe
    case recipe1, recipe2, recipe3, recipe4, recipe5, recipe6, recipe7, recipe8, lastRecipe

    public var title: String {
        switch self {
        case .newLookup: return "New lookup"
        case .send: return "Send lookup"
        case .stop: return "Stop generating"
        case .nextRecipe: return "Next recipe"
        case .previousRecipe: return "Previous recipe"
        case .lastRecipe: return "Last recipe"
        default: return "Recipe \(recipeIndex! + 1)"
        }
    }

    public var recipeIndex: Int? {
        switch self {
        case .recipe1: return 0
        case .recipe2: return 1
        case .recipe3: return 2
        case .recipe4: return 3
        case .recipe5: return 4
        case .recipe6: return 5
        case .recipe7: return 6
        case .recipe8: return 7
        default: return nil
        }
    }

    public var defaultBinding: LookupKeyBinding {
        switch self {
        case .newLookup: return .init(key: "n")
        case .send: return .init(key: "return")
        case .stop: return .init(key: ".")
        case .nextRecipe: return .init(key: "]", modifiers: 9)
        case .previousRecipe: return .init(key: "[", modifiers: 9)
        case .lastRecipe: return .init(key: "9")
        default: return .init(key: String(recipeIndex! + 1))
        }
    }
}

public struct LookupKeyBinding: Codable, Equatable, Hashable, Sendable {
    // Stable storage bits: command = 1, option = 2, control = 4, shift = 8.
    public var key: String
    public var modifiers: Int
    public init(key: String, modifiers: Int = 1) {
        self.key = key
        self.modifiers = modifiers
    }
    public static let unassigned = LookupKeyBinding(key: "", modifiers: 0)
    public var display: String {
        guard !key.isEmpty else { return "Unassigned" }
        let symbols = [(4, "⌃"), (2, "⌥"), (8, "⇧"), (1, "⌘")]
        let names = [
            "return": "↩", "tab": "⇥", "space": "Space", "left": "←", "right": "→", "up": "↑", "down": "↓",
        ]
        return symbols.filter { modifiers & $0.0 != 0 }.map(\.1).joined() + (names[key] ?? key.uppercased())
    }
    public func validate() throws {
        if self == .unassigned { return }
        let named = ["return", "tab", "space", "left", "right", "up", "down"]
        let printable = key.count == 1 && key.unicodeScalars.allSatisfy { (33...126).contains($0.value) }
        guard printable || named.contains(key), key == key.lowercased(),
            modifiers > 0, modifiers < 16, modifiers & 5 != 0
        else {
            throw EZError(
                "Use Command or Control with a letter, number, symbol, arrow, Tab, Space, or Return.")
        }
        let reserved: Set<LookupKeyBinding> = Set(
            ["a", "c", "v", "x", "z", "f", "h", "m", "q", "w", ",", "left", "right", "up", "down"].map {
                .init(key: $0)
            }
                + ["z", "h", "m", "w", "left", "right", "up", "down"].map { .init(key: $0, modifiers: 9) }
                + ["a", "e", "b", "f", "p", "n", "k", "d", "h", "t", "o"].map { .init(key: $0, modifiers: 4) }
                + [.init(key: "space", modifiers: 6), .init(key: "space"), .init(key: "space", modifiers: 4)]
        )
        guard !reserved.contains(self) else {
            throw EZError("\(display) is reserved for macOS, text editing, or Quick Lookup.")
        }
    }
}

public struct LookupShortcuts: Codable, Equatable {
    public var schemaVersion = 1
    public var overrides: [String: LookupKeyBinding] = [:]
    public init() {}
    public func binding(for command: LookupCommand) -> LookupKeyBinding {
        overrides[command.rawValue] ?? command.defaultBinding
    }
    public func validate() throws {
        guard schemaVersion == 1, overrides.keys.allSatisfy({ LookupCommand(rawValue: $0) != nil }) else {
            throw EZError("Unsupported shortcuts file. Original file is preserved.")
        }
        var assigned: [LookupKeyBinding: LookupCommand] = [:]
        for command in LookupCommand.allCases {
            let binding = binding(for: command)
            try binding.validate()
            guard binding != .unassigned else { continue }
            if let other = assigned[binding] {
                throw EZError(
                    "\(binding.display) is already assigned to \(other.title). Clear or change that shortcut first."
                )
            }
            assigned[binding] = command
        }
    }
}

public final class LookupShortcutsStore {
    public let url: URL
    public init(directory: URL) { url = directory.appendingPathComponent("shortcuts.json") }
    public func load() throws -> LookupShortcuts {
        guard FileManager.default.fileExists(atPath: url.path) else { return .init() }
        let data = try Data(contentsOf: url)
        guard data.count <= 65_536 else {
            throw EZError("Shortcuts file is too large. Original file is preserved.")
        }
        let result = try JSONDecoder().decode(LookupShortcuts.self, from: data)
        try result.validate()
        return result
    }
    public func save(_ shortcuts: LookupShortcuts) throws {
        try shortcuts.validate()
        let data = try JSONEncoder().encode(shortcuts)
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        let temporary = url.deletingLastPathComponent().appendingPathComponent(".shortcuts-\(UUID()).tmp")
        defer { try? FileManager.default.removeItem(at: temporary) }
        guard
            FileManager.default.createFile(
                atPath: temporary.path, contents: data, attributes: [.posixPermissions: 0o600])
        else {
            throw EZError("Cannot write shortcuts. Previous shortcuts are preserved.")
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
            throw EZError("Cannot replace shortcuts. Previous shortcuts are preserved.")
        }
    }
}
