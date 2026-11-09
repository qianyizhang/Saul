# Architecture

Saul is a Chrome MV3 extension with four runtime contexts. State crosses contexts only through validated messages or the native-messaging protocol.

## Runtime map

| Context            | Entry point                     | Responsibility                                                                                                |
| ------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Content script     | `entrypoints/content.tsx`       | Capture selections, render the shadow-DOM reading UI, restore page markers                                    |
| Service worker     | `entrypoints/background.ts`     | Validate callers, route reading/workspace requests, manage settings, badges, notifications, and native access |
| Offscreen document | `entrypoints/offscreen/main.ts` | Own durable reading and summary jobs                                                                          |
| Shared history     | `native/history.mts`            | SQLite through the native helper; OPFS is read only during one-time migration                                 |

The popup and full workspace reuse the application views under `src/app/`. The full workspace owns global history, export, deletion, settings, and tab organization.

Presentation preferences are separate from provider drafts. `src/storage/presentation.ts`
owns the default-on Min Mode value in trusted extension storage. Popup and
workspace listeners share changes immediately; the background broadcasts only the
boolean presentation value over the existing validated reading subscription. Content
scripts do not gain direct storage or credential access. Provider validation or an
unreadable provider record does not prevent changing presentation.

## Reading flow

```text
page selection
  -> content script captures text, context, and anchor
  -> background validates the source page and freezes settings
  -> offscreen runner queues and streams generation
  -> native history helper checkpoints and commits the attempt
  -> background updates page subscribers and the unread badge
  -> content script restores the marker and opens results on request
```

`src/reading/runner.ts` owns queueing, cancellation, checkpoints, completion classification, and restart reconciliation. Providers allow two concurrent jobs. Jobs are never replayed automatically after uncertain runner/browser loss.

An answer is ready only after a provider completion signal, readable output, and a successful database commit. Interrupted, stopped, provider-error, and save-error states retain honest status and available partial text.

Streaming checkpoints flush within 500 ms even when the provider becomes silent
after a burst. The runner exposes transient connecting/waiting/thinking/generating
activity separately from saved run status. Thinking requires an explicit provider
reasoning-item event; only its activity signal is forwarded, never reasoning text.
Answer or refusal text stops the light, and completion still requires the terminal
provider event followed by a successful save.

## Illustrate

A Draw reading action uses an explicit OpenAI API preset. New installations include
Illustrate; existing action libraries can add it from Settings → Actions. The
selection widget offers PNG/GIF before the explicit Illustrate click. The runner
freezes format in the preset snapshot and makes one Images generation request;
ChatGPT-plan and custom endpoints cannot receive this operation. GIF requires a
2.6 image model. Preset editing retains older models without silently replacing them.

The signed credential owner admits bounded `api-image` generation without image
attachments or arbitrary URLs. Local API connections use the same request shape.
The response is bounded to 20 MB of decoded image data and 4,096 pixels per edge.
The runner saves 200,000-character base64 chunks into the existing SQLite
`response_structured` field. Offsets make acknowledgement replay idempotent;
completion requires a complete image. Passage/history lists return metadata only;
image bytes load for a selected attempt. A failed save retains exact bytes in the
current runner for Download and Retry saving image, with no inference replay.
Closing/restarting the runner loses unsaved in-memory output. Deletion makes late
writes inert and removes saved output through the existing foreign-key cascade.

## Persistence and anchors

- SQLite runs in the native helper at the [shared history path](../../../docs/architecture.md#shared-history). The offscreen runner uses validated native operations; helper loss fails visibly without local or in-memory fallback.
- Schema changes are forward-only, versioned, and transactional. Unknown future schema versions are rejected; downgrades are unsupported.
- Custom/standalone API keys remain in trusted extension storage or runner memory. In shared macOS mode, official OpenAI keys and ChatGPT tokens remain exclusively in the signed Saul native owner. They are excluded from page messages, stored run inputs, and exports.
- A saved passage uses URL identity, quote context, and captured text offsets to restore one exact occurrence. Legacy metadata may remain stored but does not authorize a match.
- Native CSS Custom Highlights mark exact, unambiguous occurrences without wrapping or replacing page text.
- Missing or ambiguous passages remain accessible from the page list and library with location unavailable.

Reading reuse resolves in SQLite before credentials are required. It preserves the
submission ledger, including deleted-submission tombstones. Exact anchors remain
the primary identity; a changed surrounding context may match only with the same
selected text and offsets plus a matching DOM location or unchanged leading
context. Equal words at separate offsets do not share an answer. The reuse review
compares the displayed attempt's saved prompt, context, instructions and model
choices against prepared current input, without credential validation or inference.
Explicit current-input runs retain the previous attempt; ordinary Regenerate keeps
the frozen request.

## Trust boundaries

Validators in `src/contracts/` restrict operations by sender:

| Sender                     | Allowed scope                                                            |
| -------------------------- | ------------------------------------------------------------------------ |
| Source page content script | Reading operations for its current main-frame HTTP(S) URL                |
| Popup or library workspace | Global history, export, deletion, settings, and tab workspace operations |
| Background service worker  | Offscreen runner and database operations                                 |
| Offscreen document         | Reading-state events back to the background                              |

Runtime messages do not return to their sender. Content and popup requests therefore route through the background; background requests target the offscreen document directly. Offscreen existence checks and creation share one lock because Chrome can report a document before its listeners are ready.

## Model boundary

`src/models/provider.ts` is the streaming facade used by the reading runner and generation tests. It dispatches to OpenAI-compatible or ChatGPT plan adapters and returns the same delta/completion events. Both HTTP adapters reuse `native/sse.mts` for bounded SSE framing across UTF-8 chunks, CRLF/LF separators, multiline `data:` fields, provider errors, cancellation, and incomplete output. Chrome on-device AI is retired. Legacy saved selections and frozen requests remain readable but reject execution with an explicit provider-choice message; no model preparation or local streaming implementation remains.

Prompts and context are frozen when a job is submitted. Later settings edits do not change an in-flight job. API credentials are associated with their endpoint origin and are not persisted with job inputs. Saved connection IDs remain in frozen preset inputs. ChatGPT plan jobs freeze a non-secret account registration ID and model; OAuth credentials stay in the native helper.

Reading results project only saved instruction text, user prompt and context fields
into `inspection`. Connection settings and account identifiers are excluded. The
shared input/output inspector renders literal text from the selected attempt in
the page card and History, including partial output; it does not reconstruct prompts
from current settings or claim to retain raw HTTP/SSE traffic.

`src/models/configuration.ts` owns named actions (stored as `recipes`) and model presets in settings.
`src/models/preset-resolution.ts` owns execution-time Capability checks, explicit
Connection selection and frozen credential routes for Reading, custom Summarize,
provider tests and Speak. Editor projection retains unavailable choices separately.
Retries never promote a local credential route to Saul: a changed owner or endpoint
shows a preset-selection hint and requires a new attempt. Plan execution checks
the frozen owner again immediately before opening its transport.
Legacy settings migrate to an Explain action and a Current preset; prompt roles,
the active connection, and the selected model are preserved. Actions contain
literal prompt templates and reference a default preset. Presets identify a
connection, capability, model and options; they contain no keys. Managed ChatGPT
connections pin one account. Standalone installations retain an app-owned account
and API profile binding until explicitly connected to the shared credential owner.
The existing model controls edit the selected preset, so there is one authority
for each model choice.

`src/models/settings-draft.ts` owns action, preset and profile editing transitions,
including connection-key clearing and the persisted projections. Settings views
hold independent drafts and submit through `saul-settings`; the trusted background
owns one serialized read/commit/recovery lane in `src/storage/settings.ts`.
A commit compares the loaded raw record's opaque fingerprint before writing.
The Chrome record uses an opaque fingerprint; shared sections have numeric
revisions. Initial shared-settings adoption may persist migration IDs/revisions
during a read. A one-time connection-name upgrade also writes canonical fields;
unchanged reads do not rewrite the Chrome record.
The native configuration owner checks shared and scoped revisions under one
cross-process lease and commits both sections in one JSON replacement. The
[shared contract](../../../contracts/README.md#unified-configuration-scopes) owns
the lock, failure and upgrade rules.
A stale Save preserves all draft fields and selections and blocks another Save
until explicit reload; discarding a dirty draft for reload requires confirmation.
An uncertain response also preserves the draft without replaying the write.
Presentation and notification preferences use separate keys and do not cause
configuration conflicts. Invalid-record backup/reset uses the same commit lane.

Content scripts receive action names and safe choice summaries, then submit only
the action ID with captured context. `src/reading/configuration.ts` resolves the
saved action/preset in the background and freezes both with the rendered prompts
in `input_json`. Retry uses the frozen request, resolving credentials only for its
original connection; missing connections and changed endpoints block explicitly.
Choosing another action for the same passage creates a new attempt. It cannot
replace an active attempt. Historic rows remain readable without action snapshots.

The [ChatGPT plan helper](chatgpt-plan.md) uses a separate native host, `com.saul.chatgpt`, and a shared allowlisted protocol. The background validates extension-port senders and brokers requests from Settings and the offscreen runner. The native helper owns loopback OAuth, JWT verification, private credential persistence, serialized refresh, and the constrained Responses/SSE transport. It is independent of the tab bridge.

## Tab boundary

User-facing **Window** and **Tab board** names follow the [glossary](../GLOSSARY.md).
Internal `workspace` names cover different scopes: `src/app/Workspace.tsx` is the
extension shell, `src/contracts/workspace.ts` validates history operations, and
`native/workspace.mts` owns tab-board state and proposals. These are not one domain
entity. Existing `saul_workspace_*` tool names remain protocol identifiers.

The extension tab workspace calls `src/native/tabs.ts` directly. Optional external access follows this path:

```text
CLI or MCP -> private Unix socket -> native host -> Chrome native messaging -> tab tools
```

`native/protocol.mts` is the runtime schema shared by the extension, CLI, and MCP server. Public CLI mutation tools preview by default. Internal transport commands support direct user edits; both paths validate current browser state, serialize inside the extension, and never retry automatically after an uncertain error. Incognito and non-normal windows are excluded. `src/native/pages.ts` handles separately opted-in page reads and actions through Chrome scripting in the isolated world; short-lived element references are tied to the read's document. MCP health/discovery bypasses the browser request queue.

The board service in `native/board-service.mts` owns one MCP/standalone operation registry and metadata-only diagnostic file store. `native/board-web.mts` provides the opt-in loopback HTTP adapter, with same-origin and per-process bearer-token gates. The browser uses the same board and workspace rules in both modes; native modules still require only Node.

The [MCP App](mcp-app.md) serves a self-contained board from `native/ui/`. Codex reorganization requests and window renames feed `native/workspace.mts` proposals; manual tab and group edits use the direct interaction boundary below. The service validates complete layouts, issues expiring approval tokens to the app, and verifies each browser move, duplicate closure and label update after the user clicks Apply. Shared window labels belong to trusted extension session storage (`src/native/window-labels.ts`), and are included in tab inventories for both surfaces. On macOS Google Chrome, `native/window-names.mts` targets the connected browser PID through the AppleScript `givenName` interface: inventory reads import names, and reviewed writes validate window/tab IDs and the expected name, then read back the result. The extension API itself has no native name field. Legacy helper-only labels import on a reviewed apply. Duplicate detection uses exact HTTP(S) URLs; closures retain pins/groups and revalidate the URL and keeper at the extension boundary. `native/app-protocol.mts` owns app-only schemas and gates direct actions with a private interaction token.

The shared native protocol distinguishes public model/CLI tools from internal
transport commands. Direct tab edits and Undo live in
`src/native/interaction.ts`, inside the existing mutation lock. Organization
identity ignores focus and navigation; Undo validates only affected windows.
Both extension and MCP selection controls use this boundary.

MCP manual operations require an expiring interaction token returned only in
tool-result metadata. They are app-only, distinct from proposal approval tokens.
The MCP dispatcher rejects unadvertised transport commands. Summarize opens a
Chrome reader; source text and credentials never traverse the board. The reader
then uses the existing trusted extension digest boundary.

## Summary ownership

The optional [custom action](custom-actions.md) replaces one Summarize slot.
`src/actions/manager.ts` owns builder/selection transitions in the offscreen runtime;
trusted background messages own storage access because offscreen Chrome exposes
runtime only. `src/actions/run.ts` brokers model calls through existing provider
and credential owners. `native/action-host.mts` is the independently installed
`com.saul.actions` host. Its store stages without evaluation; explicit Load
initializes a revision worker, and the selected revision changes only after a
successful export check and selection save. Digest jobs retain frozen action
source/preset, model-call inspection, cancellation and persistence. Reuse includes
revision and preset identity. The built-in path and both PDF capture paths remain
available without the action host. Detailed lifecycle, budgets and retention live
in the action contract above.

**Summary** is the user-facing term. `digest` remains the implementation name in
`src/digest/`, internal messages and persisted SQLite records; it does not name a
separate feature. Wire and storage renames require explicit migrations.

`src/digest/` owns the built-in bilingual summary contract, capture, runner, persistence operations, and safe standalone HTML renderer. The workspace sends validated digest actions through the background; only the background snapshots selected tabs, and only the offscreen runner can request page captures. Content scripts cannot start or inspect digests. HTML capture uses isolated-world scripting and validates the original URL before and after reading.

PDF preparation splits browser authority from two processing implementations.
`capture.ts` checks the selected HTTP(S) tab and identifies PDF pathnames or
top-level viewer metadata. `source.ts` runs in the existing offscreen document and
chooses the batch's frozen `pdfProcessing` preference. New batches default to
`attachment`; a missing preference on an old batch means `local`. Settings owns
the saved default; snapshots freeze it before work begins. Content is a union of
legacy-compatible text captures and PDF URL attachments, persisted in existing
JSON source rows without a database schema change.

Attachment mode validates the URL, removes the viewer fragment, revalidates the
tab and saves the exact URL. It never fetches or stores PDF bytes. The digest's
single request assembler supplies a text message plus a typed attachment. The
native `PlanRequest` allowlist accepts at most one bounded HTTP(S) PDF URL, with no
URL userinfo, arbitrary content parts, bytes, credentials or caller-supplied
endpoint. `responsesBody` maps it to `input_file.file_url` alongside `input_text`;
text-only callers keep their existing request shape. The helper uses the same
OAuth owner and Responses route, never the unsupported Files upload route. Model
or URL rejection remains an explicit provider failure with no processing fallback.
Saved URLs freeze request identity, not document bytes; reuse/inspection compare
metadata without asserting text equality or making an inference call.

Local mode passes the runner's Stop signal through capture and revalidates the
source tab after extraction. When Chrome denies injection, only local mode may
identify an extensionless PDF with a bounded signature-validated download;
downloaded HTML is never summarized as a fallback. Attachment mode requires an
identifiable PDF rather than forwarding an unreadable HTML page as a file.
`pdf.ts` owns the credentialed fetch, signature check, limits, extraction and cleanup.
PDF.js and its worker, CMaps, fonts and licenses ship inside the extension. An
explicit module worker avoids PDF.js's blob-wrapper/fake-worker fallback under
extension CSP; each capture terminates its worker on completion or cancellation.
No new helper installation type or browser permission is needed; existing helpers
must be updated to accept attachments. Source input and coverage use existing
JSON source rows; PDF bytes are never persisted. See the
[PDF capture contract](product.md#summaries) for triggers, bounds and limitations.

The offscreen document hosts the digest runner alongside reading jobs. Both use
the shared native history helper. Built-in digest generation uses the native
ChatGPT transport with a frozen account, prompt, model and effort.

Starts and retries serialize their checks against active sources. Each batch
then runs independently with up to two workers. A new batch or retry cannot
process a URL already queued, capturing, or generating in another batch. Stop
and Delete abort only the target batch and wait for its workers to settle.
Stop releases the control queue after signaling cancellation, so other sources
can start while that batch settles.

The shared history schema is version 4. Browser import schema version 3 is a
one-time import format for digest metadata and item/source rows. On restart,
unfinished items become interrupted; Saul never retries them automatically.
The UI polls saved/live state while mounted and renders built-in English before
Chinese from validated pairs. Raw model text is never interpreted as HTML.

`src/app/Summaries.tsx` owns saved-summary history and live reading under
`library.html#summary/<id>`. A new reader checks saved input reuse before account
choice and sends the exact selected tab IDs. Snapshot metadata records source-window labels per item;
older saved summaries remain readable. Polling reads the latest active batch or the
open reader, never the entire summary history on a recurring timer.

`src/digest/actions.ts` registers **Call Saul** on installation/update.
The context menu and Chrome command share one handler. Chrome UI actions use
`src/digest/panel.ts` to open `summary-panel.html` synchronously in the browser
gesture, with the selected route in trusted session storage per window. The panel
reuses the summary history and reader components and their existing account,
generation, persistence and recovery boundaries. Routes survive panel closure
within the browser session. Resolving a reused result persists its saved ID,
so reopening the panel never replays a temporary selection request.
External native/Tab board requests retain `openSummaryReader` and full-reader URLs;
they have no browser gesture with which to open Chrome's side panel.

Summary reuse lives in the digest runner/store. `DB_DIGEST_FIND` matches ordered
URLs without changing schema or copying output; current captures are compared with
frozen item/source rows and then discarded. Read-only resolve/inspect actions do
not block Stop. For a saved selection, Run again creates a new ID and captures fresh
sources. A final start-time lookup also prevents a second reader from duplicating
an existing active or settled selection. Page comparison failures preserve the saved
answer and remain visible. No recurring capture, semantic cache or expiry timer is
used. Summary inspection assembles the exact user prompt through the same function
as generation; the shared `InspectionText` renders at most one 6,000-character
section per block, searches all sections and copies the complete original text.

## Source layout

The portable [design contract](../../../DESIGN.md) generates CSS for the extension and
self-contained MCP board, a palette for native page highlights, and
SwiftUI roles for EZ. The root `design/generate.mts` consumes the pinned official DESIGN.md
parser; `pnpm design:check` rejects stale artifacts. The [application workflow](../../../design/SKILL.md)
also governs layout/interaction adaptation and rendered review. Generation is
build tooling, independent of authentication, inference, and storage runtimes.

| Path             | Purpose                                                                      |
| ---------------- | ---------------------------------------------------------------------------- |
| `src/app/`       | Popup/workspace screens and settings controllers                             |
| `src/capture/`   | Selection and context capture                                                |
| `src/contracts/` | Cross-context request validation                                             |
| `src/models/`    | Provider adapters, prompts, and stream events                                |
| `src/native/`    | Extension-side tab operations and native bridge                              |
| `src/reading/`   | Durable runner, anchor restoration, and markers                              |
| `src/storage/`   | Settings, native history routing, and legacy OPFS import                     |
| `src/surface/`   | Page-side React UI                                                           |
| `native/`        | Node CLI, MCP server, native host, transport, installer, and shared protocol |

## Surface adapters

| Surface                                                          | Adapter                                                            | Density            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------ |
| Popup, library, settings, tabs                                   | Generated CSS via `assets/tailwind.css`, semantic workspace styles | Compact or reading |
| Selection trigger, card, concept notes, page list, notifications | Same CSS scoped through the shadow root                            | Compact reading    |
| Page underlines                                                  | Generated TypeScript palette, native CSS Highlights                | Host page          |
| Codex MCP tab board                                              | Generated CSS inlined with board styles                            | Dense              |
| EZ main window and settings tint                                 | Generated SwiftUI roles through `AppStyle`                         | Native reading     |

Web appearance follows system preference; the MCP host's explicit light/dark
choice takes precedence. Paired `-dark` colors provide the appearance mapping.
The native app keeps system backgrounds and controls. The adapter maps web px
values to native points and system font roles, without adding a runtime dependency.

## Speech preview boundary

The background [speech bridge](../src/speech/bridge.ts) accepts one bounded
request per trusted Settings port. It reads saved settings, verifies the requested
Speak preset still matches, and resolves only that provider's local API connection.
The connection must use the official OpenAI endpoint; ChatGPT OAuth and other
profiles are never fallbacks. The old native `speech` operation has been removed.

The [Realtime owner](../src/speech/realtime.ts) creates an ephemeral client secret
with the selected API key, then makes one text-input/audio-output WebSocket response.
No microphone or WebRTC permission is needed. It receives PCM16 at 24 kHz and
packages completed audio as WAV for the preview. It bounds text to 512 characters,
audio to 6 MB and the whole operation to 90 seconds. Redirects, incomplete/failed
responses, malformed audio and early disconnects fail without automatic retry.
Remote error bodies are not shown; keys and ephemeral tokens stay out of replies,
settings exports, history and diagnostics. Normal reading and Responses are unchanged.

Stop or caller loss aborts token acquisition and closes the socket. Navigating away
from a Speak preview unmounts it, aborts pending work and revokes its blob URL.
Text and audio remain in memory only. Preset or voice changes clear old audio.
Realtime is generative; preview text is an instruction to read verbatim, not an
exact-synthesis guarantee. See the [current speech flow](chatgpt-plan.md#speech-preview)
and the historical OAuth endpoint probe below it.

## Shared macOS credentials

Preferences → Integrations can explicitly connect this app to the [Saul credential owner](../../../contracts/credentials.md)
using `com.saul.credentials`. Long-lived keys and tokens stay in Keychain; the
browser receives account/model summaries and results. Realtime receives only a
short-lived client secret. A missing owner blocks without fallback. Per-install
`sharedCredentials` and `credentialOwner` references never enter shared presets or
portable configuration. Disconnect app preserves the shared connection; Sign out
and Remove key confirm their both-app scope. Custom endpoints and standalone
browser installations retain their existing route.

Built-in Summarize stores a model preset ID in Saul's scoped settings. New-run
admission resolves the preset through the same path as custom calls and freezes
its route and model options in the batch; credentials stay outside saved history.
Retry uses the saved input. Without an explicit preset, the original summary
setup still resolves its legacy plan binding through `src/digest/connection.ts`.
Reauthorization uses the selected registration in both
apps; only an explicit Add another account requests a new registration.
