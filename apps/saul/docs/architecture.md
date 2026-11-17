# Architecture

Saul is a Chrome MV3 extension. Follow the [lifecycle rule](../../../docs/architecture.md#lifecycle-ownership)
when moving state or effects. [Product behavior](product.md) and the feature guides
describe what users can do.

## Runtime map

| Context            | Entry point                                   | Responsibility                                                                       |
| ------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------ |
| Content script     | [Content](../entrypoints/content.tsx)         | Capture the main-frame selection, render the shadow-root UI and restore markers.     |
| Service worker     | [Background](../entrypoints/background.ts)    | Validate callers; route reading and settings, badge, notification and native access. |
| Offscreen document | [Offscreen](../entrypoints/offscreen/main.ts) | Run reading, Calls and annotation replies independently of views.                    |
| Native helper      | [History](../native/history.mts)              | Access SQLite through native messaging; OPFS is migration input only.                |

## Trust boundaries

Content messages are scoped to the sender's current main-frame HTTP(S) page;
the popup/workspace can request global history, settings and tab operations.
The trusted background admits offscreen and database work; offscreen reports
state back to it. Runtime messages do not return to their sender. Existence
checks and offscreen creation share a lock while listeners become ready.
Content receives action names and safe choices, never storage or credentials.

| Feature boundary                             | Owner                                                                                                                                                                                                |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reading                                      | [Admission](../src/reading/admission.ts), [configuration](../src/reading/configuration.ts) and [runner](../src/reading/runner.ts)                                                                    |
| Configuration                                | [Definition](../src/configuration/definition.ts), [inspection](../src/configuration/inspect.ts), [execution resolution](../src/configuration/resolve.ts), and [store](../src/configuration/store.ts) |
| Providers                                    | [Requests](../src/providers/request.ts), [model stream](../src/providers/stream.ts) and shared bounded [SSE framing](../native/sse.mts)                                                              |
| Call selection, capture, execution and saves | [Calls and summaries](calls.md#runtime-owners)                                                                                                                                                       |
| Annotation captures, revisions and replies   | [Annotations](annotations.md#interface-and-ownership)                                                                                                                                                |
| Optional native access and tab board         | [Native messaging](native-messaging.md) and [MCP board](mcp-app.md#implementation-and-verification)                                                                                                  |
| Plan credentials and Speak                   | [Plan and Speech guide](chatgpt-plan.md); [shared macOS owner](../../../contracts/credentials.md)                                                                                                    |

## Reading and persistence

A submitted action freezes context, choices and rendered prompts. Retry
resolves only its original credential route; a changed owner or endpoint
requires a new attempt. Credentials stay transient and origin-bound; the
plan snapshot retains the non-secret registration ID. Admission and streaming
interpret saved choices through one [route decoder](../src/providers/request.ts).
A signed plan keeps its account and binding; a managed API request keeps its
connection and endpoint; a browser API request keeps its profile and endpoint.
The original signed account-only Summary and official API routes remain
available to their own saved requests. Contradictory route data cannot send.
Inspection projects saved
instruction, context and prompt fields, not credentials, account identifiers or
raw HTTP/SSE traffic.

The runner owns the queue, up to two concurrent jobs, cancellation, restart
reconciliation and database checkpoints. Text checkpoints flush within 500 ms
even after a silent stream. Transient activity is separate from persisted run
status; explicit reasoning-item events can show thinking without exposing
reasoning payloads. Answer/refusal text ends the indicator. See the [attempt
contract](../../../contracts/actions-and-attempts.md#execution) for completion and
save failure.

Draw freezes the chosen PNG/GIF format and sends one Images request. The
credential boundary accepts bounded generation without input images or arbitrary
URLs. The runner bounds results to 20 MB decoded and 4,096 pixels per edge,
then saves idempotent 200,000-character base64 chunks at explicit offsets.
A complete image is required before success. Lists fetch metadata; byte reads
are on demand. Deletion invalidates late writes and cascades saved output.

### Persistence and anchors

[History](../../../contracts/history.md) uses the [native operation catalogue](../native/history-protocol.mts)
for admission and reconnect. Eligible reads and repeatable writes try at most
three connections with the same identity. Delete, Clear, Bookmark, migration
transfers and unknown operations do not reconnect automatically. Request IDs
live with run or submission rows; helper loss has no local fallback.

Reuse resolves in SQLite before credentials, including deleted-submission
tombstones. Anchors use exact URL, quote context and offsets. Changed context may
match only with the same text and offsets plus matching DOM location or unchanged
leading context. Ambiguous or missing text remains available without a marker.
Native CSS highlights do not wrap page text.

## Configuration and surfaces

Inspection returns unavailable choices without mutation; resolution admits
execution and returns frozen choices with a separate transient credential.
[Settings editor](../src/settings/editor.ts) owns each draft/baseline/review
session. [React adapter](../src/app/useSettingsEditor.ts) owns lifetime, unload
warnings and confirmation; stale callbacks cannot replace a newer session.

The background checks an opaque local fingerprint and serializes credential
preparation, shared commit and local commit in that order. These
are separate effects: after uncertainty or partial success, Review latest reads
the current state before another explicit Save. See [Settings behavior](product.md#settings-and-models)
and [shared revision rules](../../../contracts/configuration.md#unified-configuration-scopes).
Ordinary reads do not rewrite local records; initial shared adoption may allocate
IDs and revisions. Provider tests use the current draft without replacing unreadable settings. Only absence seeds defaults. Invalid, obsolete or pre-Action
records are preserved for explicit backed-up reset. Credential adapters do
not own Chrome storage; route lookup reads mode without upgrading configuration.

Popup and workspace share app views; History and the explanation card share
past-attempt rendering. Settings sections stay mounted, preserving search
and stoppable provider tests; leaving Presets unmounts the speech preview.
Presentation and notification preferences are separate from provider drafts.
Min Mode can change despite an unreadable configuration; subscribers receive
only the validated appearance boolean. [Design application](../../../design/SKILL.md)
owns shared tokens, checked output and platform adaptation.
