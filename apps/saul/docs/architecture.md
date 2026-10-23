# Architecture

Saul is a Chrome MV3 extension with four runtime contexts. State crosses contexts only through validated messages or the native-messaging protocol.

## Runtime map

| Context            | Entry point                     | Responsibility                                                                                                |
| ------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Content script     | `entrypoints/content.tsx`       | Capture selections, render the shadow-DOM reading UI, restore page markers                                    |
| Service worker     | `entrypoints/background.ts`     | Validate callers, route reading/workspace requests, manage settings, badges, notifications, and native access |
| Offscreen document | `entrypoints/offscreen/main.ts` | Own durable reading jobs and Chrome on-device generation                                                      |
| Database worker    | `src/storage/db-worker.ts`      | Serialize SQLite-WASM operations against OPFS                                                                 |

The popup and full workspace reuse the application views under `src/app/`. The full workspace owns global history, export, deletion, settings, and tab organization.

Presentation preferences are separate from provider drafts. `src/storage/presentation.ts`
owns the default-on Minimum Mode value in trusted extension storage. Popup and
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
  -> database worker checkpoints and commits the attempt
  -> background updates page subscribers and the unread badge
  -> content script restores the marker and opens results on request
```

`src/reading/runner.ts` owns queueing, cancellation, checkpoints, completion classification, and restart reconciliation. Remote providers allow two concurrent jobs; Chrome on-device generation allows one. Jobs are never replayed automatically after uncertain runner/browser loss.

An answer is ready only after a provider completion signal, readable output, and a successful database commit. Interrupted, stopped, provider-error, and save-error states retain honest status and available partial text.

Streaming checkpoints flush within 500 ms even when the provider becomes silent
after a burst. The runner exposes transient connecting/waiting/thinking/generating
activity separately from saved run status. Thinking requires an explicit provider
reasoning-item event; only its activity signal is forwarded, never reasoning text.
Answer or refusal text stops the light, and completion still requires the terminal
provider event followed by a successful save.

## Persistence and anchors

- SQLite runs only in the dedicated worker. Production must not fall back silently to an in-memory database.
- Schema changes are forward-only, versioned, and transactional. Unknown future schema versions are rejected; downgrades are unsupported.
- API keys remain in trusted extension storage or runner memory; ChatGPT OAuth credentials remain in the native helper. They are excluded from page messages, stored run inputs, and exports.
- A saved passage uses URL identity, quote context, and captured text offsets to restore one exact occurrence. Legacy metadata may remain stored but does not authorize a match.
- Native CSS Custom Highlights mark exact, unambiguous occurrences without wrapping or replacing page text.
- Missing or ambiguous passages remain accessible from the page list and library with location unavailable.

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

`src/models/provider.ts` is the streaming facade used by the reading runner and generation tests. It dispatches to OpenAI-compatible, Chrome on-device, or ChatGPT plan adapters and returns the same delta/completion events. Both HTTP adapters reuse `native/sse.mts` for bounded SSE framing across UTF-8 chunks, CRLF/LF separators, multiline `data:` fields, provider errors, cancellation, and incomplete output. Chrome generation uses the modern `LanguageModel` API in the offscreen document.

Prompts and context are frozen when a job is submitted. Later settings edits do not change an in-flight job. Provider keys are associated with their endpoint origin and are not persisted with job inputs. ChatGPT plan jobs freeze a non-secret account registration ID and model; OAuth credentials stay in the native helper.

Reading results project only saved instruction text, user prompt and context fields
into `inspection`. Connection settings and account identifiers are excluded. The
shared input/output inspector renders literal text from the selected attempt in
the page card and History, including partial output; it does not reconstruct prompts
from current settings or claim to retain raw HTTP/SSE traffic.

`src/models/configuration.ts` owns named recipes and model presets in settings.
Legacy settings migrate to an Explain recipe and a Current preset; prompt roles,
the active connection, and the selected model are preserved. Recipes contain
literal prompt templates and reference a default preset. Presets identify a
provider and its connection/account with model options; they contain no keys.
The existing model controls edit the selected preset, so there is one authority
for each model choice.

`src/models/settings-draft.ts` owns recipe, preset and profile editing transitions,
including connection-key clearing and the persisted projections. Settings views
hold independent drafts and submit through `saul-settings`; the trusted background
owns one serialized read/commit/recovery lane in `src/storage/settings.ts`.
A commit compares the loaded raw record's opaque fingerprint before writing.
There is no stored revision field and loading does not rewrite legacy records.
A stale Save preserves all draft fields and selections and blocks another Save
until explicit reload; discarding a dirty draft for reload requires confirmation.
An uncertain response also preserves the draft without replaying the write.
Presentation and notification preferences use separate keys and do not cause
configuration conflicts. Invalid-record backup/reset uses the same commit lane.

Content scripts receive recipe names and safe choice summaries, then submit only
the recipe ID with captured context. `src/reading/configuration.ts` resolves the
saved recipe/preset in the background and freezes both with the rendered prompts
in `input_json`. Retry uses the frozen request, resolving credentials only for its
original connection; missing connections and changed endpoints block explicitly.
Choosing another recipe for the same passage creates a new attempt. It cannot
replace an active attempt. Historic rows remain readable without recipe snapshots.

The [ChatGPT plan helper](chatgpt-plan.md) uses a separate native host, `com.saul.chatgpt`, and a shared allowlisted protocol. The background validates extension-port senders and brokers requests from Settings and the offscreen runner. The native helper owns loopback OAuth, JWT verification, private credential persistence, serialized refresh, and the constrained Responses/SSE transport. It is independent of the tab bridge.

## Tab boundary

The extension tab workspace calls `src/native/tabs.ts` directly. Optional external access follows this path:

```text
CLI or MCP -> private Unix socket -> native host -> Chrome native messaging -> tab tools
```

`native/protocol.mts` is the runtime schema shared by the extension, CLI, and MCP server. Public CLI mutation tools preview by default. Internal transport commands support direct user edits; both paths validate current browser state, serialize inside the extension, and never retry automatically after an uncertain error. Incognito and non-normal windows are excluded. `src/native/pages.ts` handles separately opted-in page reads and actions through Chrome scripting in the isolated world; short-lived element references are tied to the read's document. MCP health/discovery bypasses the browser request queue.

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

`src/digest/` owns the fixed bilingual summary contract, capture, runner, persistence operations, and safe standalone HTML renderer. The workspace sends validated digest actions through the background; only the background snapshots selected tabs, and only the offscreen runner can request page captures. Content scripts cannot start or inspect digests. Capture uses isolated-world scripting and validates the original URL before and after reading.

The existing offscreen document hosts the digest runner alongside reading jobs. Both use the same database worker and native ChatGPT transport; digest generation calls the existing plan adapter with a frozen account, prompt, model and effort. Digest control actions serialize, generation uses two concurrent workers, and there is no automatic retry. All workers settle before a stop/delete/retry control can complete. Schema version 2 adds digest metadata and item/source rows without rewriting reading data. Restart reconciliation marks unfinished items interrupted. The UI polls saved/live state while mounted and renders English before Chinese from validated pairs; raw model text is never interpreted as HTML.

`src/app/Summaries.tsx` owns saved-summary history and live reading under
`library.html#summary/<id>`. A new reader resolves account choice and sends the
exact selected tab IDs. Snapshot metadata records source-window labels per item;
older saved summaries remain readable. Polling reads active progress or the
open reader, never the entire summary history on a recurring timer.

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
| `src/storage/`   | Settings, client routing, schema, database, and worker                       |
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

## Experimental speech boundary

The Settings-only `speech` operation uses the existing ChatGPT native bridge and
credential owner. Its allowlist fixes the public Speech endpoint, model and MP3
format; callers can supply only the selected account, up to 512 input characters,
and a small supported voice list. It refuses redirects, limits audio to 600 kB
before base64/native-message framing, and uses the existing sanitized error parser.
Page scripts and the offscreen text runner cannot call it. Closing the view or
pressing Stop cancels the request; blob URLs are revoked on replacement/unmount.
No history, saved credential format, or normal Responses behavior changes. See the
[endpoint probe results](chatgpt-plan.md#experimental-speech-and-endpoint-probes).
