# Bound local recovery

Accepted 2026-11-17.

Saul and EZ are personal apps on one machine. Use local transactions, revision
checks and one owner for each operation. Fix ordinary failures that lose a
draft, misreport success, block a normal action, or leave a surface stuck.
Prefer a clear error and a user action for recovery when the app cannot verify
what happened. A simple local model is easier to use, change and diagnose than
a system that tries to stay available through every failure.

- **Simultaneous writes:** Let the existing transaction or revision check
  decide. Surface a conflict and let the user review or refresh. No timing
  guarantee, distributed lock, or automatic merge.
- **Unknown write outcome:** Keep the existing save and idempotency rules.
  Reopen or refresh to inspect state. Do not replay automatically.
- **Persistent SQLite failure:** Report the error and preserve the original
  data. Leave repair or restoration to the user. No alternate history store.
- **Unusually large history:** Keep the simple query and current search
  semantics until a representative workload shows a delay worth addressing.

The [history](../../contracts/history.md) and
[attempt](../../contracts/actions-and-attempts.md#execution) contracts still
own the guarantees. These limits do not excuse a routine action that gets
stuck or a missing acknowledgment that appears as saved success.
