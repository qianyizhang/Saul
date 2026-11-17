import Foundation

/// Bounded list presentation, without full answers, images or replay configuration.
public struct HistoryRow: Identifiable, Equatable, Sendable {
    public let id: UUID
    public let recordID: HistoryStore.RecordID
    public let createdAt: Date
    public let displayQuery: String
    public let actionName: String
    public let actionSymbol: String
    public let status: String

    public init(_ entry: HistoryEntry) {
        id = entry.id
        recordID = entry.recordID
        createdAt = entry.createdAt
        displayQuery = String(entry.displayQuery.prefix(512))
        actionName = entry.actionName
        actionSymbol = entry.actionSymbol
        status = entry.status
    }

    init(
        id: UUID, recordID: HistoryStore.RecordID, createdAt: Date, displayQuery: String,
        actionName: String, actionSymbol: String, status: String
    ) {
        self.id = id
        self.recordID = recordID
        self.createdAt = createdAt
        self.displayQuery = displayQuery
        self.actionName = actionName
        self.actionSymbol = actionSymbol
        self.status = status
    }
}

public struct HistoryCursor: Equatable, Sendable {
    public let milliseconds: Int64
    public let id: String
    public let kind: String
    public let search: String
    public init(milliseconds: Int64, id: String, kind: String, search: String = "") {
        self.milliseconds = milliseconds
        self.id = id
        self.kind = kind
        self.search = search
    }
}

public struct HistoryPage: Sendable {
    public let rows: [HistoryRow]
    public let next: HistoryCursor?
    public let total: Int
    public init(rows: [HistoryRow], next: HistoryCursor? = nil, total: Int? = nil) {
        self.rows = rows
        self.next = next
        self.total = total ?? rows.count
    }
}
