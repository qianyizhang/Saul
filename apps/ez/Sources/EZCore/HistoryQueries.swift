import CSQLite
import Foundation

extension HistoryStore {
    private static let browserFrom = """
        selection s JOIN page p ON p.id=s.page_id JOIN llm_run r
        ON r.rowid=(SELECT rowid FROM llm_run WHERE selection_id=s.id
        AND status NOT IN ('queued','running','saving') ORDER BY created_at DESC,rowid DESC LIMIT 1)
        """
    private static let browserColumns = """
        s.id,s.text,p.url,p.title,r.id AS run_id,r.response_structured IS NOT NULL AS has_image,
        r.input_json,r.prompt_raw,r.response_raw,r.model,r.status,r.error_message,r.created_at,r.latency_ms
        """

    private static var matchesSQL: String {
        let input = "CASE WHEN json_valid(r.input_json) THEN r.input_json ELSE '{}' END"
        return """
            WITH records AS (
              SELECT 'native' AS kind,e.id AS key,upper(json_extract(e.data,'$.id')) AS stable_id,
                CAST(strftime('%s',json_extract(e.data,'$.createdAt')) AS INTEGER)*1000 AS time,
                json_extract(e.data,'$.query') AS query,json_extract(e.data,'$.response') AS answer
              FROM ez_entry e
              UNION ALL
              SELECT 'browser',s.id,ez_history_uuid(s.id),r.created_at,
                COALESCE(json_extract(\(input),'$.userPrompt'),s.text),r.response_raw
              FROM \(Self.browserFrom)
            ), matches AS (
              SELECT kind,key,stable_id,time FROM records
              WHERE ?='' OR ez_history_contains(query,?) OR ez_history_contains(answer,?)
            )
            """
    }

    public func count(search: String, excluding identities: [RecordID] = []) throws -> Int {
        sqlite3_progress_handler(database, 1000, { _ in Task.isCancelled ? 1 : 0 }, nil)
        defer { sqlite3_progress_handler(database, 0, nil, nil) }
        var values: [Any?] = [search, search, search]
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
                try rows(Self.matchesSQL + "SELECT count(*) AS total FROM matches" + predicate, values)
                    .first?["total"] as? Int64 ?? 0)
        }
    }

    public func entry(_ id: RecordID) throws -> HistoryEntry? {
        let snapshot = try transaction(.deferred) {
            try requireCurrentSchema()
            switch id {
            case .native(let uuid):
                return HistorySnapshot(
                    native: try rows(
                        "SELECT data,image IS NOT NULL AS has_image FROM ez_entry WHERE id=?",
                        [uuid.uuidString.lowercased()]), browser: [])
            case .browser(let key):
                return HistorySnapshot(
                    native: [],
                    browser: try rows(
                        "SELECT \(Self.browserColumns) FROM \(Self.browserFrom) WHERE s.id=?", [key]))
            }
        }
        return try snapshot.entries().first
    }

    public func page(search: String = "", after cursor: HistoryCursor? = nil) throws -> HistoryPage {
        if let cursor, cursor.search != search {
            throw EZError("History search changed. Reload the results.")
        }
        sqlite3_progress_handler(database, 1000, { _ in Task.isCancelled ? 1 : 0 }, nil)
        defer { sqlite3_progress_handler(database, 0, nil, nil) }
        return try transaction(.deferred) {
            try requireCurrentSchema()
            let records = Self.matchesSQL
            var values: [Any?] = [search, search, search]
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
                        json_extract(e.data,'$.inputValues')) ELSE substr(s.text,1,512) END AS label,
                      CASE WHEN kind='native' THEN COALESCE(json_extract(e.data,'$.recipeSnapshot.name'),
                        json_extract(e.data,'$.mode')) ELSE 'Saul' END AS name,
                      CASE WHEN kind='native' THEN json_extract(e.data,'$.recipeSnapshot.symbol') ELSE 'doc.text' END AS symbol,
                      json_extract(e.data,'$.mode') AS mode,json_extract(e.data,'$.schemaVersion') AS schema_version,
                      CASE WHEN kind='native' THEN CASE json_extract(e.data,'$.status') WHEN 'pending' THEN 'interrupted'
                        ELSE json_extract(e.data,'$.status') END ELSE r.status END AS status
                    FROM selected
                    LEFT JOIN ez_entry e ON kind='native' AND e.id=key
                    LEFT JOIN selection s ON kind='browser' AND s.id=key
                    LEFT JOIN llm_run r ON r.rowid=(SELECT rowid FROM llm_run WHERE selection_id=s.id
                        AND status NOT IN ('queued','running','saving') ORDER BY created_at DESC,rowid DESC LIMIT 1)
                    ORDER BY time DESC,stable_id DESC,kind DESC
                    """, values)
            try Task.checkCancellation()
            let page = Array(keys.prefix(100))
            let items = try page.map { row -> HistoryRow in
                guard let uuid = (row["stable_id"] as? String).flatMap(UUID.init(uuidString:)),
                    let time = row["time"] as? Int64, let kind = row["kind"] as? String,
                    let id = row["key"] as? String, let label = row["label"] as? String,
                    let name = row["name"] as? String, let status = row["status"] as? String
                else { throw EZError("Invalid saved history list record. Original data preserved.") }
                if kind == "native", row["schema_version"] as? Int64 != 1 {
                    throw EZError("Unsupported history entry version. Original data preserved.")
                }
                let mode = (row["mode"] as? String).flatMap(QueryMode.init(rawValue:)) ?? .ask
                return HistoryRow(
                    id: uuid, recordID: kind == "native" ? .native(uuid) : .browser(selectionID: id),
                    createdAt: Date(timeIntervalSince1970: Double(time) / 1000), displayQuery: label,
                    actionName: name, actionSymbol: row["symbol"] as? String ?? mode.symbol, status: status)
            }
            let last = page.last
            let next =
                keys.count > 100
                ? last.flatMap { row -> HistoryCursor? in
                    guard let time = row["time"] as? Int64, let id = row["stable_id"] as? String,
                        let kind = row["kind"] as? String
                    else { return nil }
                    return HistoryCursor(milliseconds: time, id: id, kind: kind, search: search)
                } : nil
            let total: Int64
            if let count = keys.first?["total"] as? Int64 {
                total = count
            } else {
                total =
                    try rows(records + "SELECT count(*) AS total FROM matches", [search, search, search])
                    .first?["total"] as? Int64 ?? 0
            }
            return HistoryPage(rows: items, next: next, total: Int(total))
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
                        let query = historyString(args?[0]) ?? ""
                        var label = query
                        if let question = historyString(args?[1]) {
                            label = question
                        } else if let template = historyString(args?[2]),
                            let encoded = historyString(args?[3]),
                            let fields = try? PromptTemplate(template).fields,
                            let values = try? JSONDecoder().decode(
                                [String: String].self, from: Data(encoded.utf8))
                        {
                            label = fields.compactMap { values[$0] }.joined(separator: " · ")
                        }
                        historyResult(context, String(label.prefix(512)))
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
