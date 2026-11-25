# Expose History through records, entries and views

Accepted 2026-11-25. Implementation pending.

Saul’s native history catalogue exposes 37 operations spanning saved work, execution transitions,
annotations and Call batches. EZ accesses the same database in Swift. Many wire operations reuse
a payload shape but have different effects or retry rules. Exposing those names ties clients to a
specific runtime and makes database layout changes unnecessarily expensive.

Adopt a common History interface over the existing native adapters. Give features ownership of
their transitions and typed views. Give History ownership of atomic commits, ordering, visibility
and retention. Use events for meaningful changes and keep transfer and streaming mechanics private.
This lets one generated response supply both an activity entry and a posted reply. A schema change
can add a searchable field without changing how callers open records.

The data is small and personal. A long recovery window is affordable. A one-time, lossy upgrade
is acceptable, avoiding permanent support for obsolete import sources. The [living contract](../../contracts/history.md)
owns the precise guarantees and cutoff. This extends the [shared SQLite decision](0001-share-local-history.md)
and retains [bounded local recovery](0006-bound-local-recovery.md).
