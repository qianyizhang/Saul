import Foundation

public enum HistoryVisibility: String, Sendable {
    case visible, masked, all

    static let retention: Int64 = 365 * 24 * 60 * 60 * 1000

    static func effectiveMask(parent: String, child: String) -> String {
        let unmasked = Int64.max
        return "NULLIF(MIN(COALESCE(\(parent),\(unmasked)),COALESCE(\(child),\(unmasked))),\(unmasked))"
    }
    static func milliseconds(_ date: Date) -> Int64 { Int64(date.timeIntervalSince1970 * 1000) }
    static func date(_ milliseconds: Int64) -> Date {
        Date(timeIntervalSince1970: Double(milliseconds) / 1000)
    }

    func predicate(_ mask: String) -> String {
        predicate(mask, cutoff: Self.milliseconds(Date()) - Self.retention)
    }

    func predicate(_ mask: String, cutoff: Int64) -> String {
        switch self {
        case .visible: "\(mask) IS NULL"
        case .masked: "\(mask) > \(cutoff)"
        case .all: "(\(mask) IS NULL OR \(mask) > \(cutoff))"
        }
    }
}

public enum HistoryListView: Sendable { case library }
public enum HistoryDetailView: Sendable { case lookup }
public enum HistoryEntryView: Sendable { case attempts }

public struct HistoryRecord<Value: Sendable>: Sendable {
    public let id: HistoryStore.RecordID
    public let revision: Int64
    public let maskedAt: Date?
    public let value: Value
}

public enum HistoryEntryID: Hashable, Sendable {
    case native(UUID)
    case browser(String)
}

public struct HistoryRecordEntry: Identifiable, Sendable {
    public let id: HistoryEntryID
    public let position: Int64
    public let maskedAt: Date?
    public let value: HistoryEntry
}

public struct HistoryEntryCursor: Equatable, Sendable {
    let record: HistoryStore.RecordID
    let position: Int64
    let visibility: HistoryVisibility
}

public struct HistoryEntryPage: Sendable {
    public let entries: [HistoryRecordEntry]
    public let next: HistoryEntryCursor?
}

public enum HistoryTarget: Hashable, Sendable {
    case record(HistoryStore.RecordID)
    case entry(HistoryStore.RecordID, HistoryEntryID)
}

public enum HistoryCollectionScope: String, Sendable {
    case library
    case libraryBrowser = "library-browser"
    case libraryNative = "library-native"

    var physicalCollections: [String] {
        switch self {
        case .library: [Self.libraryBrowser.rawValue, Self.libraryNative.rawValue]
        default: [rawValue]
        }
    }
}

extension HistoryStore.RecordID {
    var key: String {
        switch self {
        case .native(let id): id.uuidString.lowercased()
        case .browser(let id): id
        }
    }

    var collection: HistoryCollectionScope {
        switch self {
        case .native: .libraryNative
        case .browser: .libraryBrowser
        }
    }
}

extension HistoryStore {
    func recordMetadata(_ id: RecordID, visibility: HistoryVisibility = .all) throws
        -> (revision: Int64, maskedAt: Date?)?
    {
        guard
            let row = try rows(
                """
                SELECT revision, masked_at FROM history_record
                WHERE collection=? AND id=? AND owner='' AND \(visibility.predicate("masked_at"))
                """,
                [id.collection.rawValue, id.key]
            ).first
        else { return nil }
        guard let revision = row["revision"] as? Int64, revision >= 0 else {
            throw EZError("Invalid history revision.")
        }
        return (revision, (row["masked_at"] as? Int64).map(HistoryVisibility.date))
    }
}

public enum HistoryAttachmentRef: Sendable {
    case input(HistoryStore.RecordID)
    case output(HistoryStore.RecordID, browserAttempt: String?)
}

extension HistoryStore {
    public func attachment(_ ref: HistoryAttachmentRef, visibility: HistoryVisibility = .visible) throws
        -> Data?
    {
        try transaction(.deferred) {
            try requireCurrentSchema()
            switch ref {
            case .input(.native(let id)):
                return try nativeAttachment(id, field: "input_image", visibility: visibility)
            case .output(.native(let id), nil):
                return try nativeAttachment(id, field: "image", visibility: visibility)
            case .output(.browser(let selection), .some(let run)):
                return try browserAttachment(selection, run: run, visibility: visibility)
            default: throw EZError("Invalid history attachment reference.")
            }
        }
    }

    func nativeEntryAvailable(_ id: UUID) throws -> Bool {
        try !rows(
            "SELECT 1 FROM \(Self.nativeFrom) WHERE e.id=? AND h.masked_at IS NULL AND d.masked_at IS NULL",
            [id.uuidString.lowercased()]
        ).isEmpty
    }

    private func nativeAttachment(_ id: UUID, field: String, visibility: HistoryVisibility) throws -> Data? {
        let effectiveMask = HistoryVisibility.effectiveMask(parent: "h.masked_at", child: "d.masked_at")
        return try rows(
            "SELECT e.\(field) AS bytes FROM \(Self.nativeFrom) WHERE e.id=? AND \(visibility.predicate(effectiveMask))",
            [id.uuidString.lowercased()]
        ).first?["bytes"] as? Data
    }

    private func browserAttachment(_ selection: String, run: String, visibility: HistoryVisibility) throws
        -> Data?
    {
        let effectiveMask =
            "NULLIF(MIN(COALESCE(h.masked_at,9223372036854775807),COALESCE(e.masked_at,9223372036854775807)),9223372036854775807)"
        guard
            let json = try rows(
                """
                SELECT r.response_structured FROM llm_run r
                JOIN history_record h ON h.collection='library-browser' AND h.id=r.selection_id AND h.owner=''
                JOIN history_entry e ON e.collection=h.collection AND e.record_id=h.id AND e.owner=h.owner AND e.id=r.id
                WHERE r.selection_id=? AND r.id=? AND r.status='completed' AND \(visibility.predicate(effectiveMask))
                """,
                [selection, run]
            ).first?["response_structured"] as? String,
            let image = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
            image["complete"] as? Bool == true,
            ["image/png", "image/gif"].contains(image["mediaType"] as? String ?? ""),
            let encoded = image["data"] as? String, encoded.utf8.count <= 28_000_000,
            let data = Data(base64Encoded: encoded), !data.isEmpty, data.count <= 20 * 1024 * 1024
        else { return nil }
        return data
    }
}
