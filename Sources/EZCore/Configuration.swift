import Darwin
import Foundation

public struct ModelPreset: Codable, Equatable, Identifiable {
    public var id: UUID
    public var name: String
    public var model: String
    public var effort: String
    public var fast: Bool

    public init(id: UUID = UUID(), name: String, model: String, effort: String, fast: Bool) {
        self.id = id
        self.name = name
        self.model = model
        self.effort = effort
        self.fast = fast
    }

    public func availabilityError(in models: [ModelOption]) -> String? {
        guard let option = models.first(where: { $0.model == model }) else {
            return
                "Preset ‘\(name)’ needs \(model.isEmpty ? "a model" : model). Choose an available model in Configuration."
        }
        if option.supportedReasoningEfforts.isEmpty {
            if !effort.isEmpty {
                return "Preset ‘\(name)’ specifies effort, but this model does not advertise effort choices."
            }
        } else if !option.supportedReasoningEfforts.contains(where: { $0.reasoningEffort == effort }) {
            return "Preset ‘\(name)’ requests unsupported effort ‘\(effort)’. Edit it in Configuration."
        }
        if fast && option.fastTier == nil {
            return
                "Preset ‘\(name)’ requests Fast, but this model does not advertise Fast. Edit it in Configuration."
        }
        return nil
    }
}

public struct Recipe: Codable, Equatable, Identifiable {
    public var id: UUID
    public var name: String
    public var presetID: UUID
    public var template: String
    public var legacyMode: QueryMode?

    public init(
        id: UUID = UUID(), name: String, presetID: UUID, template: String, legacyMode: QueryMode? = nil
    ) {
        self.id = id
        self.name = name
        self.presetID = presetID
        self.template = template
        self.legacyMode = legacyMode
    }

    public var symbol: String { legacyMode?.symbol ?? "text.badge.plus" }

    public func prepare(values: [String: String], preset: ModelPreset, models: [ModelOption]) throws
        -> HistoryEntry
    {
        if let message = preset.availabilityError(in: models) { throw EZError(message) }
        let prompt = try PromptTemplate(template).render(values)
        var entry = HistoryEntry(
            mode: legacyMode ?? .ask, query: prompt, model: preset.model,
            effort: preset.effort,
            requestedServiceTier: preset.fast ? models.first { $0.model == preset.model }?.fastTier : nil)
        entry.recipeSnapshot = self
        entry.presetSnapshot = preset
        entry.inputValues = values
        entry.instructions = ""
        return entry
    }
}

/// A small literal template language. Input values are inserted once, never parsed again.
public struct PromptTemplate {
    private enum Part {
        case text(String)
        case field(String)
    }
    private var parts: [Part] = []
    public private(set) var fields: [String] = []

    public init(_ source: String) throws {
        guard source.utf8.count <= 32_768 else {
            throw EZError("Prompt template is too large (32 KB maximum).")
        }
        guard !source.contains("{%"), !source.contains("%}") else {
            throw EZError(
                "Use {{field name}} only; template expressions and control blocks are not supported.")
        }
        var rest = source[...]
        while let open = rest.range(of: "{{") {
            let literal = String(rest[..<open.lowerBound])
            guard !literal.contains("}}") else { throw EZError("Unmatched }} in prompt template.") }
            parts.append(.text(literal))
            guard let close = rest[open.upperBound...].range(of: "}}") else {
                throw EZError("Close each input field with }}.")
            }
            let name = String(rest[open.upperBound..<close.lowerBound]).trimmingCharacters(
                in: .whitespacesAndNewlines)
            let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: " _-"))
            guard !name.isEmpty, name.count <= 80, name.unicodeScalars.allSatisfy({ allowed.contains($0) })
            else {
                throw EZError(
                    "Field names use letters, numbers, spaces, underscores, or hyphens; expressions are not supported."
                )
            }
            parts.append(.field(name))
            if !fields.contains(name) { fields.append(name) }
            rest = rest[close.upperBound...]
        }
        guard !rest.contains("}}") else { throw EZError("Unmatched }} in prompt template.") }
        parts.append(.text(String(rest)))
        guard !fields.isEmpty else { throw EZError("Include at least one input, such as {{text}}.") }
        guard fields.count <= 16 else { throw EZError("Use at most 16 input fields in a recipe.") }
    }

    public func render(_ values: [String: String]) throws -> String {
        for field in fields {
            guard let value = values[field], !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            else {
                throw EZError("Fill in ‘\(field)’ before sending.")
            }
        }
        return parts.map { part in
            switch part {
            case .text(let text): return text
            case .field(let name): return values[name]!
            }
        }.joined()
    }
}

public struct Configuration: Codable, Equatable {
    public var schemaVersion = 1
    public var presets: [ModelPreset]
    public var recipes: [Recipe]
    public var unassignedStarterID: UUID?

    public init(presets: [ModelPreset] = [], recipes: [Recipe] = []) {
        self.presets = presets
        self.recipes = recipes
    }

    public static func starters(model: String, effort: String, fast: Bool) -> Configuration {
        let preset = ModelPreset(name: "Current", model: model, effort: effort, fast: fast)
        var recipes = QueryMode.allCases.map { mode in
            Recipe(
                name: mode.rawValue, presetID: preset.id,
                template: mode.instruction + "\n\n{{text}}", legacyMode: mode)
        }
        recipes.append(
            Recipe(
                name: "Lookup", presetID: preset.id,
                template:
                    "I am looking for {{fuzzy term}} for describing {{fuzzy context}}. Please help me find the term, or I might be mistaking it for another adjacent term; then correct me."
            ))
        var result = Configuration(presets: [preset], recipes: recipes)
        if model.isEmpty { result.unassignedStarterID = preset.id }
        return result
    }

    public func validate() throws {
        guard schemaVersion == 1 else {
            throw EZError("Unsupported configuration version. Original file is preserved.")
        }
        func checkNames(_ names: [String]) throws {
            let normalized = names.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            guard normalized.allSatisfy({ !$0.isEmpty }), Set(normalized).count == normalized.count else {
                throw EZError("Names must be nonempty and unique within each section.")
            }
        }
        try checkNames(presets.map(\.name))
        try checkNames(recipes.map(\.name))
        guard Set(presets.map(\.id)).count == presets.count, Set(recipes.map(\.id)).count == recipes.count
        else {
            throw EZError("Duplicate configuration IDs. Original file is preserved.")
        }
        for recipe in recipes {
            guard presets.contains(where: { $0.id == recipe.presetID }) else {
                throw EZError("Recipe ‘\(recipe.name)’ needs an existing default preset.")
            }
            _ = try PromptTemplate(recipe.template)
        }
    }

    public func preparingLauncherInput(_ text: String, recipeID: UUID) throws -> (
        values: [String: String], submit: Bool
    ) {
        guard let recipe = recipes.first(where: { $0.id == recipeID }) else {
            throw EZError("Choose a recipe in EZ first.")
        }
        let fields = try PromptTemplate(recipe.template).fields
        return ([fields[0]: text], fields.count == 1)
    }
}

public final class ConfigurationStore {
    public let url: URL
    public init(directory: URL) { url = directory.appendingPathComponent("configuration.json") }

    public func load() throws -> Configuration? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let data = try Data(contentsOf: url)
        guard data.count <= 1_048_576 else {
            throw EZError("Configuration file is too large. Original file is preserved.")
        }
        let result = try JSONDecoder().decode(Configuration.self, from: data)
        try result.validate()
        return result
    }

    public func save(_ configuration: Configuration) throws {
        try configuration.validate()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(configuration)
        guard data.count <= 1_048_576 else { throw EZError("Configuration exceeds the 1 MB storage limit.") }
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        let temporary = url.deletingLastPathComponent().appendingPathComponent(".configuration-\(UUID()).tmp")
        defer { try? FileManager.default.removeItem(at: temporary) }
        guard
            FileManager.default.createFile(
                atPath: temporary.path, contents: data,
                attributes: [.posixPermissions: 0o600])
        else { throw EZError("Cannot write configuration. Previous configuration is preserved.") }
        let handle = try FileHandle(forWritingTo: temporary)
        do {
            try handle.synchronize()
            try handle.close()
        } catch {
            try? handle.close()
            throw error
        }
        guard Darwin.rename(temporary.path, url.path) == 0 else {
            throw EZError(
                "Cannot replace configuration: \(String(cString: strerror(errno))). Previous configuration is preserved."
            )
        }
    }
}
