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

`src/models/provider.ts` is the streaming facade used by the reading runner and generation tests. It dispatches to OpenAI-compatible, Chrome on-device, or ChatGPT plan adapters and returns the same delta/completion events. Both HTTP adapters reuse `native/sse.mjs` for bounded SSE framing across UTF-8 chunks, CRLF/LF separators, multiline `data:` fields, provider errors, cancellation, and incomplete output. Chrome generation uses the modern `LanguageModel` API in the offscreen document.

Prompts and context are frozen when a job is submitted. Later settings edits do not change an in-flight job. Provider keys are associated with their endpoint origin and are not persisted with job inputs. ChatGPT plan jobs freeze a non-secret account registration ID and model; OAuth credentials stay in the native helper.

`src/models/configuration.ts` owns named recipes and model presets in settings.
Legacy settings migrate to an Explain recipe and a Current preset; prompt roles,
the active connection, and the selected model are preserved. Recipes contain
literal prompt templates and reference a default preset. Presets identify a
provider and its connection/account with model options; they contain no keys.
The existing model controls edit the selected preset, so there is one authority
for each model choice.

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

`native/protocol.mjs` is the runtime schema shared by the extension, CLI, and MCP server. Mutations preview by default, validate current browser state before apply, serialize inside the extension, and never retry automatically after an uncertain error. Incognito and non-normal windows are excluded. `src/native/pages.ts` handles separately opted-in page reads and actions through Chrome scripting in the isolated world; short-lived element references are tied to the read's document. MCP health/discovery bypasses the browser request queue.

The [MCP App](mcp-app.md) serves a self-contained board from `native/ui/`. Drag-and-drop, keyboard controls and Codex requests all feed `native/workspace.mjs` proposals. The service validates complete layouts, issues expiring approval tokens to the app, and verifies each browser move, duplicate closure and label update after the user clicks Apply. Shared window labels belong to trusted extension session storage (`src/native/window-labels.ts`), and are included in tab inventories for both surfaces. On macOS Google Chrome, `native/window-names.mjs` targets the connected browser PID through the AppleScript `givenName` interface: inventory reads import names, and reviewed writes validate window/tab IDs and the expected name, then read back the result. The extension API itself has no native name field. Legacy helper-only labels import on a reviewed apply. Duplicate detection uses exact HTTP(S) URLs; closures retain pins/groups and revalidate the URL and keeper at the extension boundary. `native/app-protocol.mjs` owns app-only schemas; these do not expand the extension's native protocol.

## Window digest ownership

`src/digest/` owns the fixed bilingual summary contract, capture, runner, persistence operations, and safe standalone HTML renderer. The workspace sends validated digest actions through the background; only the background snapshots Chrome windows, and only the offscreen runner can request page captures. Content scripts cannot start or inspect digests. Capture uses isolated-world scripting and validates the original URL before and after reading.

The existing offscreen document hosts the digest runner alongside reading jobs. Both use the same database worker and native ChatGPT transport; digest generation calls the existing plan adapter with a frozen account, prompt, model and effort. Digest control actions serialize, generation is sequential, and there is no automatic retry. Schema version 2 adds digest metadata and item/source rows without rewriting reading data. Restart reconciliation marks unfinished items interrupted. The UI polls saved/live state while mounted and renders English before Chinese from validated pairs; raw model text is never interpreted as HTML.

## Source layout

The portable [design contract](../DESIGN.md) generates CSS for the extension and
self-contained MCP board, a palette for native page highlights, and optionally
SwiftUI roles for EZ. `design/generate.mjs` consumes the pinned official DESIGN.md
parser; `pnpm design:check` rejects stale artifacts. The [application workflow](../design/SKILL.md)
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
