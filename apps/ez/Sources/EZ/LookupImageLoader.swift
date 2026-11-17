import AppKit
import EZCore
import SaulNativeValues

extension AppModel {
    func downloadImage(_ entry: HistoryEntry) {
        guard let data = imageData(for: entry) else {
            error = "The saved image is unavailable."
            return
        }
        let panel = NSSavePanel()
        let gif = data.starts(with: Array("GIF8".utf8))
        panel.allowedContentTypes = gif ? [.gif] : [.png]
        panel.nameFieldStringValue = "EZ-\(entry.id.uuidString.prefix(8)).\(gif ? "gif" : "png")"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do { try data.write(to: url, options: .atomic) } catch { self.error = error.localizedDescription }
    }
}

/// Loading a selected image is independent of the active provider attempt.
@MainActor final class LookupImageLoader {
    private enum State {
        case empty
        case loading(Task<Void, Never>)
        case ready(UUID, Data)
    }

    private var state: State = .empty {
        didSet { onChange() }
    }
    private let reader: HistoryReader
    private let onChange: () -> Void

    init(directory: URL, onChange: @escaping () -> Void) {
        reader = HistoryReader(directory: directory)
        self.onChange = onChange
    }

    var isLoading: Bool {
        if case .loading = state { return true }
        return false
    }

    func data(for entry: HistoryEntry) -> Data? {
        guard entry.hasImage else { return nil }
        if let data = entry.imageData { return data }
        guard case .ready(let id, let data) = state, id == entry.id else { return nil }
        return data
    }

    func select(_ entry: HistoryEntry?) {
        if case .loading(let task) = state { task.cancel() }
        guard let entry, entry.hasImage else {
            state = .empty
            return
        }
        if let data = entry.imageData {
            state = .ready(entry.id, data)
            return
        }
        state = .loading(
            Task { [weak self, reader] in
                let data = try? await reader.image(for: entry)
                guard !Task.isCancelled, let self else { return }
                state = data.map { .ready(entry.id, $0) } ?? .empty
            })
    }
}
