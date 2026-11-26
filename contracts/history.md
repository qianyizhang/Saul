# Shared history

Saul and EZ store saved work in `~/Library/Application Support/Little Clarity/history.sqlite3`.
[The schema](history.sql) is packaged with both the [Saul Node store](../apps/saul/native/storage/history.mts)
and the [EZ Swift store](../apps/ez/Sources/EZCore/HistoryStore.swift). SQLite
transactions serialize writes; both adapters use owner-only files, a busy
timeout, foreign keys and secure deletion. Loss of the store blocks access.

Both apps can read, search, copy and delete saved passages and native lookups.
Only Saul runs browser work and presents saved summaries. Active execution and
drafts remain app-owned; browser recovery is scoped to the originating profile.
History reloads on focus or activation without periodic polling.
EZ loads list projections in 100-row cursor pages and fetches full saved details
on selection. Search covers all saved query/answer text, not only loaded rows,
and retains localized case-insensitive substring matching. Pagination does not
change frozen Retry/Reuse/Follow-up inputs or saved record identities.

Both Libraries search each visible attempt’s full saved user prompt and answer. A follow-up
can contain a quote from an earlier attempt. That quote is searchable for as long as the
follow-up is visible. Saul also searches the selected text, page title and URL.

## Accepted interface

Schema v5 uses this interface for the shared SQLite store. [Decision and rationale](../docs/adr/0007-history-records-and-entries.md)

A **collection** defines scope and access. A **record** has a stable, opaque identity within that scope.
An **entry** is an independently identifiable contribution to a record. An **event** records a
committed fact about a record or entry. A **view** defines a typed result, order, filters and missing
behavior. One record can participate in several views. Feature owners define meaningful transitions,
view semantics and payload versions. History owns identity, visibility, ordering, consistent reads
and atomic commits. SQLite layout, transport names and image chunking belong to the adapters.

The Saul [operation registry](../apps/saul/shared/protocol/history-protocol.mts)
declares the input, result, reconnect policy and affected record targets. It
rejects unrecognized fields on incoming writes and passes parsed command values,
including defaults, to storage. The Node repository resolves any indirect target
from SQLite within the same transaction. Existing result and stored-row readers
keep their compatibility rules.

A receipt fingerprints the original wire command and owner. An exact valid retry
from an earlier client still matches when the parser supplies a default. A legacy
command containing a field the writer now rejects requires an explicit refresh
to inspect its outcome. The database schema stays at version 5.

| Operation                                               | Observable contract                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list(view, query)`                                     | Return a page of records. Apply access and visibility before search snippets, counts, ordering and pagination. An opaque cursor belongs to its scope, view, filters and visibility.                                                                                                                                                                 |
| `get(record, view, options)`                            | Read one saved record at a revision, with the exact saved input/output appropriate to that view.                                                                                                                                                                                                                                                    |
| `entries(record, view, query)`                          | Return a page of typed entries. Each entry keeps its identity across views and changes of visibility.                                                                                                                                                                                                                                               |
| `attachment(ref, options)`                              | Load bytes on demand under the same scope and visibility as the owning content.                                                                                                                                                                                                                                                                     |
| `writer.commit(record, changes, write)`                 | Check the authorized change and expected revision (or absence for creation). Commit all semantic events, attachment references and derived state together and assign their per-record order. Return an acknowledgement and revision. Snapshots are sufficient for ordinary documents. Partial streams and transfer chunks are private working data. |
| `mask(target, write)`, `restore(target, write)`         | Record reversible deletion and restoration of a record or entry. Restore retains the original identity and posting position.                                                                                                                                                                                                                        |
| `purge(target, write)`, `clear(collectionScope, write)` | Permanently remove retained content in scope, including masked content, search projections and attachment bytes no longer referenced. A late callback cannot resurrect it.                                                                                                                                                                          |

Every mutation has an operation identity. A recognized repeat with identical input resolves to the
original acknowledgement. Conflicting use of that identity fails. A stale revision rejects the whole
change. A malformed or lost acknowledgement leaves the outcome uncertain. Refresh or inspect the
receipt before further action. Destructive writes never replay automatically. Operational
deduplication may retain payload-free identities. [Bounded recovery](../docs/adr/0006-bound-local-recovery.md)

Reads default to `visible`. Authorized callers may request `masked` or `all`. The latter labels
masked entries. A parent mask hides its children by default. Restoring a parent respects individual
child masks. Masked items are excluded from automatic reuse. Restore never runs a provider.

## Deletion and retention

- **Delete** masks a record or entry. Each collection owns its retention setting. Library, Call runs
  and annotations use **365 days from masking**. At expiry the item is no longer restorable and
  cleanup purges it. Both apps expose **Recently deleted** for shared Library records.
- **Active work** must stop before deletion. The owning feature can offer **Stop and delete** and
  wait for settlement. When the other app owns the work, identify it. Apply the guard atomically
  to the affected scope so a concurrent admission cannot invalidate the decision.
- **Delete permanently** purges immediately. **Clear History** permanently clears its named scope.
  Clearing the shared Library covers browser passages and native lookups. Call runs and annotations
  have independent scopes.

## Feature responsibilities

- The Library can open a saved record by marking the exact displayed completed run viewed and
  loading attempts. A newer completed run stays unread. Reading owns admission, active execution,
  cancellation and live overlays. Frozen input remains available for supported Retry/Reuse paths.
- A fresh Call run has one identity and ordered page items, including single-page runs. Shared
  configuration belongs to the parent. Per-page progress belongs to the item. Calls owns reuse
  and retry eligibility. Legacy wire/table names are private adapter details.
- An annotation has one logical entry per human reply or generated attempt. A completed attempt
  supplies the posted reply exactly once. Failed attempts appear in activity history. Conversation
  order is the commit order of posting. An earlier start time does not move a later reply forward.
- Views and payloads can evolve independently of tables. Specify missing values for optional fields.
  Version breaking changes. Older writers must preserve unfamiliar fields or reject the write.
  Both runtimes reject unknown newer database versions.

## Personal-data cutover

Upgrade Saul, its history helper and EZ together. From the current shared SQLite schema, do one
transactional, best-effort conversion. Carry forward readily mappable records, IDs, timestamps,
attachments and reply order. Coalesce replies with attempts only on a proven identity. Import a
known final state without inventing prior events. Unmappable or ambiguous legacy data may be
dropped. An I/O or transaction failure rolls back the conversion. Use the database schema version
to distinguish a completed cutover on reopen.

Fold browser `bookmark.created_at` into nullable `selection.bookmarked_at`. Repeated bookmarking
preserves the original timestamp. Retire `interaction` and its old rows. Retire OPFS and JSONL
history imports, `history_migration`, and their compatibility-only messages and fixtures at the
cutover. Older standalone sources fall outside this conversion. Carry forward the browser profile
identity used for ownership even after removing the import handshake. This cutoff applies only
to history data. Settings, credentials and installation identities have separate contracts.

## Acceptance

Run shared fixtures through the Node and Swift production adapters where both support the view,
and feature fixtures through their owning interface. Verify ordered replies mixed with failed
attempts, concurrency and uncertain acknowledgements, visible/masked reads and attachments,
Recently deleted on both surfaces, 365-day expiry, stop-before-delete, scoped purge/clear, masked
reuse exclusion, and a lightweight cutover that reopens without legacy import state. Exercise
old rows missing a newly added field. Preserve the search, paging, frozen-input and reopen
guarantees described above. [History fixtures](fixtures/history.json) ·
[Attempt fixtures](fixtures/attempts.json) · [Execution contract](actions-and-attempts.md#execution)
