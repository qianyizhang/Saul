import CSQLite
import Foundation
import SaulNativeValues

extension HistoryStore {
    static let nativeFrom = """
        ez_entry e JOIN history_record h ON h.collection='library-native' AND h.id=e.id AND h.owner=''
        JOIN history_entry d ON d.collection=h.collection AND d.record_id=h.id AND d.owner=h.owner AND d.id=e.id
        """

    private static func nativeEntryFilter(_ visibility: HistoryVisibility) -> String {
        visibility == .visible
            ? "d.masked_at IS NULL"
            : HistoryVisibility.all.predicate("d.masked_at")
    }

    private static func browserFrom(_ visibility: HistoryVisibility) -> String {
        """
        selection s JOIN history_record h ON h.collection='library-browser' AND h.id=s.id AND h.owner=''
        JOIN page p ON p.id=s.page_id JOIN llm_run r
        ON r.rowid=(SELECT candidate.rowid FROM llm_run candidate JOIN history_entry detail
            ON detail.collection='library-browser' AND detail.record_id=s.id
            AND detail.id=candidate.id AND detail.owner='' WHERE candidate.selection_id=s.id
            AND \(visibility == .visible ? "detail.masked_at IS NULL" : HistoryVisibility.all.predicate("detail.masked_at"))
        AND status NOT IN ('queued','running','saving') ORDER BY created_at DESC,candidate.rowid DESC LIMIT 1)
        """
    }
    static let browserColumns = """
        s.id,s.text,p.url,p.title,r.id AS run_id,r.response_structured IS NOT NULL AS has_image,
        r.input_json,r.prompt_raw,r.response_raw,r.model,r.status,r.error_message,r.created_at,r.latency_ms
        """

    private static func matchesSQL(_ visibility: HistoryVisibility) -> String {
        let input = "CASE WHEN json_valid(r.input_json) THEN r.input_json ELSE '{}' END"
        let effectiveMask = HistoryVisibility.effectiveMask(parent: "h.masked_at", child: "d.masked_at")
        return """
            WITH records AS (
              SELECT 'native' AS kind,e.id AS key,upper(json_extract(e.data,'$.id')) AS stable_id,
                CAST(strftime('%s',json_extract(e.data,'$.createdAt')) AS INTEGER)*1000 AS time,
                json_extract(e.data,'$.query') AS query,json_extract(e.data,'$.response') AS answer,
                \(effectiveMask) AS masked_at, h.revision, NULL AS run_id
              FROM \(Self.nativeFrom)
              WHERE \(visibility.predicate("h.masked_at")) AND \(Self.nativeEntryFilter(visibility))
              UNION ALL
              SELECT 'browser',s.id,ez_history_uuid(s.id),r.created_at,
                COALESCE(json_extract(\(input),'$.userPrompt'),s.text),r.response_raw,h.masked_at,h.revision,r.id
              FROM \(Self.browserFrom(visibility))
              WHERE \(visibility.predicate("h.masked_at")) AND (
                ?1='' OR EXISTS (
                  SELECT 1 FROM llm_run candidate JOIN history_entry search_entry
                  ON search_entry.collection='library-browser' AND search_entry.record_id=s.id
                  AND search_entry.owner='' AND search_entry.id=candidate.id
                  WHERE candidate.selection_id=s.id AND candidate.status NOT IN ('queued','running','saving')
                    AND \(visibility == .visible ? "search_entry.masked_at IS NULL" : HistoryVisibility.all.predicate("search_entry.masked_at"))
                    AND (ez_history_contains(
                      COALESCE(json_extract(
                        CASE WHEN json_valid(candidate.input_json) THEN candidate.input_json ELSE '{}' END,
                        '$.userPrompt'
                      ),s.text),?1) OR ez_history_contains(candidate.response_raw,?1))
                )
              )
            ), matches AS (
              SELECT kind,key,stable_id,time,masked_at,revision,run_id FROM records
              WHERE kind='browser' OR ?1='' OR ez_history_contains(query,?1) OR ez_history_contains(answer,?1)
            )
            """
    }

    public func count(
        search: String, excluding identities: [RecordID] = [], visibility: HistoryVisibility = .visible
    ) throws -> Int {
        sqlite3_progress_handler(database, 1000, { _ in Task.isCancelled ? 1 : 0 }, nil)
        defer { sqlite3_progress_handler(database, 0, nil, nil) }
        var values: [Any?] = [search]
        let exclusions = identities.map { identity -> String in
            switch identity {
            case .native(let id): values += ["native", id.uuidString.lowercased()]
            case .browser(let id): values += ["browser", id]
            }
            return "(kind=? AND key=?)"
        }
        let predicate = exclusions.isEmpty ? "" : " WHERE NOT (" + exclusions.joined(separator: " OR ") + ")"
        return try transaction(.deferred) {
            try requireCurrentSchema()
            return Int(
                try rows(
                    Self.matchesSQL(visibility) + "SELECT count(*) AS total FROM matches" + predicate, values
                )
                .first?["total"] as? Int64 ?? 0)
        }
    }

    public func entry(_ id: RecordID) throws -> HistoryEntry? {
        try get(id)?.value
    }

    public func get(
        _ id: RecordID, view: HistoryDetailView = .lookup, visibility: HistoryVisibility = .visible
    ) throws
        -> HistoryRecord<HistoryEntry>?
    {
        let saved: (HistorySnapshot, Int64, Date?)? = try transaction(.deferred) {
            try requireCurrentSchema()
            guard let metadata = try recordMetadata(id, visibility: visibility) else { return nil }
            let snapshot: HistorySnapshot
            switch id {
            case .native(let uuid):
                snapshot = HistorySnapshot(
                    native: try rows(
                        "SELECT e.data,e.image IS NOT NULL AS has_image FROM \(Self.nativeFrom) WHERE e.id=? AND \(Self.nativeEntryFilter(visibility))",
                        [uuid.uuidString.lowercased()]), browser: [])
            case .browser(let key):
                snapshot = HistorySnapshot(
                    native: [],
                    browser: try rows(
                        "SELECT \(Self.browserColumns) FROM \(Self.browserFrom(visibility)) WHERE s.id=?",
                        [key]))
            }
            return (snapshot, metadata.revision, metadata.maskedAt)
        }
        guard let (snapshot, revision, maskedAt) = saved, let value = try snapshot.entries().first else {
            return nil
        }
        return HistoryRecord(id: id, revision: revision, maskedAt: maskedAt, value: value)
    }

    public func entries(
        _ record: RecordID, view: HistoryEntryView = .attempts,
        visibility: HistoryVisibility = .visible, after cursor: HistoryEntryCursor? = nil
    ) throws -> HistoryEntryPage {
        if let cursor, cursor.record != record || cursor.visibility != visibility {
            throw EZError("History entry scope changed. Reload the results.")
        }
        return try transaction(.deferred) {
            try requireCurrentSchema()
            let after = cursor?.position ?? -1
            let values: [Any?] = [record.key, after]
            let mask = HistoryVisibility.effectiveMask(parent: "h.masked_at", child: "d.masked_at")
            let kind = record.collection.rawValue
            let metadata = """
                JOIN history_record h ON h.collection='\(kind)' AND h.id=? AND h.owner=''
                JOIN history_entry d ON d.collection=h.collection AND d.record_id=h.id AND d.owner=h.owner
                """
            let filter = "d.position>? AND \(visibility.predicate(mask)) ORDER BY d.position LIMIT 101"
            let results: [[String: Any]]
            switch record {
            case .native:
                results = try rows(
                    """
                    SELECT e.data,e.image IS NOT NULL AS has_image,d.id AS entry_id,d.position,\(mask) AS effective_mask
                    FROM ez_entry e \(metadata)
                    WHERE e.id=h.id AND d.id=e.id AND \(filter)
                    """, values)
            case .browser:
                results = try rows(
                    """
                    SELECT \(Self.browserColumns),d.id AS entry_id,d.position,\(mask) AS effective_mask
                    FROM selection s JOIN page p ON p.id=s.page_id \(metadata)
                    JOIN llm_run r ON r.selection_id=s.id AND r.id=d.id
                    WHERE s.id=h.id AND r.status NOT IN ('queued','running','saving') AND \(filter)
                    """, values)
            }
            let entries = try results.prefix(100).map { row -> HistoryRecordEntry in
                guard let key = row["entry_id"] as? String, let position = row["position"] as? Int64 else {
                    throw EZError("Invalid saved history entry.")
                }
                let snapshot: HistorySnapshot
                let identity: HistoryEntryID
                switch record {
                case .native(let id):
                    snapshot = HistorySnapshot(native: [row], browser: [])
                    identity = .native(id)
                case .browser:
                    snapshot = HistorySnapshot(native: [], browser: [row])
                    identity = .browser(key)
                }
                guard let entry = try snapshot.entries().first else {
                    throw EZError("Invalid saved history entry.")
                }
                return HistoryRecordEntry(
                    id: identity, position: position,
                    maskedAt: (row["effective_mask"] as? Int64).map(HistoryVisibility.date), value: entry)
            }
            let next =
                results.count > 100
                ? entries.last.map {
                    HistoryEntryCursor(record: record, position: $0.position, visibility: visibility)
                }
                : nil
            return HistoryEntryPage(entries: entries, next: next)
        }
    }

    public func page(search: String = "", after cursor: HistoryCursor? = nil) throws -> HistoryPage {
        try list(.library, search: search, after: cursor)
    }

    public func list(
        _ view: HistoryListView, search: String = "", visibility: HistoryVisibility = .visible,
        after cursor: HistoryCursor? = nil
    ) throws -> HistoryPage {
        if let cursor, cursor.search != search || cursor.visibility != visibility {
            throw EZError("History search changed. Reload the results.")
        }
        sqlite3_progress_handler(database, 1000, { _ in Task.isCancelled ? 1 : 0 }, nil)
        defer { sqlite3_progress_handler(database, 0, nil, nil) }
        return try transaction(.deferred) {
            try requireCurrentSchema()
            let records = Self.matchesSQL(visibility)
            var values: [Any?] = [search]
            let whereCursor: String
            if let cursor {
                whereCursor = "WHERE (time,stable_id,kind) < (?,?,?)"
                values += [cursor.milliseconds, cursor.id, cursor.kind]
            } else {
                whereCursor = ""
            }
            let keys = try rows(
                records + """
                    , selected AS MATERIALIZED (
                        SELECT *, (SELECT count(*) FROM matches) AS total FROM matches \(whereCursor)
                        ORDER BY time DESC,stable_id DESC,kind DESC LIMIT 101
                    )
                    SELECT selected.*,
                      CASE WHEN kind='native' THEN ez_history_label(json_extract(e.data,'$.query'),
                        json_extract(e.data,'$.followUpQuestion'),json_extract(e.data,'$.recipeSnapshot.template'),
                        json_extract(e.data,'$.inputValues')) ELSE ez_history_label(s.text,NULL,NULL,NULL) END AS label,
                      json_extract(e.data,'$.recipeSnapshot.name') AS name,
                      json_extract(e.data,'$.recipeSnapshot.capability') AS capability,
                      json_extract(e.data,'$.recipeSnapshot.legacyMode') AS legacy_mode,
                      json_extract(e.data,'$.mode') AS mode,json_extract(e.data,'$.schemaVersion') AS schema_version,
                      CASE WHEN kind='native' THEN CASE json_extract(e.data,'$.status') WHEN 'pending' THEN 'interrupted'
                        ELSE json_extract(e.data,'$.status') END ELSE r.status END AS status
                    FROM selected
                    LEFT JOIN ez_entry e ON kind='native' AND e.id=key
                    LEFT JOIN selection s ON kind='browser' AND s.id=key
                    LEFT JOIN llm_run r ON r.id=selected.run_id
                    ORDER BY time DESC,stable_id DESC,kind DESC
                    """, values)
            try Task.checkCancellation()
            let page = Array(keys.prefix(100))
            let items = try page.map { row -> HistoryRow in
                guard let uuid = (row["stable_id"] as? String).flatMap(UUID.init(uuidString:)),
                    let time = row["time"] as? Int64, let kind = row["kind"] as? String,
                    let id = row["key"] as? String, let label = row["label"] as? String,
                    let status = row["status"] as? String
                else { throw EZError("Invalid saved history list record. Original data preserved.") }
                if kind == "native", row["schema_version"] as? Int64 != 1 {
                    throw EZError("Unsupported history entry version. Original data preserved.")
                }
                let mode = (row["mode"] as? String).flatMap(QueryMode.init(rawValue:)) ?? .ask
                return HistoryRow(
                    id: uuid, recordID: kind == "native" ? .native(uuid) : .browser(selectionID: id),
                    createdAt: Date(timeIntervalSince1970: Double(time) / 1000), displayQuery: label,
                    mode: mode, actionName: row["name"] as? String,
                    actionCapability: (row["capability"] as? String).flatMap(
                        ActionCapability.init(rawValue:)),
                    actionLegacyMode: (row["legacy_mode"] as? String).flatMap(QueryMode.init(rawValue:)),
                    status: status, maskedAt: (row["masked_at"] as? Int64).map(HistoryVisibility.date),
                    revision: row["revision"] as? Int64)
            }
            let last = page.last
            let next =
                keys.count > 100
                ? last.flatMap { row -> HistoryCursor? in
                    guard let time = row["time"] as? Int64, let id = row["stable_id"] as? String,
                        let kind = row["kind"] as? String
                    else { return nil }
                    return HistoryCursor(
                        milliseconds: time, id: id, kind: kind, search: search, visibility: visibility)
                } : nil
            let total: Int64
            if let count = keys.first?["total"] as? Int64 {
                total = count
            } else {
                total =
                    try rows(records + "SELECT count(*) AS total FROM matches", [search])
                    .first?["total"] as? Int64 ?? 0
            }
            return HistoryPage(rows: items, next: next, total: Int(total))
        }
    }

    func snapshot() throws -> HistorySnapshot {
        try transaction(.deferred) {
            try requireCurrentSchema()
            return HistorySnapshot(
                native: try rows(
                    """
                    SELECT e.data,e.image IS NOT NULL AS has_image FROM \(Self.nativeFrom)
                    WHERE h.masked_at IS NULL AND d.masked_at IS NULL
                    """),
                browser: try rows(
                    "SELECT \(Self.browserColumns) FROM \(Self.browserFrom(.visible)) WHERE h.masked_at IS NULL"
                ))
        }
    }

    func installHistoryFunctions() throws {
        let functions:
            [(
                String, Int32,
                (@convention(c) (OpaquePointer?, Int32, UnsafeMutablePointer<OpaquePointer?>?) -> Void)
            )] = [
                (
                    "ez_history_contains", 2,
                    { context, _, args in
                        let value = historyString(args?[0]) ?? ""
                        let search = historyString(args?[1]) ?? ""
                        sqlite3_result_int(context, value.localizedCaseInsensitiveContains(search) ? 1 : 0)
                    }
                ),
                (
                    "ez_history_uuid", 1,
                    { context, _, args in
                        historyResult(
                            context, HistorySnapshot.browserID(historyString(args?[0]) ?? "").uuidString)
                    }
                ),
                (
                    "ez_history_label", 4,
                    { context, _, args in
                        let values = historyString(args?[3]).flatMap {
                            try? JSONDecoder().decode([String: String].self, from: Data($0.utf8))
                        }
                        let label = HistoryEntry.displayQuery(
                            query: historyString(args?[0]) ?? "", question: historyString(args?[1]),
                            template: historyString(args?[2]), values: values)
                        historyResult(context, HistoryRow.boundedLabel(label))
                    }
                ),
            ]
        for (name, arguments, body) in functions {
            guard
                sqlite3_create_function_v2(
                    database, name, arguments, SQLITE_UTF8, nil,
                    body, nil, nil, nil) == SQLITE_OK
            else {
                throw EZError("Could not prepare history search.")
            }
        }
    }
}

private func historyString(_ value: OpaquePointer?) -> String? {
    guard let value, sqlite3_value_type(value) != SQLITE_NULL, let text = sqlite3_value_text(value) else {
        return nil
    }
    return String(
        decoding: UnsafeBufferPointer(start: text, count: Int(sqlite3_value_bytes(value))), as: UTF8.self)
}
private func historyResult(_ context: OpaquePointer?, _ text: String) {
    text.withCString { bytes in
        sqlite3_result_text(
            context, bytes, Int32(text.utf8.count), unsafeBitCast(-1, to: sqlite3_destructor_type.self))
    }
}
