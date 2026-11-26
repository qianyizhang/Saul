# Coordinate work using a shared connection

Accepted 2026-11-27. Implemented across the signed owner, settings writers and app coordinators.

Saul and EZ can use one credential concurrently. Setup writes the credential
before saving its public connection definition. A settings revision alone
cannot detect a key replacement between two requests in an active batch.

Reserve setup by binding and issue a token for that reservation. The signed
owner checks it before a credential change. Each settings writer checks it
inside its own transaction before replacing the settings document. A live
process hold distinguishes active setup from an abandoned reservation. This
lets another app explicitly release abandoned setup while an old continuation
remains unable to write. Public recovery details stay with the initiating app.

Concurrent model readers can share a binding. A batch keeps its hold across
requests and uses the credential generation observed at first use. The existing
Stop command and an immediate busy result let the user choose when to change
the credential. A dedicated cancellation prompt is deferred.

This extends the [bounded recovery decision](0006-bound-local-recovery.md)
for opted-in shared connections. The [credential contract](../../contracts/credentials.md#shared-connection-setup-and-execution)
owns recovery, cancellation and mixed-version guarantees. [Saul's connection service](../../apps/saul/docs/architecture.md#configuration-and-surfaces)
describes the browser view lifetime.
