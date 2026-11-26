import EZCore
import Foundation
import SaulNativeValues

/// Resolves the choices for one request. Saved requests must still use their original route.
struct LookupRoute {
    let preset: ModelPreset
    let connection: ConnectionDefinition
    let models: [ConnectionModel]

    func requireSavedConnection(_ saved: ConnectionDefinition?) throws {
        guard let saved, saved.matchesRoute(connection) else {
            throw EZError("The saved connection is unavailable or changed. Review the saved request.")
        }
    }

    func followUp(to answer: HistoryEntry, question: String) throws -> HistoryEntry {
        try requireSavedConnection(answer.connectionSnapshot)
        var entry = try answer.prepareFollowUp(question, models: models, provider: connection.kind)
        entry.connectionSnapshot = connection
        return entry
    }
}

/// Prepares a new lookup from the current draft and snapshots the route before any provider work.
struct LookupRequest {
    let action: Action
    let route: LookupRoute
    let values: [String: String]
    let source: ImageSource
    let outputFormat: String

    enum ImageSource {
        case attachment(ImageAttachment?)
        case sketch(SketchScene)

        var present: Bool {
            switch self {
            case .attachment(let image): image != nil
            case .sketch(let scene): scene.hasContent
            }
        }

        func freeze() throws -> ImageAttachment? {
            switch self {
            case .attachment(let image): image
            case .sketch(let scene): try scene.attachmentForRun()
            }
        }
    }

    func compile() throws -> Action.Compiled {
        var preset = route.preset
        if preset.capability == .draw {
            var options = preset.imageOptions ?? ImageOptions()
            options.outputFormat = outputFormat
            preset.imageOptions = options
        }
        let compiled = try action.compile(
            values: values, preset: preset, models: route.models, provider: route.connection.kind)
        if action.imageInput != nil && !source.present {
            if case .sketch = source { throw EZError("Draw or paste a sketch before running.") }
            throw EZError("Attach an image before running.")
        }
        return compiled
    }

    func freeze() throws -> HistoryEntry {
        var entry = try compile().freeze(image: action.imageInput == nil ? nil : source.freeze())
        entry.connectionSnapshot = route.connection
        return entry
    }
}
