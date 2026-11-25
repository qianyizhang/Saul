import CryptoKit
import Foundation

public struct HistoryWrite: Sendable {
    public let operationID: String
    public let expectedRevision: Int64?

    public init(operationID: String = UUID().uuidString.lowercased(), expectedRevision: Int64?) {
        self.operationID = operationID
        self.expectedRevision = expectedRevision
    }
}

public struct HistoryAcknowledgement: Equatable, Sendable {
    public let revision: Int64
}

extension HistoryStore {
    public func commit(_ record: RecordID, snapshot: HistoryEntry, write: HistoryWrite) throws
        -> HistoryAcknowledgement
    {
        guard record == snapshot.recordID, snapshot.sourceID == nil, snapshot.schemaVersion == 1,
            ["pending", "completed", "failed", "cancelled", "interrupted"].contains(snapshot.status)
        else { throw EZError("Invalid native history snapshot.") }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let payload = try encoder.encode(snapshot)
        let output = snapshot.imageData
        let input = try snapshot.inputImage.flatMap { $0.data == nil ? nil : try $0.validatedData() }
        let fields: [Any] = [record.key, digest(payload), output.map(digest) ?? "", input.map(digest) ?? ""]
        return try mutation("commit", fields: fields, write: write) {
            let current = try recordMetadata(record)
            try validateRevision(current?.revision, write)
            if snapshot.status == "pending", current == nil, let source = snapshot.admissionSourceID {
                guard let id = UUID(uuidString: source), id != snapshot.id,
                    try nativeEntryAvailable(id)
                else { throw EZError("The saved lookup is unavailable. Choose a visible lookup.") }
            }
            if let current {
                guard try nativeEntryAvailable(snapshot.id) else {
                    throw EZError("Restore this lookup before updating it.")
                }
                guard
                    let json = try rows("SELECT data FROM ez_entry WHERE id=?", [record.key]).first?["data"]
                        as? String,
                    let stored = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
                    stored["schemaVersion"] as? Int == 1
                else { throw EZError("Unsupported stored history entry version.") }
                let decoder = JSONDecoder()
                decoder.dateDecodingStrategy = .iso8601
                let previous = try decoder.decode(HistoryEntry.self, from: Data(json.utf8))
                guard
                    let recognized = try JSONSerialization.jsonObject(with: encoder.encode(previous))
                        as? [String: Any],
                    let snapshotFields = try JSONSerialization.jsonObject(with: payload) as? [String: Any]
                else { throw EZError("Invalid native history snapshot.") }
                let known = HistoryEntry.snapshotFieldNames
                let hasUnknownNestedFields = stored.contains { field, value in
                    known.contains(field) && hasUnfamiliarFields(value, comparedTo: recognized[field])
                }
                guard !hasUnknownNestedFields else {
                    throw EZError("This lookup contains fields from a newer version of EZ.")
                }
                let merged = stored.filter { !known.contains($0.key) }.merging(snapshotFields) { _, value in
                    value
                }
                let bytes = try JSONSerialization.data(withJSONObject: merged)
                try execute(
                    "UPDATE ez_entry SET data=?,image=COALESCE(?,image),input_image=COALESCE(?,input_image) WHERE id=?",
                    [String(decoding: bytes, as: UTF8.self), output, input, record.key])
                return current.revision + 1
            }
            try execute(
                "INSERT INTO ez_entry(id,created_at,data,image,input_image) VALUES (?,?,?,?,?)",
                [
                    record.key, HistoryVisibility.milliseconds(snapshot.createdAt),
                    String(decoding: payload, as: UTF8.self), output, input,
                ])
            return 1
        }
    }

    public func mask(_ target: HistoryTarget, write: HistoryWrite) throws -> HistoryAcknowledgement {
        try changeVisibility(target, action: "mask", write: write)
    }

    func maskLocallySettledAttempt(_ id: RecordID, write: HistoryWrite) throws -> HistoryAcknowledgement {
        try changeVisibility(.record(id), action: "mask", write: write, releaseSettled: true)
    }

    public func restore(_ target: HistoryTarget, write: HistoryWrite) throws -> HistoryAcknowledgement {
        try changeVisibility(target, action: "restore", write: write)
    }

    public func purge(_ target: HistoryTarget, write: HistoryWrite) throws -> HistoryAcknowledgement {
        try changeVisibility(target, action: "purge", write: write)
    }

    public func clear(_ scope: HistoryCollectionScope, write: HistoryWrite) throws -> HistoryAcknowledgement {
        guard write.expectedRevision == nil else { throw EZError("Invalid revision for Library clear.") }
        return try mutation("clear", fields: [scope.rawValue], write: write) {
            for collection in scope.physicalCollections {
                if collection == HistoryCollectionScope.libraryBrowser.rawValue {
                    try requireSettled(.libraryBrowser)
                    try execute(
                        "DELETE FROM selection; DELETE FROM page WHERE NOT EXISTS(SELECT 1 FROM selection WHERE page_id=page.id);"
                    )
                } else {
                    try requireSettled(.libraryNative)
                    try execute("DELETE FROM ez_entry")
                }
            }
            return 0
        }
    }

    public func receipt(_ operationID: String) throws -> HistoryAcknowledgement? {
        try validateOperationID(operationID)
        try requireCurrentSchema()
        guard
            let json = try rows(
                "SELECT acknowledgement FROM history_receipt WHERE operation_id=?", [operationID]
            ).first?["acknowledgement"] as? String
        else { return nil }
        return try acknowledgement(json)
    }

    func expireMasks() throws {
        let cutoff = HistoryVisibility.milliseconds(Date()) - HistoryVisibility.retention
        try transaction {
            try requireCurrentSchema()
            // Remove complete records first. Cascades remove their entries and attached bytes.
            try execute(
                """
                DELETE FROM selection WHERE id IN (
                  SELECT id FROM history_record WHERE collection='library-browser' AND owner='' AND masked_at<=?
                )
                """, [cutoff])
            try execute(
                """
                DELETE FROM ez_entry WHERE id IN (
                  SELECT id FROM history_record WHERE collection='library-native' AND owner='' AND masked_at<=?
                )
                """, [cutoff])
            try execute(
                """
                DELETE FROM llm_run WHERE EXISTS(
                  SELECT 1 FROM history_entry e WHERE e.collection='library-browser'
                  AND e.record_id=llm_run.selection_id AND e.id=llm_run.id AND e.owner='' AND e.masked_at<=?
                )
                """, [cutoff])
            try execute(
                "DELETE FROM history_entry WHERE collection='library-native' AND owner='' AND masked_at<=?",
                [cutoff])
            try removeOrphanPages()
        }
    }

    public func discardPending(_ id: RecordID) throws {
        guard case .native = id else { throw EZError("Invalid pending lookup.") }
        guard let revision = try recordMetadata(id)?.revision else { return }
        let write = HistoryWrite(expectedRevision: revision)
        _ = try mutation("discard", fields: [id.key], write: write) {
            try validateRevision(try recordMetadata(id)?.revision, write)
            // Provider work has settled. Release its pending marker and purge without opening a race.
            try execute(
                "UPDATE ez_entry SET data=json_set(data,'$.status','failed') WHERE id=? AND json_extract(data,'$.status')='pending'",
                [id.key])
            try execute(
                "DELETE FROM ez_entry WHERE id=? AND json_extract(data,'$.status')='failed'", [id.key])
            return revision + 1
        }
    }

    private func changeVisibility(
        _ target: HistoryTarget, action: String, write: HistoryWrite, releaseSettled: Bool = false
    ) throws -> HistoryAcknowledgement {
        let (record, member) = try target.storage()
        return try mutation(
            action,
            fields: [record.collection.rawValue, record.key, member as Any? ?? NSNull(), releaseSettled],
            write: write
        ) {
            guard var revision = try recordMetadata(record)?.revision else {
                throw EZError("This saved history is unavailable.")
            }
            try validateRevision(revision, write)
            let filter: [Any?] = [record.collection.rawValue, record.key]
            let now = HistoryVisibility.milliseconds(Date())
            if let member {
                guard
                    let row = try rows(
                        "SELECT masked_at FROM history_entry WHERE collection=? AND record_id=? AND id=? AND owner=''",
                        filter + [member]
                    ).first
                else { throw EZError("This saved history entry is unavailable.") }
                let date = row["masked_at"] as? Int64
                if action == "purge" {
                    if record.collection == .libraryBrowser {
                        try requireSettled(record.collection, record: record.key, entry: member)
                        try execute(
                            "DELETE FROM llm_run WHERE selection_id=? AND id=?", [record.key, member])
                    } else {
                        try requireSettled(record.collection, record: record.key)
                        try execute(
                            "DELETE FROM history_entry WHERE collection=? AND record_id=? AND id=? AND owner=''",
                            filter + [member])
                    }
                } else {
                    if action == "mask" && date != nil || action == "restore" && date == nil {
                        return revision
                    }
                    if let date, date <= now - HistoryVisibility.retention {
                        throw EZError("This deleted history entry has expired.")
                    }
                    try execute(
                        "UPDATE history_entry SET masked_at=? WHERE collection=? AND record_id=? AND id=? AND owner=''",
                        [action == "mask" ? now : nil] + filter + [member])
                }
                if try recordMetadata(record)?.revision == revision {
                    try execute(
                        "UPDATE history_record SET revision=revision+1 WHERE collection=? AND id=? AND owner=''",
                        filter)
                }
                try setLatestEvent(
                    target, kind: action == "mask" ? "masked" : action == "restore" ? "restored" : "purged",
                    revision: revision + 1)
            } else if action == "purge" {
                try requireSettled(record.collection, record: record.key)
                let table = record.collection == .libraryBrowser ? "selection" : "ez_entry"
                try execute("DELETE FROM \(table) WHERE id=?", [record.key])
                if record.collection == .libraryBrowser { try removeOrphanPages() }
            } else {
                let masked = try recordMetadata(record)?.maskedAt != nil
                if action == "mask" ? masked : !masked { return revision }
                if releaseSettled {
                    try execute(
                        "UPDATE ez_entry SET data=json_set(data,'$.status','interrupted') WHERE id=? AND json_extract(data,'$.status')='pending'",
                        [record.key])
                    revision = try recordMetadata(record)?.revision ?? revision
                }
                try execute(
                    "UPDATE history_record SET masked_at=?,revision=revision+1 WHERE collection=? AND id=? AND owner=''",
                    [action == "mask" ? now : nil] + filter)
            }
            return revision + 1
        }
    }

    private func requireSettled(_ scope: HistoryCollectionScope, record: String? = nil, entry: String? = nil)
        throws
    {
        let browser = scope == .libraryBrowser
        var predicate =
            browser ? "status IN ('queued','running','saving')" : "json_extract(data,'$.status')='pending'"
        let table = browser ? "llm_run" : "ez_entry"
        var values: [Any?] = []
        if let record {
            if browser {
                predicate += " AND selection_id=?"
                values.append(record)
            } else {
                predicate += " AND (id=? OR json_extract(data,'$.admissionSourceID')=?)"
                values += [record, record]
            }
        }
        if let entry {
            predicate += " AND id=?"
            values.append(entry)
        }
        if try !rows("SELECT 1 FROM \(table) WHERE \(predicate) LIMIT 1", values).isEmpty {
            throw EZError(
                "Stop the running request in \(browser ? "Saul" : "EZ") before deleting this history.")
        }
    }

    private func removeOrphanPages() throws {
        try execute("DELETE FROM page WHERE NOT EXISTS(SELECT 1 FROM selection WHERE page_id=page.id)")
    }

    private func setLatestEvent(_ target: HistoryTarget, kind: String, revision: Int64) throws {
        let (record, entry) = try target.storage()
        try execute(
            "UPDATE history_event SET kind=?,entry_id=? WHERE collection=? AND record_id=? AND owner='' AND sequence=?",
            [kind, entry, record.collection.rawValue, record.key, revision])
    }

    private func mutation(
        _ action: String, fields: [Any], write: HistoryWrite, perform: () throws -> Int64
    ) throws -> HistoryAcknowledgement {
        try validateOperationID(write.operationID)
        if let revision = write.expectedRevision, revision < 1 { throw EZError("Invalid history revision.") }
        let fields: [Any] = ["ez", action, write.expectedRevision as Any? ?? NSNull()] + fields
        let fingerprint = digest(try JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys]))
        return try transaction {
            try requireCurrentSchema()
            if let old = try rows(
                "SELECT fingerprint, acknowledgement FROM history_receipt WHERE operation_id=?",
                [write.operationID]
            ).first {
                guard old["fingerprint"] as? String == fingerprint else {
                    throw EZError("This history operation ID was already used for a different change.")
                }
                guard let json = old["acknowledgement"] as? String else {
                    throw EZError("The history acknowledgement is uncertain. Refresh History.")
                }
                return try acknowledgement(json)
            }
            let revision = try perform()
            let json = "{\"value\":null,\"revision\":\(revision)}"
            let result = try acknowledgement(json)
            try execute(
                "INSERT INTO history_receipt(operation_id,fingerprint,acknowledgement) VALUES(?,?,?)",
                [write.operationID, fingerprint, json])
            return result
        }
    }

    private func validateRevision(_ actual: Int64?, _ write: HistoryWrite) throws {
        guard actual == write.expectedRevision else {
            throw EZError("History changed. Reload and try again.")
        }
    }

    private func validateOperationID(_ operationID: String) throws {
        guard !operationID.isEmpty, operationID.utf8.count <= 256, !operationID.contains("\0") else {
            throw EZError("Invalid history operation ID.")
        }
    }

    private struct Receipt: Decodable {
        let revision: Int64
        private enum CodingKeys: String, CodingKey { case value, revision }

        init(from decoder: Decoder) throws {
            let fields = try decoder.container(keyedBy: CodingKeys.self)
            revision = try fields.decode(Int64.self, forKey: .revision)
            guard try fields.decodeNil(forKey: .value), revision >= 0 else {
                throw EZError("Invalid history acknowledgement.")
            }
        }
    }

    private func acknowledgement(_ json: String) throws -> HistoryAcknowledgement {
        guard let body = try? JSONDecoder().decode(Receipt.self, from: Data(json.utf8)) else {
            throw EZError("The history acknowledgement is uncertain. Refresh History.")
        }
        return HistoryAcknowledgement(revision: body.revision)
    }

    private func hasUnfamiliarFields(_ value: Any, comparedTo recognized: Any?) -> Bool {
        if let fields = value as? [String: Any] {
            let known = recognized as? [String: Any] ?? [:]
            return fields.contains { name, field in
                known[name] == nil || hasUnfamiliarFields(field, comparedTo: known[name])
            }
        }
        if let elements = value as? [Any], let known = recognized as? [Any], elements.count == known.count {
            return zip(elements, known).contains { hasUnfamiliarFields($0, comparedTo: $1) }
        }
        return value is [Any] && recognized == nil
    }

    private func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

extension HistoryTarget {
    fileprivate func storage() throws -> (HistoryStore.RecordID, String?) {
        switch self {
        case .record(let record): (record, nil)
        case .entry(let record, let entry):
            switch (record, entry) {
            case (.native(let recordID), .native(let entryID)) where recordID == entryID:
                (record, entryID.uuidString.lowercased())
            case (.browser, .browser(let key)) where !key.isEmpty:
                (record, key)
            default: throw EZError("Invalid history entry identity.")
            }
        }
    }
}
