# Settle attempts through one asynchronous history writer

Accepted 2026-11-17.

SQLite can wait seconds for another writer. Opening and migrating history,
writing attempts, or deleting results must not hold the app's main actor.
Route writes through one serial native writer. The attempt still owns the
decision to send, the terminal outcome, and the acknowledgment of saved success.

Stop during the initial write prevents provider transmission. Once an attempt
begins its terminal write, finish that outcome without starting a competing
cancellation write. On normal Quit, wait briefly for the same owner to settle.
A deadline or forced exit can leave the pending record for the next launch to
mark interrupted. This avoids an unbounded Quit, a background service, and
replaying inference after an uncertain save.

The [EZ persistence contract](../architecture.md#persistence-contract) owns the
current timing and user-visible behavior.
