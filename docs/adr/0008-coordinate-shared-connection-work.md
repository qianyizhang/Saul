# Coordinate work using a shared connection

Accepted 2026-11-27. This decision describes the target for the consolidation.

Saul and EZ can use the same credential. Setup writes the credential before it
saves the public connection definition. A settings revision check alone cannot
protect an active generation or distinguish two replacements for the same key.

- Reserve setup per shared connection. Identify the originating app. Its own
  durable record carries the public recovery details. Competing setup for that
  connection reports the owner. Other connections remain independently usable.
- If the origin disappears, the other app can explicitly release the reservation
  once active work has stopped. Release preserves credentials and definitions.
  An old operation cannot write either resource after release.
- Admit concurrent model runs on the same credential. Reject a conflicting
  credential change immediately. A running batch retains protection from first
  credential use through completion or Stop, including gaps between requests.
  A setup admitted first blocks conflicting calls before transmission.
- Use a simple busy message and the existing Stop action. A dedicated cancel
  prompt is deferred. Check helper capability before a protected change. Older
  helpers require an update. Verify the compatibility limit of old batch clients
  separately since they do not announce a batch lifetime.
- Closing Saul Settings cancels an interactive sign-in awaiting approval. After
  credential acknowledgement, the coordinator can finish the reviewed save with
  the panel closed. After an uncertain effect, keep recovery available and
  require review.
- Save the reviewed connection against the latest saved document. Verify the
  previous definition and save using the freshly read revision. Preserve other
  settings and unsaved editor drafts. A changed binding or unknown outcome
  requires review.

The signed owner remains the authority for shared secrets. Local browser API
routes retain their existing owner. Each application retains its configuration
writer. Cross-process exclusion needs evidence at credential admission and at
the actual settings write. UI flags alone cannot establish either guarantee.

This narrowly extends the [bounded recovery decision](0006-bound-local-recovery.md)
for opted-in shared connections. Its ordinary revision-conflict and uncertain
write rules continue to apply.
