import Darwin
import Foundation

public struct ModelPreset: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    public var name: String
    public var model: String
    public var effort: String
    public var fast: Bool
    public var providerKey: String
    public var capability: ActionCapability
    public var imageOptions: ImageOptions?
    public var speechOptions: SpeechOptions?

    public init(
        id: UUID = UUID(), name: String, model: String, effort: String, fast: Bool,
        providerKey: String = "gpt-plan", capability: ActionCapability = .write,
        imageOptions: ImageOptions? = nil, speechOptions: SpeechOptions? = nil
    ) {
        self.id = id
        self.name = name
        self.model = model
        self.effort = effort
        self.fast = fast
        self.providerKey = providerKey
        self.capability = capability
        self.imageOptions = imageOptions
        self.speechOptions = speechOptions
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case id, name, model, effort, fast, providerKey, capability, imageOptions, speechOptions
    }
    public init(from decoder: Decoder) throws {
        let c = try contractFields(decoder, keys: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        model = try c.decode(String.self, forKey: .model)
        effort = try c.decode(String.self, forKey: .effort)
        fast = try c.decode(Bool.self, forKey: .fast)
        providerKey = c.contains(.providerKey) ? try c.decode(String.self, forKey: .providerKey) : "gpt-plan"
        capability =
            c.contains(.capability) ? try c.decode(ActionCapability.self, forKey: .capability) : .write
        imageOptions =
            c.contains(.imageOptions) ? try c.decode(ImageOptions.self, forKey: .imageOptions) : nil
        speechOptions =
            c.contains(.speechOptions) ? try c.decode(SpeechOptions.self, forKey: .speechOptions) : nil
    }

    public func availabilityError(in models: [ModelOption]) -> String? {
        if capability == .speak { return "Speak preview runs in Saul." }
        if capability == .draw {
            guard ImageModelOption.openAIModels.contains(where: { $0.id == model }) else {
                return "Preset ‘\(name)’ needs an available Draw model. Edit it in Presets."
            }
            do { try (imageOptions ?? ImageOptions()).validate() } catch { return error.localizedDescription }
            return nil
        }
        if providerKey != "gpt-plan" {
            return model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? "Choose a model in Presets." : nil
        }
        guard let option = models.first(where: { $0.model == model }) else {
            return
                "Preset ‘\(name)’ needs \(model.isEmpty ? "a model" : model). Choose an available model in Presets."
        }
        if !effort.isEmpty
            && !option.supportedReasoningEfforts.contains(where: { $0.reasoningEffort == effort })
        {
            return "Preset ‘\(name)’ requests unsupported effort ‘\(effort)’. Edit it in Presets."
        }
        if fast && option.fastTier == nil {
            return
                "Preset ‘\(name)’ requests Fast, but this model does not advertise Fast. Edit it in Presets."
        }
        return nil
    }
}

public struct Action: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    public var name: String
    public var presetID: UUID
    public var template: String
    public var legacyMode: QueryMode?
    public var capability: ActionCapability
    public var webSearch: Bool
    public var imageInput: String?

    public init(
        id: UUID = UUID(), name: String, presetID: UUID, template: String, legacyMode: QueryMode? = nil,
        capability: ActionCapability = .write, webSearch: Bool = false, imageInput: String? = nil
    ) {
        self.id = id
        self.name = name
        self.presetID = presetID
        self.template = template
        self.legacyMode = legacyMode
        self.capability = capability
        self.webSearch = webSearch
        self.imageInput = imageInput
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, presetID, template, legacyMode, capability, webSearch, imageInput
    }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        presetID = try c.decode(UUID.self, forKey: .presetID)
        template = try c.decode(String.self, forKey: .template)
        legacyMode = try c.decodeIfPresent(QueryMode.self, forKey: .legacyMode)
        capability = try c.decodeIfPresent(ActionCapability.self, forKey: .capability) ?? .write
        webSearch = try c.decodeIfPresent(Bool.self, forKey: .webSearch) ?? false
        imageInput = try c.decodeIfPresent(String.self, forKey: .imageInput)
    }

    public var symbol: String { capability == .draw ? "photo" : legacyMode?.symbol ?? "text.badge.plus" }

    public func validateInputs() throws {
        if webSearch && capability != .write { throw EZError("Web search requires Write.") }
        if let imageInput {
            guard capability == .draw, !imageInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                imageInput.count <= 80
            else { throw EZError("Name the image input on a Draw action (up to 80 characters).") }
        }
    }

    public func prepare(
        values: [String: String], preset: ModelPreset, models: [ModelOption], image: ImageAttachment? = nil
    ) throws
        -> HistoryEntry
    {
        try validateInputs()
        if webSearch && preset.providerKey == "gpt-plan" {
            throw EZError("Web search needs an OpenAI API Write preset.")
        }
        if imageInput != nil {
            guard let image else { throw EZError("Attach an image before running.") }
            _ = try image.validatedData()
        }
        guard capability == preset.capability else {
            throw EZError("Choose a \(capability.name) preset for this action.")
        }
        if let message = preset.availabilityError(in: models) { throw EZError(message) }
        let prompt = try PromptTemplate(template).render(values)
        var entry = HistoryEntry(
            mode: legacyMode ?? .ask, query: prompt, model: preset.model,
            effort: preset.effort,
            requestedServiceTier: preset.capability == .write && preset.fast
                ? (preset.providerKey == "gpt-plan"
                    ? models.first { $0.model == preset.model }?.fastTier : "priority") : nil)
        entry.actionSnapshot = self
        entry.presetSnapshot = preset
        entry.inputValues = values
        entry.inputImage = imageInput == nil ? nil : image
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
        guard fields.count <= 16 else { throw EZError("Use at most 16 input fields in an action.") }
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
    public var sharedPresetRevision: Int?
    public var presets: [ModelPreset]
    public var actions: [Action]
    public var unassignedStarterID: UUID?
    public var providers: [ProviderDefinition] = ProviderDefinition.defaults
    public var actionTypesVersion: Int?

    // Existing persisted keys are migration contracts, not UI vocabulary.
    private enum CodingKeys: String, CodingKey {
        case schemaVersion, sharedPresetRevision, presets, unassignedStarterID, providers, actionTypesVersion
        case actions = "recipes"
    }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try c.decode(Int.self, forKey: .schemaVersion)
        sharedPresetRevision = try c.decodeIfPresent(Int.self, forKey: .sharedPresetRevision)
        presets = try c.decodeIfPresent([ModelPreset].self, forKey: .presets) ?? []
        actions = try c.decode([Action].self, forKey: .actions)
        unassignedStarterID = try c.decodeIfPresent(UUID.self, forKey: .unassignedStarterID)
        providers =
            try c.decodeIfPresent([ProviderDefinition].self, forKey: .providers)
            ?? ProviderDefinition.defaults
        actionTypesVersion = try c.decodeIfPresent(Int.self, forKey: .actionTypesVersion)
    }

    public init(presets: [ModelPreset] = [], actions: [Action] = []) {
        self.presets = presets
        self.actions = actions
    }

    public static func starters(model: String, effort: String, fast: Bool) -> Configuration {
        let preset = ModelPreset(name: "Current", model: model, effort: effort, fast: fast)
        var actions = QueryMode.allCases.map { mode in
            Action(
                name: mode.rawValue, presetID: preset.id,
                template: mode.instruction + "\n\n{{text}}", legacyMode: mode)
        }
        actions.append(
            Action(
                name: "Lookup", presetID: preset.id,
                template:
                    "I am looking for {{fuzzy term}} for describing {{fuzzy context}}. Please help me find the term, or I might be mistaking it for another adjacent term; then correct me."
            ))
        var result = Configuration(presets: [preset], actions: actions)
        if model.isEmpty { result.unassignedStarterID = preset.id }
        return result
    }

    public func validate() throws {
        try ProviderDefinition.validate(providers)
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
        try checkNames(actions.map(\.name))
        guard Set(presets.map(\.id)).count == presets.count, Set(actions.map(\.id)).count == actions.count
        else {
            throw EZError("Duplicate configuration IDs. Original file is preserved.")
        }
        for action in actions {
            guard sharedPresetRevision != nil || presets.contains(where: { $0.id == action.presetID }) else {
                throw EZError("Action ‘\(action.name)’ needs an existing default preset.")
            }
            try action.validateInputs()
            _ = try PromptTemplate(action.template)
        }
        for preset in presets {
            guard preset.providerKey.range(of: "^[a-z][a-z0-9-]{0,63}$", options: .regularExpression) != nil
            else { throw EZError("Invalid preset provider key.") }
            if let image = preset.imageOptions { try image.validate() }
            if let speech = preset.speechOptions { try speech.validate() }
        }
    }

    @discardableResult public mutating func addIllustration() -> Bool {
        let actionID = UUID(uuidString: "8BE72259-67B7-4DCF-8F8D-88E5B68F23CB")!
        guard !actions.contains(where: { $0.id == actionID }) else { return false }
        let preset = ModelPreset(
            id: UUID(uuidString: "C14B29F3-3EC2-4EFC-8BED-E05531AEF2CB")!,
            name: uniqueName("Illustration", in: presets.map(\.name)), model: "gpt-image-2.5-flare",
            effort: "", fast: false,
            providerKey: "openai-api", capability: .draw, imageOptions: ImageOptions())
        if !presets.contains(where: { $0.id == preset.id }) { presets.append(preset) }
        actions.append(
            Action(
                id: actionID, name: uniqueName("Illustration", in: actions.map(\.name)),
                presetID: preset.id,
                template: "Create a clear illustration of the following context:\n\n{{context}}",
                capability: .draw))
        return true
    }
    /// Versioned seeding belongs to configuration; removed starters stay removed.
    @discardableResult public mutating func addSearchAndMeme() -> Bool {
        guard (actionTypesVersion ?? 0) < 2 else { return false }
        if actionTypesVersion == nil { addIllustration() }
        let researchID = UUID(uuidString: "2C033F95-23BE-487B-A133-CC97898568C1")!
        let researchPreset = ModelPreset(
            id: UUID(uuidString: "D036EAF4-2134-4AF6-A755-0742AE678352")!,
            name: uniqueName("Research", in: presets.map(\.name)), model: "gpt-6.1-sol",
            effort: "", fast: false, providerKey: "openai-api")
        if !presets.contains(where: { $0.id == researchPreset.id }) { presets.append(researchPreset) }
        if !actions.contains(where: { $0.id == researchID }) {
            actions.append(
                Action(
                    id: researchID, name: uniqueName("Research", in: actions.map(\.name)),
                    presetID: researchPreset.id,
                    template:
                        "Search the web to answer the following question. Answer directly in the user's language, cite sources inline, and state material uncertainty.\n\n{{Question}}",
                    webSearch: true))
        }
        let memeID = UUID(uuidString: "8ED3A908-D0BF-4FB8-8A61-86549BE9ED49")!
        let memePreset = ModelPreset(
            id: UUID(uuidString: "8F092456-F150-4B43-B9FB-D58345429826")!,
            name: uniqueName("Make meme", in: presets.map(\.name)), model: "gpt-image-2.5-flare",
            effort: "", fast: false, providerKey: "openai-api", capability: .draw,
            imageOptions: ImageOptions())
        if !presets.contains(where: { $0.id == memePreset.id }) { presets.append(memePreset) }
        if !actions.contains(where: { $0.id == memeID }) {
            actions.append(
                Action(
                    id: memeID, name: uniqueName("Make meme", in: actions.map(\.name)),
                    presetID: memePreset.id,
                    template:
                        "Turn the supplied sketch into a meme. Preserve its recognizable subjects and composition. Follow these instructions, using any quoted caption exactly:\n\n{{Instructions}}",
                    capability: .draw, imageInput: "Sketch"))
        }
        actionTypesVersion = 2
        return true
    }

    private func uniqueName(_ proposed: String, in names: [String]) -> String {
        var name = proposed
        var suffix = 2
        while names.contains(where: { $0.lowercased() == name.lowercased() }) {
            name = "\(proposed) (\(suffix))"
            suffix += 1
        }
        return name
    }

    public func preparingLauncherInput(_ text: String, recipeID: UUID) throws -> (
        values: [String: String], submit: Bool
    ) {
        guard let action = actions.first(where: { $0.id == recipeID }) else {
            throw EZError("Choose an action in EZ first.")
        }
        let fields = try PromptTemplate(action.template).fields
        return ([fields[0]: text], fields.count == 1 && action.capability == .write)
    }
}

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
            let section = try shared.readAppSection("configuration")
            scopedRevision = section.revision
            if var value = section.value {
                let library = try shared.read()
                value["presets"] = try JSONSerialization.jsonObject(
                    with: JSONEncoder().encode(library.presets))
                value["providers"] = try JSONSerialization.jsonObject(
                    with: JSONEncoder().encode(library.providers))
                value["sharedPresetRevision"] = library.revision
                let result = try JSONDecoder().decode(
                    Configuration.self, from: JSONSerialization.data(withJSONObject: value))
                try result.validate()
                return result
            }
        }
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let data = try Data(contentsOf: url)
        guard data.count <= 1_048_576 else {
            throw EZError("Configuration file is too large. Original file is preserved.")
        }
        var result = try JSONDecoder().decode(Configuration.self, from: data)
        try result.validate()
        if let shared {
            let migrating = result.sharedPresetRevision == nil
            let library =
                try migrating ? shared.migrate(result.presets, providers: result.providers) : shared.read()
            result.presets = library.presets
            result.providers = library.providers
            result.sharedPresetRevision = library.revision
            if migrating { try writeLocal(result) }
            try writeScope(result, shared: shared)
        }
        return result
    }

    public func save(_ configuration: Configuration) throws {
        try configuration.validate()
        if let shared {
            scopedRevision = try shared.saveConfiguration(configuration, scopedRevision: scopedRevision)
        } else {
            try writeLocal(configuration)
        }
    }
    private func writeScope(_ configuration: Configuration, shared: SharedPresetsStore) throws {
        guard
            var value = try JSONSerialization.jsonObject(with: JSONEncoder().encode(configuration))
                as? [String: Any]
        else { throw EZError("Configuration must be an object.") }
        value.removeValue(forKey: "presets")
        value.removeValue(forKey: "providers")
        value.removeValue(forKey: "sharedPresetRevision")
        scopedRevision = try shared.saveAppSection("configuration", value: value, revision: scopedRevision)
    }
    private func writeLocal(_ configuration: Configuration) throws {
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
