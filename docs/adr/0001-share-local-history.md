# Share one local history store

Accepted 2026-11-04; implemented in `7ea6793`.

Saul's browser OPFS history and EZ's JSONL history were isolated. Use one local
SQLite database so either app can read and delete saved work, with one transaction
boundary for frozen results, attachments and deletions. Retaining per-app stores
would require synchronizing copies and deletions. SQLite also lets EZ access the
same data directly in Swift while Saul reuses its existing helper, without making
either app run the other or introducing a sync service.

The [history contract](../../contracts/history.md) owns current guarantees.
