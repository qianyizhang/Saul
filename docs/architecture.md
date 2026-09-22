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
- Credentials remain in trusted extension storage or runner memory. They are excluded from page messages, stored run inputs, and exports.
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

`src/models/openai-compatible.ts` and `src/models/chrome-ai.ts` expose streamed events to the runner. The remote adapter handles SSE framing across UTF-8 chunks, CRLF/LF separators, multiline `data:` fields, provider errors, cancellation, and incomplete output. Chrome generation uses the modern `LanguageModel` API in the offscreen document.

Prompts and context are frozen when a job is submitted. Later settings edits do not change an in-flight job. Provider keys are associated with their endpoint origin and are not persisted with job inputs.

## Tab boundary

The extension tab workspace calls `src/native/tabs.ts` directly. Optional external access follows this path:

```text
CLI or MCP -> private Unix socket -> native host -> Chrome native messaging -> tab tools
```

`native/protocol.mjs` is the runtime schema shared by the extension, CLI, and MCP server. Mutations preview by default, validate current browser state before apply, serialize inside the extension, and never retry automatically after an uncertain error. Incognito and non-normal windows are excluded.

## Source layout

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
