# Architecture and decisions

## Design review

The user-scope [`gui-review` skill](../../../.codex/skills/gui-review/SKILL.md)
owns the annotation workflow for GUI refinement.
[ADR 0001](adr/0001-screenshot-first-design-review.md) retains the historical rationale.

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
  `CredentialStore.read()` starts on the main actor, matching its authentication
  caller; the Sendable Keychain store explicitly performs blocking reads in a
  detached task. Complete compiler concurrency checking enforces this boundary.
- Clear tokens on terminal refresh failure, not on network/5xx errors. Logout
  attempts revocation; an unconfirmed remote revocation is shown explicitly.
- OAuth URLs, codes, tokens, and raw auth diagnostics never enter chat history.

See [Keychain access](keychain.md) for the exact stored item and development
signing limitations. Presets and recipes persist on explicit Save in Configuration;
they contain no credentials and remain separate from lookup history. Configuration
editing preserves a draft's preset override and any recipe restored from history.

## Lookup workspace

Configuration editors stay mounted while changing Settings sections so unsaved text
and scroll position survive. Item selection/Add and Settings dismissal guard dirty
edits; Save remains explicit. A failed save keeps the edit and dirty state.

The main window separates composing from reading. Selecting an answer collapses
the composer; Edit draft/Hide draft reveal or hide the existing draft without
replacing it. Use again explicitly restores the saved request. Running requests
keep Stop reachable in the reading footer. Exact request metadata is disclosed on
demand, while response metrics remain pinned. Input validation uses a fixed-height
hint, and both surfaces scroll keyboard-focused inputs into view.
See [native regression journeys](ui-qa.md) for UI acceptance boundaries.

## Selected-text Services

`NSServices` advertises **Look Up in EZ** as a plain-text input service with no
return types. `EZAppDelegate` retains a `SelectedTextService` and registers it as
`NSApp.servicesProvider` after the lookup controller is ready. The Objective-C
`lookupSelectedText:userData:error:` callback reads only the supplied Services
pasteboard and synchronously prepares a draft before showing Quick Lookup. It
does not access the general clipboard, modify the source selection, send, await
authentication, or queue a submission. Callback failures use the Services error
pointer so the source app can report rejection.

`AppModel.prepareSelectedText` validates nonblank input and the 16,384 UTF-8-byte
limit before mutating the workspace. A running request, pending launcher, sign-in,
open Settings, or any nonempty draft input rejects the selection without mutation.
Unavailable configuration reports its load/storage error; an empty configuration
asks the user to add a recipe.
Otherwise it starts a new lookup using the selected configured recipe (or the first
remaining recipe after a historical recipe was removed), resets preset overrides,
and fills only the first field. Sending remains explicit for every recipe. No
history is written until Send. Signed-out and catalog-loading states can hold the
draft; ordinary send checks still apply. Cold Services launch may show the main
window as well as Quick Lookup; the Raycast-only presentation flag is unchanged.

This follows Apple's [Services provider contract](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/SysServices/Articles/providing.html).
Registration and a direct callback check do not establish cross-app menu delivery.

## Local packaging identity

Local signing setup pins an existing code-signing certificate fingerprint in
ignored `.local/signing-identity`; the private key remains in macOS Keychain.
Configured packaging reuses that identity and fails if it is unavailable.
Unconfigured `make app` remains ad-hoc for offline development/CI. An explicit
development signing override is allowed, but `make install` requires the pin and
rejects a different override. Installation requires EZ to be stopped, verifies
the staged bundle's certificate/identifier and the previous same-certificate
build's identity requirement, then replaces `~/Applications/EZ.app` while retaining
the old bundle for rollback. It does not alter authentication or local app data.
Self-signing establishes update identity, not prompt-free Keychain upgrades,
Developer ID, or notarization. The credential item's separate partition policy
uses `cdhash:` for this signing class and can prompt again when the code changes;
see the [Keychain diagnosis](keychain.md#why-a-rebuild-can-ask-again).
See [local signing and installation](releasing.md#local-signing-and-installation).

## Persistence contract

History entries carry `schemaVersion: 1` and UUID identity. Append before sending;
append again on completion, interruption, or failure. Retain partial visible text
on cancellation. Record requested and, when returned, actual service tier separately.
Optional response metrics retain server-reported input/output/reasoning counts and
client-observed stream timing; older history remains readable with unknown metrics.
Both surfaces pin a compact status line below the composer/actions for the selected
lookup. Response tokens mean output minus reasoning and can include non-visible
formatting tokens. Missing reasoning is unknown, not zero. TTFT uses a monotonic
clock from HTTP request start (after auth) to the first nonempty answer/refusal text delta;
metadata/empty events and a terminal-only answer do not establish TTFT. Tokens/s
is non-reasoning response tokens divided by (HTTP stream duration through the
terminal event minus TTFT). The interval begins with first visible answer/refusal
text, excluding initial waiting/thinking. Missing usage/TTFT or an invalid interval
leaves speed unknown. Partial/failing streams retain observed timing and any
terminal usage without becoming successful.
Cost is omitted. Official direct-flow guidance points to ChatGPT Settings → Usage
for allowance/credits; it does not document a quota percentage in each response.
API rate-limit token headers are not treated as ChatGPT plan allowance. The existing
Settings Manage usage link is the supported path; no extra request is added.
See [official usage guidance](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions#tracking-usage).
A transient response activity follows the first reasoning `response.output_item.added`
event and nonempty answer/refusal text deltas. The divider starts yellow while
waiting, becomes green on a reasoning-item event, and stays green until text arrives.
The light stops permanently for that lookup when visible text starts, even if later
reasoning items arrive. Terminal events/cancellation/failure also stop it. No
reasoning payload is requested, retained, or added to history. Before a reasoning
event, the UI labels activity as waiting rather than confirmed thinking. Reduce
Motion uses a stationary light; hidden panels remove the timeline. Generation uses
text status and the divider light without a second spinner.
See [Responses usage](https://developers.openai.com/api/reference/resources/responses)
and [output counting](https://developers.openai.com/api/docs/guides/token-counting).

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
answers scroll independently of the actions. Its preset selector changes overrides
directly; the adjacent information button opens the shared `RequestDetails` popover.
The main-window `RequestControls` uses that same details view without duplicating
selectors. The popover separates next-request choices from the displayed answer's recorded choices and actual service tier.
Configuration/account actions and history open the main window. Text enters through
typing, explicit paste, the selected-text Service above, or the explicit launcher
submission below. The Service reads only its supplied pasteboard when invoked;
EZ does not monitor selections or poll the clipboard. Ordinary
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

## Selector scrolling and keyboard commands

All production dropdowns use a width-filling native `NSPopUpButton` through
`SelectorPicker`. The label is separate from the control’s stable full-width hitbox;
changing from a long title to a short one never shrinks the click/scroll area.
Settings sections use a fixed-width native segmented control. Both receive wheel
events through AppKit’s normal hit-testing, so only the hovered control changes;
there are no app-wide scroll monitors. Discrete wheel steps and accumulated
precise deltas use the existing selection bindings. Choices clamp at the ends;
momentum is ignored and steps are throttled. Quick Lookup’s fixed-width preset
selector changes overrides; its adjacent information button opens request details.

`LookupCommand` names lookup actions and ordered recipe positions. `AppModel`
executes them through existing New/Send/Stop/chooseRecipe actions and request guards.
Next/Previous wraps; positions 1–8 and Last follow Configuration order. A repeated
selection is a no-op; leaving historical replay selects a live recipe. Recipe
selection retains its existing draft-reset/default-preset contract.

`QuickLookupController` installs one app-local key monitor independently of global
hotkey registration. Both lookup surfaces use the same persisted bindings, including
while text fields have focus. Settings, sheets, and modal dialogs take priority;
key repeats are consumed without repeated actions. Native Lookup menu items expose
the bindings. The global panel shortcut and app/window lifecycle keys remain fixed.

`LookupShortcutsStore` owns a separate versioned, owner-only `shortcuts.json` with
explicit overrides, including cleared bindings. Load validates supported keys,
modifier bits, reserved editing/app shortcuts, and collisions against defaults.
Unsupported or corrupt files are preserved and reported in Settings; runtime uses
defaults until the user explicitly restores the file. Changes validate and flush
an owner-only sibling before atomic replacement; in-memory bindings publish only
after persistence succeeds. Chrome navigation changes both bindings atomically.
