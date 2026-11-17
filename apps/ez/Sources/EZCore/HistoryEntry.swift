import Foundation
import SaulNativeValues

public struct HistoryEntry: Codable, Identifiable, Equatable, Sendable {
    public var sourceID: String?
    public var sourceRunID: String?
    public var sourceCapability: ActionCapability?
    public var sourceImageOptions: ImageOptions?
    public var sourceText: String?
    public var sourceURL: String?
    public var sourceTitle: String?
    public var schemaVersion = 1
    public var id = UUID()
    public var createdAt = Date()
    public var mode: QueryMode
    public var query: String
    public var response = ""
    public var model: String
    public var effort: String
    public var requestedServiceTier: String?
    public var actualServiceTier: String?
    public var status = "pending"
    public var error: String?
    public var durationSeconds: Double?
    public var metrics: ResponseMetrics?
    public var actionSnapshot: Action?
    public var presetSnapshot: ModelPreset?
    public var inputValues: [String: String]?
    /// nil preserves the legacy mode instruction; empty means the action prompt is complete.
    public var instructions: String?
    public var followUpQuestion: String?
    public var parentID: UUID?
    public var storedImage = false
    /// Retained only for an unsaved image; saved bytes live in SQLite.
    public var imageData: Data?
    public var inputImage: ImageAttachment?
    public var citations: [WebCitation]?
    public var webSearchCompleted: Bool?
    public var connectionSnapshot: ConnectionDefinition?
    private enum CodingKeys: String, CodingKey {
        case sourceID, sourceText, sourceURL, sourceTitle
        case schemaVersion, id, createdAt, mode, query, response, model, effort
        case requestedServiceTier, actualServiceTier, status, error, durationSeconds, metrics
        case actionSnapshot = "recipeSnapshot"
        case presetSnapshot, inputValues, instructions, followUpQuestion, parentID,
            connectionSnapshot, inputImage, citations, webSearchCompleted
    }
    public var capability: ActionCapability {
        sourceCapability ?? actionSnapshot?.capability ?? presetSnapshot?.capability ?? .write
    }
    public var imageOptions: ImageOptions {
        presetSnapshot?.imageOptions ?? sourceImageOptions ?? ImageOptions()
    }
    public var hasImage: Bool { capability == .draw && (storedImage || imageData != nil) }
    public init(mode: QueryMode, query: String, model: String, effort: String, requestedServiceTier: String?)
    {
        self.mode = mode
        self.query = query
        self.model = model
        self.effort = effort
        self.requestedServiceTier = requestedServiceTier
    }
    public var serviceDescription: String {
        let requested = requestedServiceTier == nil ? "Standard requested" : "Fast requested"
        return actualServiceTier.map { "\(requested) · Served: \($0)" } ?? requested
    }
    public var actionName: String { sourceID == nil ? actionSnapshot?.name ?? mode.rawValue : "Saul" }
    public var actionSymbol: String { sourceID == nil ? actionSnapshot?.symbol ?? mode.symbol : "doc.text" }
    public var displayQuery: String {
        if let sourceText { return sourceText }
        if let followUpQuestion { return followUpQuestion }
        guard let action = actionSnapshot, let values = inputValues,
            let template = try? PromptTemplate(action.template)
        else { return query }
        return template.fields.compactMap { values[$0] }.joined(separator: " · ")
    }
    public func prepareFollowUp(_ question: String, models: [ModelOption], provider: GenerationProviderID)
        throws -> HistoryEntry
    {
        guard sourceID == nil else { throw EZError("Open this saved request in Saul to ask a follow-up.") }
        guard capability == .write else { throw EZError("Reuse to prepare another image action.") }
        guard status == "completed", !response.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw EZError("Wait for a saved, completed answer before asking a follow-up.")
        }
        guard !question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            question.utf16.count <= 2_000
        else {
            throw EZError("Enter a follow-up question of up to 2,000 characters.")
        }
        let preset =
            presetSnapshot
            ?? ModelPreset(name: "Saved", model: model, effort: effort, fast: requestedServiceTier != nil)
        if let issue = preset.availabilityError(in: models, provider: provider) { throw EZError(issue) }
        let originalInstructions = instructions ?? mode.instruction
        let context =
            parentID == nil && !originalInstructions.isEmpty
            ? "--- Original instructions ---\n" + originalInstructions + "\n\n--- Original request ---\n"
                + query
            : query
        let prompt =
            context + "\n\n--- Previous answer ---\n" + citedResponse
            + "\n\n--- Follow-up question ---\n" + question
            + "\n\nAnswer the follow-up question directly using the saved context above."
        guard prompt.utf16.count <= 120_000 else {
            throw EZError("This conversation is too long. Start a new lookup.")
        }
        var entry = HistoryEntry(
            mode: .ask, query: prompt, model: model, effort: effort,
            requestedServiceTier: requestedServiceTier)
        entry.instructions =
            usesWebSearch
            ? "Answer the follow-up using web search. Cite sources inline and distinguish current sources from the saved context."
            : QueryMode.ask.instruction
        entry.followUpQuestion = question
        entry.parentID = id
        entry.presetSnapshot = preset
        entry.actionSnapshot = Action(
            name: "Follow-up", presetID: preset.id, template: "{{text}}", legacyMode: .ask,
            webSearch: usesWebSearch)
        entry.inputValues = ["text": prompt]
        return entry
    }
    public var usesWebSearch: Bool { actionSnapshot?.webSearch == true }
    public var citedResponse: String {
        let text =
            sourceID == nil
            ? response
            : response.replacingOccurrences(
                of: #"(?s)<term\b[^>]*>(.*?)</term>"#, with: "$1", options: .regularExpression)
        return WebCitation.markdown(text, citations: citations ?? [])
    }
    public var markdown: String {
        "# \(actionName)\n\n\(createdAt.formatted()) · \(model) · \(effort) · \(serviceDescription) · \(status)\n\n## Query\n\n\(displayQuery)\n\n## Compiled prompt\n\n\(query)\n\n## Response\n\n\(citedResponse)\n"
            + (error.map { "\nError: \($0)\n" } ?? "")
    }
}
