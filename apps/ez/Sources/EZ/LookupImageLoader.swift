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

/// HistoryCollection keeps this loader in sync with the selected detail.
@MainActor final class LookupImageLoader {
    private struct Key: Equatable {
        let record: HistoryStore.RecordID
        let run: String?

        init(_ entry: HistoryEntry) {
            record = entry.recordID
            run = entry.sourceRunID
        }
    }

    private var closed = false
    private var key: Key?
    private var bytes: Data?
    private var work: Task<Void, Never>?
    private let read: @MainActor (HistoryEntry) async throws -> Data?
    var onChange: (() -> Void)?

    init(read: @escaping @MainActor (HistoryEntry) async throws -> Data?) {
        self.read = read
    }

    var isLoading: Bool { work != nil }

    func data(for entry: HistoryEntry) -> Data? {
        guard entry.hasImage else { return nil }
        return entry.imageData ?? (key == Key(entry) ? bytes : nil)
    }

    func select(_ entry: HistoryEntry?, retryUnavailable: Bool = false) {
        guard !closed, let entry, entry.hasImage else {
            guard key != nil else { return }
            work?.cancel()
            work = nil
            bytes = nil
            key = nil
            return
        }
        let next = Key(entry)
        if let data = entry.imageData {
            work?.cancel()
            work = nil
            key = next
            bytes = data
        } else if key != next || (retryUnavailable && bytes == nil && work == nil) {
            work?.cancel()
            key = next
            bytes = nil
            work = Task { [weak self, read] in
                let data = try? await read(entry)
                guard !Task.isCancelled, let self else { return }
                bytes = data
                work = nil
                onChange?()
            }
        }
    }

    func close() {
        closed = true
        select(nil)
    }

    func wait() async { await work?.value }
}
