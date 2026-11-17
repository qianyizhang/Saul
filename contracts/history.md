# Shared history

Saul and EZ store saved work in `~/Library/Application Support/Little Clarity/history.sqlite3`.
[The schema](history.sql) is packaged with both the [Saul Node store](../apps/saul/native/history.mts)
and the [EZ Swift store](../apps/ez/Sources/EZCore/HistoryStore.swift). SQLite
transactions serialize writes; both adapters use owner-only files, a busy
timeout, foreign keys and secure deletion. Loss of the store blocks access.

Both apps can read, search, copy and delete saved passages and native lookups.
Only Saul runs browser work and presents saved summaries. Active execution and
drafts remain app-owned; browser recovery is scoped to the originating profile.
History reloads on focus or activation without periodic polling.

| Operation             | Guarantee                                                                                                                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read                  | Return literal saved input and output, including Unicode, without inference.                                                                                                                                                        |
| Save a frozen attempt | Repeating the same terminal save retains one record with the original input/output. Claim saved success after storage acknowledges it.                                                                                              |
| Delete                | Refuse deletion while the other app owns an active attempt. A successful delete survives reopen and invalidates live state for the attempt.                                                                                         |
| Open                  | Reject unknown newer schemas and preserve the data. Upgrades are transactional; downgrades are unsupported.                                                                                                                         |
| Import legacy history | Validate records and attachments; commit a durable import marker before removing the old data. Invalid or conflicting input blocks import and preserves the source. Interrupted cleanup never reimports or resurrects deleted rows. |

Legacy files are migration inputs only. See [setup](../docs/setup.md#shared-history-upgrade)
for recovery.

[History fixtures](fixtures/history.json) exercise both production stores.
[Attempt fixtures](fixtures/attempts.json) cover save failure and no inference
replay. The [Attempt contract](actions-and-attempts.md#execution) defines failed saves and
explicit retry; the [Saul persistence boundary](../apps/saul/docs/architecture.md#persistence-and-anchors)
owns reconnect. Storage idempotency does not authorize replaying a deleted attempt.

See [ADR 0001](../docs/adr/0001-share-local-history.md) for why the database is shared.
