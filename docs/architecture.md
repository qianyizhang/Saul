# Architecture and decisions

## Design review

[ADR 0001: Screenshot-first design review](adr/0001-screenshot-first-design-review.md)
records the accepted visual feedback workflow and when to reconsider a web mockup.

[ADR 0002: Model presets and editable recipes](adr/0002-model-presets-and-recipes.md)
defines configuration, template inputs, preset overrides, and historical snapshots.

## Components

| Component | Responsibility |
| --- | --- |
| `Sources/EZ/EZApp.swift` | Native window and app commands |
| `ContentView` / `SettingsView` / `AppStyle` | Lookup interface, account settings, shared appearance |
| `Sources/EZ/AppModel.swift` | User actions, selected account/model, task lifecycle, visible errors |
| `ChatGPTAuth` | OAuth registration, validated identity, consent, refresh, logout |
| `LoopbackListener` | Bounded HTTP callback listener bound only to 127.0.0.1 |
| `OIDC` | PKCE and RS256 identity verification using CryptoKit/Security |
| `AuthStorage` | Keychain records and exclusive runtime lock |
| `ResponsesClient` | Account model discovery and stateless streamed Responses requests |
| `ResponseAccumulator` / `SSEParser` | Wire-event parsing and terminal completion checks |
| `HistoryStore` | Owner-only, locked JSONL snapshots, deletion, and recovery |

## Direct plan-backed requests

Decision: use the documented Sign in with ChatGPT direct flow. EZ does not run an
agent, Codex app-server, CLI, or tool executor. Native `URLSession` avoids bundling
a second runtime; it sends the same public HTTP requests an OpenAI SDK sends.
There are no model tools in the request. Account/model choices come from the live
`/v1/models` catalog. Unavailable preset choices block sending rather than silently changing them.

Inference sends one user message containing the compiled recipe template. Starter
mode instructions are editable template text; new recipes have no hidden mode
instructions. Legacy history retains its earlier instruction semantics. Every request explicitly
sets `store: false`, `stream: true`, and the chosen/default service tier. Effort
is sent only when available. No temperature, max-output-tokens, saved response ID,
or unsupported preview fields are added. Completion requires a terminal
`response.completed`; a partial stream is not a successful answer.

## Authentication invariants

- The installation host ID is stable. Each issued client ID has its own identity
  and credentials, even when email addresses match.
- New registration uses `dynamic_agent_client`; save the issued ID before code
  exchange. Reauthentication uses the saved ID and fresh state, nonce, and PKCE.
- Listen on `127.0.0.1`, use `/auth/callback`, and preserve the exact redirect URI
  across authorization and exchange. Validate state, callback parameters, and client ID.
- Verify RS256 signatures against OpenAI's discovered JWKS, plus issuer, audience,
  expiry, subject, and nonce. Reject unsupported algorithms. Do not trust decoded JWTs.
- Identity sign-in and plan permission are distinct. Require granted
  `chatgpt.tokens.use.direct` before model discovery/inference.
- Credentials stay in Keychain. Persist rotations together; serialize refresh in
  the process and hold an exclusive runtime lock to prevent cross-process races.
- Restore credentials asynchronously off the UI actor. Publish a complete read
  only after success and a cancellation check; do not freeze history access while
  Keychain authorization waits.
- Clear tokens on terminal refresh failure, not on network/5xx errors. Logout
  attempts revocation; an unconfirmed remote revocation is shown explicitly.
- OAuth URLs, codes, tokens, and raw auth diagnostics never enter chat history.

See [Keychain access](keychain.md) for the exact stored item and development
signing limitations. Presets and recipes persist on explicit Save in Configuration;
they contain no credentials and remain separate from lookup history. Configuration
editing preserves a draft's preset override and any recipe restored from history.

## Persistence contract

History entries carry `schemaVersion: 1` and UUID identity. Append before sending;
append again on completion, interruption, or failure. Retain partial visible text
on cancellation. Record requested and, when returned, actual service tier separately.
Loading keeps the last valid entry for each ID. Invalid lines are counted and
preserved. A missing final newline is separated before appending the next record.
Reads, appends, and deletions use a stable `history.lock` sidecar with `flock`;
writes use mode `0600` and `fsync`. Never silently submit an unrecorded query.

Individual deletion belongs to the main window: an answer action or history-row
context menu opens a destructive confirmation. Deletion is blocked during a request
or pending launcher submission. Remove every JSON line with the selected UUID,
including identifiable damaged snapshots; preserve all unrelated bytes verbatim.
Write and flush an owner-only sibling, then atomically rename it over the history
file while holding the sidecar lock. No backup copy is retained. Only successful
persistence removes the visible entry and clears its selection in both surfaces;
failures keep the lookup visible and show an error. Deleting preserves composer
drafts, including a recipe/inputs already restored with Use again. Unidentifiable
damaged lines are preserved and may still contain text from a deleted lookup;
deletion does not remove exports, clipboard contents, or filesystem backups.

Known scale boundary: history loads into memory. Introduce indexed storage only
when real history size warrants it, with a tested import and export path.

## Extension points

Add a new text workflow as a recipe in Configuration. `QueryMode` remains the
legacy history discriminator and starter icon mapping. Features requiring
conversation context need an explicit conversation model and retention decisions.
Add API-key billing only as an explicit user choice, with separate credentials;
never silently use it after a plan-usage failure. Global shortcuts and menu-bar
access should call the same app actions. See the roadmap for deferred work.

## Quick Lookup

The [surface contract](surfaces.md) is the canonical product boundary; the
[glossary](../GLOSSARY.md) defines names. Main-window management grows separately
from the compact execution panel.

Quick Lookup is a native, nonactivating `NSPanel` hosting SwiftUI. **Control–Option–Space**
is registered with Carbon's hotkey API while EZ is running; it does not monitor global
keystrokes or request Accessibility permission. Registration failures are visible in
both the panel and menu-bar menu, which remains an alternate entry point. The panel
appears on the pointer's display and can accompany other apps and full-screen Spaces.
It takes keyboard focus without activating EZ; hiding it releases that focus.

The panel and main window share one `AppModel`: recipe, draft inputs, preset override,
selection, account, request lifecycle, and history. Opening it preserves the
current draft/result; New lookup explicitly clears the draft/result when idle.
There is only one request at a time. Escape, Command–W, and toggling the hotkey hide
the panel without cancelling or discarding work; Command–period stops generation.
Command–Return sends, and Command–N starts a new lookup. Shutdown cancels the request
and unregisters the hotkey/event handlers, even if the main window has been closed.

The panel starts at 460 points wide, with a 420-point minimum width. The minimum
content height starts at 200 points and grows to retain its inputs, notices, actions,
and a usable answer area. Preferred height adds reading space for answers while
keeping the top edge stable and fitting the current display. Long inputs and
answers scroll independently of the actions. Its preset label opens a popover
using the same `RequestControls` as the main window. The popover separates next-request
choices from the displayed answer's recorded choices and actual service tier.
Configuration/account actions and history open the main window. Text enters through
typing, explicit paste, or the explicit launcher
submission below; EZ does not read selected text or poll the pasteboard. Ordinary
panel opening never sends a query. Hiding the panel does not clear the system
clipboard. No new history format or inference service is added.

## Launcher submissions

Raycast's Bash script command passes one percent-encoded argument through
`ez://lookup?query=...`, explicitly targeting `~/Applications/EZ.app`. `LauncherQuery`
in EZCore validates the route, a single query parameter, nonblank text, and a
16,384-byte UTF-8 ceiling. Decode once; URL input cannot override account, model,
mode, effort, billing, or service tier. The URL scheme is callable by other local
apps and can consume plan allowance; it provides no tools or executable actions.

The application delegate starts connection and hotkey registration independently
of the main window. One startup connection task is shared with launcher handling.
A pending submission disables sending and query/account/preference edits while
initial connection completes. It then calls the same `AppModel.send()` used by
both views. Busy/signing-in/duplicate submissions are refused without replacing
the current draft or cancelling generation. Missing permission/model, connection,
and storage errors leave the query visible for manual retry, with no automatic
send after later sign-in. Shutdown cancels startup and pending launcher tasks.

The `--ez-launcher` argument suppresses default main-window presentation on macOS
15+; the compact panel supplies the SwiftUI open-window action for history/settings.
SceneBuilder's limited-availability wrapper retains macOS 14 support, where a cold
launch may also show the main window. Normal app launch still opens the main window.
The app remains a native Swift executable, with no launcher runtime dependency.
