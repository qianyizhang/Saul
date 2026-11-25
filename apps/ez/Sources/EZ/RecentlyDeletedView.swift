import EZCore
import SwiftUI

@MainActor struct LibraryMaintenance {
    let reader: HistoryReader
    let writer: HistoryWriter

    func list(after cursor: HistoryCursor?) async throws -> HistoryPage {
        if cursor == nil { try await writer.pruneExpired() }
        return try await reader.list(.library, visibility: .masked, after: cursor)
    }

    func restore(_ row: HistoryRow) async throws {
        guard let revision = row.revision else { throw EZError("Reload Recently deleted.") }
        _ = try await writer.restore(.record(row.recordID), write: HistoryWrite(expectedRevision: revision))
    }

    func purge(_ row: HistoryRow) async throws {
        guard let revision = row.revision else { throw EZError("Reload Recently deleted.") }
        _ = try await writer.purge(.record(row.recordID), write: HistoryWrite(expectedRevision: revision))
    }

    func clear() async throws {
        _ = try await writer.clear(.library, write: HistoryWrite(expectedRevision: nil))
    }
}

struct RecentlyDeletedView: View {
    @ObservedObject var model: AppModel
    let library: LibraryMaintenance
    @Environment(\.dismiss) private var dismiss
    @State private var page: [HistoryRow] = []
    @State private var next: HistoryCursor?
    @State private var selected: UUID?
    @State private var pending: Confirmation?
    @State private var failure: String?
    @State private var loading = false

    private enum Confirmation {
        case clear
        case purge(HistoryRow)

        var title: String {
            switch self {
            case .clear: "Clear History?"
            case .purge: "Delete permanently?"
            }
        }

        var actionTitle: String {
            switch self {
            case .clear: "Clear History"
            case .purge: "Delete permanently"
            }
        }

        var message: String {
            switch self {
            case .clear:
                "Permanently delete all Library history, including Recently deleted, in EZ and Saul?"
            case .purge(let row):
                "Permanently delete “\(row.displayQuery)” from EZ and Saul?"
            }
        }
    }

    private var selectedRow: HistoryRow? { page.first { $0.id == selected } }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Recently deleted").font(AppStyle.subject)
            List(selection: $selected) {
                ForEach(page) { row in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(row.displayQuery).font(AppStyle.control).lineLimit(2).help(row.displayQuery)
                        if let date = row.maskedAt {
                            Text("Deleted \(date.formatted(date: .abbreviated, time: .omitted))")
                                .font(AppStyle.caption).foregroundStyle(.secondary)
                        }
                    }.tag(row.id)
                }
                if let next {
                    Button("Load more") { Task { await reload(after: next) } }.disabled(loading)
                }
            }
            .overlay {
                if loading && page.isEmpty {
                    ProgressView("Loading Recently deleted…")
                } else if page.isEmpty && failure == nil {
                    Text("No recently deleted history").foregroundStyle(.secondary)
                }
            }
            if let failure {
                HStack {
                    Text(failure).foregroundStyle(.secondary).textSelection(.enabled)
                    Button("Refresh") { Task { await reload() } }.disabled(loading)
                }.font(AppStyle.caption)
            }
            HStack {
                Button("Clear History…", role: .destructive) { pending = .clear }
                    .disabled(!model.canMaintainLibrary || loading)
                Spacer()
                if let row = selectedRow {
                    Button("Delete permanently…", role: .destructive) { pending = .purge(row) }
                    Button("Restore") { Task { await change(.restore(row)) } }
                }
                Button("Done") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            .disabled(loading)
        }
        .padding(20)
        .frame(minWidth: 500, idealWidth: 620, minHeight: 360)
        .interactiveDismissDisabled(loading)
        .task { await reload() }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) {
            _ in
            Task { await reload() }
        }
        .alert(
            pending?.title ?? "",
            isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }),
            presenting: pending
        ) { intent in
            Button(intent.actionTitle, role: .destructive) {
                Task {
                    switch intent {
                    case .clear: await change(.clear)
                    case .purge(let row): await change(.purge(row))
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: { intent in
            Text(intent.message)
        }
    }

    private func reload(after cursor: HistoryCursor? = nil) async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let result = try await library.list(after: cursor)
            page = cursor == nil ? result.rows : page + result.rows
            next = result.next
            failure = nil
        } catch {
            if !Task.isCancelled { failure = error.localizedDescription }
        }
    }

    private enum Mutation {
        case restore(HistoryRow)
        case purge(HistoryRow)
        case clear
    }

    private func change(_ action: Mutation) async {
        guard !loading else { return }
        loading = true
        do {
            switch action {
            case .restore(let row): try await library.restore(row)
            case .purge(let row): try await library.purge(row)
            case .clear: try await library.clear()
            }
            selected = nil
            model.refreshHistory()
            loading = false
            await reload()
        } catch {
            failure = error.localizedDescription
            loading = false
        }
    }
}
