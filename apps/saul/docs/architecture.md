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
| Native helper      | [History](../native/storage/history.mts)      | Access the shared SQLite History store through native messaging.                     |

### Source and build ownership

[Shared protocols](../shared/protocol) and [pure models](../shared/model) run
without Chrome or Node globals. The [Node storage owner](../native/storage)
implements SQLite history, annotations, Call persistence, settings and presets.
The [entrypoints](../native/hosts) bind those services to native messaging.
The [Tab Board](../board) runs in a browser, with its own compiler project.
[Browser presentation helpers](../browser) can be used by both the extension and
board. Shared modules cannot import either browser implementation or use
host-only globals, including through `globalThis`. Shared imports are static so
lint can enforce their ownership. Each environment also has a separate TypeScript
check; shared code retains DOM typings for portable Web APIs such as `URL` and
`TextEncoder`, while lint rejects browser-only globals.

Background settings and offscreen history use the same
[framing and request correlation](../src/native/storage-connection.ts). Settings
use a native connection directly from the background. Offscreen accesses history
through a [history-only port](../src/native/storage-bridge.ts) that rejects workspace and content senders. The [signed credential client](../src/native/credentials.ts)
has its own protocol and never carries storage operations. Provider adapters
select the signed route or a browser-owned API route from the saved request.

The [component inventory](../native/installation/components.mts) maps source
entrypoints to the installed names and drives packaging and verification. See
the [artifact decision](../../../docs/adr/0005-separate-saul-helper-source-from-installed-artifacts.md).

The [tool operation registry](../shared/protocol/protocol.mts) owns each tab/page
tool's argument schema, result schema and catalog metadata. TypeScript types,
CLI names and advertised schemas derive from that registry. Results retain extra
browser metadata after validation; annotation results also match the requested
operation. Workspace and diagnostic operations use their own typed registries
and the same schema library, without a second JSON-schema interpreter.

The [local tool dispatcher](../src/native/local-tool-call.ts) checks the profile’s
[Local tool permissions](native-messaging.md#local-tool-permissions) after a
request reaches the tab operation queue. The bridge owns connection and retry.
The extension’s own Window view uses the same tab operations through its trusted
workspace route.

## Trust boundaries

Content messages are scoped to the sender's current main-frame HTTP(S) page;
the popup/workspace can request global history, settings and tab operations.
The trusted background admits offscreen and database work; offscreen reports
state back to it. Runtime messages do not return to their sender.
[Sender checks](../src/platform/chrome/sender.ts) authenticate extension views
and current main-frame routes. [Offscreen creation](../src/platform/chrome/offscreen.ts)
locks the existence check and creation together. Feature clients own typed
requests; [Chrome messaging](../src/platform/chrome/messages.ts) unwraps replies.
Content receives action names and safe choices, never storage or credentials.

| Feature boundary                             | Owner                                                                                                                                                                                                |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reading                                      | [Admission](../src/reading/admission.ts), [configuration](../src/reading/configuration.ts) and [runner](../src/reading/runner.ts)                                                                    |
| Configuration                                | [Definition](../src/configuration/definition.ts), [inspection](../src/configuration/inspect.ts), [execution resolution](../src/configuration/resolve.ts), and [store](../src/configuration/store.ts) |
| Providers                                    | [Requests](../shared/model/execution-route.ts), [model stream](../src/providers/stream.ts) and shared bounded [SSE framing](../shared/protocol/sse.mts)                                              |
| Call selection, capture, execution and saves | [Calls and summaries](calls.md#runtime-owners)                                                                                                                                                       |
| Annotation captures, revisions and replies   | [Annotations](annotations.md#interface-and-ownership)                                                                                                                                                |
| ChatGPT browser handoffs                     | [Deep dive background worker](../src/deep-dives/background.ts). Saved links and instructions belong to the originating Chrome profile. Temporary tab bindings live for the browser session.          |
| Optional native access and tab board         | [Native messaging](native-messaging.md) and [MCP board](mcp-app.md#implementation-and-verification)                                                                                                  |
| Plan credentials and Speak                   | [Plan and Speech guide](chatgpt-plan.md); [shared macOS owner](../../../contracts/credentials.md)                                                                                                    |

## Reading and persistence

A submitted action freezes context, choices and rendered prompts. Retry
resolves only its original credential route; a changed owner or endpoint
requires a new attempt. Credentials stay transient and origin-bound; the
plan snapshot retains the non-secret registration ID. Admission and streaming
interpret saved choices through one [route decoder](../shared/model/execution-route.ts).
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

[History](../../../contracts/history.md) uses the [native operation catalogue](../shared/protocol/history-protocol.mts)
for admission and reconnect. Eligible reads and repeatable writes try at most
three connections with the same identity. Destructive changes and Bookmark require explicit recovery after a lost reply.
The shared store binds each write identity to its input and acknowledgement.

The [Reading history schemas](../shared/protocol/reading-history.mts) check
submit, claim, checkpoint, saving and finish payloads before SQLite applies them.
The browser checks the matching acknowledgements before using them. A malformed
acknowledgement leaves the write unconfirmed and does not trigger reconnect.

Reuse resolves in SQLite before credentials, including deleted-submission
tombstones. Anchors use exact URL, quote context and offsets. Changed context may
match only with the same text and offsets plus matching DOM location or unchanged
leading context. Ambiguous or missing text remains available without a marker.
Native CSS highlights do not wrap page text. The [content session](../src/reading/content-session.ts)
owns route identity, passage reads, markers and port reconnection. Navigation
detaches the old view from accepted work; late replies cannot reopen it on
another route.

## Configuration and surfaces

Inspection returns unavailable choices without mutation; resolution admits
execution and returns frozen choices with a separate transient credential.
[Settings editor](../src/settings/editor.ts) owns each draft/baseline/review
session. [React adapter](../src/settings/ui/useSettingsEditor.ts) owns lifetime, unload
warnings and confirmation; stale callbacks cannot replace a newer session.

Managed Connections owns sign-in, credential changes and [restartable setup](../src/settings/connection-setup.ts).
The Settings editor commits against a settings revision. Each explicit continuation
checks the pending action, credential availability and current public definition.
The shared [credential contract](../../../contracts/credentials.md#connection-identity-and-catalogs)
defines what the browser can retain.

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
