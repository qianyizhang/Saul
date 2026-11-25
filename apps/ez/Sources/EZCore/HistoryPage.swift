import Foundation
import SaulNativeValues

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
        let time = entry.createdAt.timeIntervalSince1970
        self.init(
            id: entry.id, recordID: entry.recordID,
            createdAt: entry.sourceID == nil ? Date(timeIntervalSince1970: floor(time)) : entry.createdAt,
            displayQuery: entry.displayQuery, mode: entry.mode, actionName: entry.actionSnapshot?.name,
            actionCapability: entry.actionSnapshot?.capability,
            actionLegacyMode: entry.actionSnapshot?.legacyMode,
            status: entry.status)
    }

    init(
        id: UUID, recordID: HistoryStore.RecordID, createdAt: Date, displayQuery: String,
        mode: QueryMode, actionName: String?, actionCapability: ActionCapability?,
        actionLegacyMode: QueryMode?, status: String
    ) {
        self.id = id
        self.recordID = recordID
        self.createdAt = createdAt
        self.displayQuery = Self.boundedLabel(displayQuery)
        let presentation = HistoryActionPresentation(
            recordID: recordID, mode: mode, name: actionName, capability: actionCapability,
            legacyMode: actionLegacyMode)
        self.actionName = presentation.name
        self.actionSymbol = presentation.symbol
        self.status = status
    }

    static func boundedLabel(_ label: String) -> String { String(label.prefix(512)) }

}

/// Only the persisted fields needed to derive the action label and symbol.
struct HistoryActionPresentation {
    let name: String
    let symbol: String

    init(
        recordID: HistoryStore.RecordID, mode: QueryMode, name: String?,
        capability: ActionCapability?, legacyMode: QueryMode?
    ) {
        switch recordID {
        case .browser:
            self.name = "Saul"
            symbol = "doc.text"
        case .native:
            self.name = name ?? mode.rawValue
            symbol =
                name == nil
                ? mode.symbol : Action.symbol(capability: capability ?? .write, legacyMode: legacyMode)
        }
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
