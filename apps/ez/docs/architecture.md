# Architecture and decisions

## Design review

The user-scope `gui-review` skill
owns the annotation workflow for GUI refinement.
[ADR 0001](adr/0001-screenshot-first-design-review.md) retains the historical rationale.

[ADR 0002: Model presets and editable actions](adr/0002-model-presets-and-recipes.md)
defines configuration, template inputs, preset overrides, and historical snapshots.

## Components

| Component | Responsibility |
| --- | --- |
| `Sources/EZ/EZApp.swift` | Native window and app commands |
| `ContentView` / `SettingsView` / `AppStyle` | Lookup interface, account settings, shared appearance |
| `Sources/EZ/AppModel.swift` | User actions, selected account/model, attempt projection, visible errors |
| `AttemptExecution` | Frozen attempt, provider task, cancellation, durable outcome, save-only recovery |
| `ChatGPTAuth` | OAuth registration, validated identity, consent, refresh, logout |
| `LoopbackListener` | Bounded HTTP callback listener bound only to 127.0.0.1 |
| `OIDC` | PKCE and RS256/ES256 identity verification using CryptoKit/Security |
| `AuthStorage` | OAuth data models and exclusive app runtime lock |
| `ResponsesRequest` / `SaulGeneration` | Frozen request serialization and shared-owner operations |
| `GenerationProvider` | Provider identity and supported operations; no secret access |
| `ImagesClient` / `ProviderState` | Owner-side bounded PNG requests, shared API connection metadata, selected image loading and download |
| `ResponseAccumulator` / `CredentialSSE` | Wire-event parsing and terminal completion checks |
| `HistoryStore` | Shared SQLite snapshots/image blobs, migration, deletion, and recovery |
| `SharedPresetsStore` | Unified JSON model presets and EZ configuration scope; one-time import and stale-save detection |

## Direct plan-backed requests

Decision: use the documented Sign in with ChatGPT direct flow. EZ does not run an
agent, Codex app-server, CLI, or tool executor. Native `URLSession` avoids bundling
a second runtime; it sends the same public HTTP requests an OpenAI SDK sends.
There are no model tools in the request. Account/model choices come from the live
`/v1/models` catalog. Unavailable preset choices block sending rather than silently changing them.

Inference sends one user message containing the compiled action template. Starter
mode instructions are editable template text; new actions have no hidden mode
instructions. Legacy history retains its earlier instruction semantics. Every request explicitly
sets `store: false`, `stream: true`, and the chosen/default service tier. Effort
is sent only when available. No temperature, max-output-tokens, saved response ID,
or unsupported preview fields are added. Completion requires a terminal
`response.completed`; a partial stream is not a successful answer.

## Providers and Illustration

`ProviderDefinition` owns stable unique keys, display names and transport kind.
Defaults are `gpt-plan` (Write) and `openai-api` (Write/Draw/Speak). Presets bind the key,
capability, model and options, not a particular plan account. `GenerationProvider`
requests operations from the signed Saul owner and derives supported operations from its handlers.
No credential reaches an action or shared preset. Unknown/incompatible providers
block before generation; no automatic model, account or billing fallback exists.

Legacy presets decode as `gpt-plan` / Write. Legacy action/history JSON keys
`recipes` and `recipeSnapshot` remain stable. Provider definitions and presets share the `modelPresets` section and its revision
with Saul. Reads adopt legacy EZ-scoped definitions only when the shared list is
absent. Subsequent native scope writes omit providers; shared definitions win on
reload. Credentials stay in the Saul owner; Action inputs and runtime bindings stay app-owned. `actionTypesVersion` seeds Illustration once;
IDs and existing behavior survive, and deletion is respected after migration.

Illustration is a Draw action using `AppModel` and `AttemptExecution`, the same
workspace, composer and single active request as Write. API Write presets use
an explicit model ID. Its explicit Fast choice sends `service_tier: priority`;
plan Fast remains catalog-controlled. The [official Fast mode guide](https://developers.openai.com/api/docs/guides/fast-mode)
owns API tier semantics. Text-only Draw sends one `POST /v1/images/generations`, defaulting to
GPT Image 2.5 Flare, low quality, 1024×1024 PNG. Its action template is the exact
compiled prompt. Image options belong to its preset. Key Save/Reload and inspection
never generate. The old EZ Keychain services are retired only after verified migration to the Saul owner.

Run freezes action, input values, preset and provider snapshots. Stop invalidates
late output and cancels the local task without claiming the server stopped or
billing was prevented. No automatic retries. Image requests time out after 180s,
reject redirects, bound response bytes/dimensions and use safe status-specific errors.

History stores input and output image bytes as SQLite blobs beside the frozen
entry JSON, atomically in the same row. It creates no image sidecar directory.
The initial pending snapshot precedes generation. A failed terminal save retains
both images in memory for save-only recovery. Deletion removes the record and
its blobs together. The [shared history contract](../../../docs/architecture.md#shared-history)
owns location, migration and cross-app behavior.

## Web search and image inputs

EZ-local Action fields `webSearch` (default false) and `imageInput` (a named required
image, absent by default) extend existing text-template fields. They never enter
shared Presets or Saul actions. `actionTypesVersion = 2` seeds editable Research
and Make meme actions/presets once, preserving existing IDs, names, bindings and
user removals. Research defaults to API Write / GPT-6.1 Sol; Make meme defaults
to API Draw / GPT Image 2.5 Flare. Saved incompatible choices remain blocked.

Search requests use Responses `tools: [{type: "web_search"}]` and
`tool_choice: "required"`. Only the API provider can execute them. A completed
text answer without a completed `web_search_call` search action fails the attempt;
no fallback request or retry occurs. The accumulator records observed searching
activity, completed search and validated HTTP(S) URL annotations. History retains
citation offsets and URLs independently of raw answer text. Both readers and
Markdown export render inline source links; raw inspection retains exact model
text. Explicit follow-ups inherit the saved search policy and API preset. No
background research, custom search engine, domain controls or automatic search
is introduced. See [OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search).

ImageAttachment validates detected PNG/JPEG/WebP content, one frame, at most 20 MB,
40 megapixels and 8,192 pixels per edge. Choose, Paste and Drop prepare a draft
only. Invalid replacement preserves the previous source. Run freezes exact bytes;
History atomically saves them as input image BLOBs with the pending entry in the
shared SQLite database before transmission. Entry metadata contains source
name/format. An image input selects one multipart `POST /v1/images/edits` with the same
model/size/quality/output contract as generation; there is no hidden text analysis
or second image request. See [OpenAI image edits](https://developers.openai.com/api/docs/guides/image-generation#edit-images).

Reuse loads and validates the saved source; missing or invalid bytes require
reattachment. Save again retains exact source/result bytes and retries storage
only. Deletion removes the entry and its input/output BLOBs without touching the
original user's file or external exports. Both native surfaces share the same
draft and operations.

## Authentication invariants

- The installation host ID is stable. Each issued client ID has its own identity
  and credentials, even when email addresses match.
- New registration uses `dynamic_agent_client`; save the issued ID before code
  exchange. Reauthentication uses the saved ID and fresh state, nonce, and PKCE.
- Listen on `127.0.0.1`, use `/auth/callback`, and preserve the exact redirect URI
  across authorization and exchange. Validate state, callback parameters, and client ID.
- Verify RS256 or ES256 signatures against OpenAI's discovered JWKS, plus issuer, audience,
  expiry, subject, and nonce. Reject unsupported algorithms. Do not trust decoded JWTs.
- Identity sign-in and plan permission are distinct. Require granted
  `chatgpt.tokens.use.direct` before model discovery/inference.
- Credentials stay in Keychain. Persist rotations together; serialize refresh in
  the signed Saul owner using a kernel lease to prevent cross-process races.
- Restore credentials asynchronously off the UI actor. Publish a complete read
  only after success and a cancellation check; do not freeze history access while
  Keychain authorization waits.
  `CredentialStore.read()` starts on the main actor, matching its authentication
  caller; the Sendable shared owner storage explicitly performs blocking reads in a
  detached task. Complete compiler concurrency checking enforces this boundary.
- Clear tokens on terminal refresh failure, not on network/5xx errors. Logout
  attempts revocation; an unconfirmed remote revocation is shown explicitly.
- OAuth URLs, codes, tokens, and raw auth diagnostics never enter chat history.

See [Keychain access](keychain.md) for the exact stored item and development
signing limitations. Presets and actions persist on explicit Save in Configuration;
they contain no credentials and remain separate from lookup history. Configuration
editing preserves a draft's preset override and any action restored from history.

## Lookup workspace

Configuration editors stay mounted while changing Settings sections so unsaved text
and scroll position survive. Item selection/Add and Settings dismissal guard dirty
edits; Save remains explicit. A failed save keeps the edit and dirty state.

The main window separates composing from reading. A new lookup places its composer
directly below the heading. Selecting an answer collapses the composer; Edit
draft/Hide draft reveal or hide the existing draft without replacing it. Use again
explicitly restores the saved request. Running requests keep Stop reachable in
the reading footer. Copy and Use again are the primary answer actions; export and
delete live in More. Exact request metadata and metrics are available in Details.
**Inspect input/output** shows the selected lookup's saved instructions, input
fields, compiled prompt and literal response, with per-block copy. The main window
and Quick Lookup's Details popover share this native view. It reads history only;
it does not regenerate prompts, send requests or retain HTTP/SSE logs. Legacy
instructions that were not saved are labelled unavailable rather than reconstructed
from current mode defaults. Incomplete output retains its lookup status and error.
Input validation keeps actionable blockers visible and omits routine hints in Min Mode.
Both surfaces scroll keyboard-focused inputs into view.

Min Mode is enabled by default and shared by both native lookup surfaces
through `AppModel.minimumMode`. It hides repeated guidance, shortcut reminders,
decorative copy, and persistent response metrics. It never hides actionable
errors, sign-in/storage blockers, generation state, or unsaved-edit guards. The
Settings toggle and Quick Lookup actions menu change the same UserDefaults
preference. Offline previews always start with Min Mode on and never read or
write this personal preference. The preference is local to EZ; there is no
cross-product or device synchronization. Switching modes changes presentation
only and preserves the shared draft, preset override, and selected answer.
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
asks the user to add an action.
Otherwise it starts a new lookup using the selected configured action (or the first
remaining action after a historical action was removed), resets preset overrides,
and fills only the first field. Sending remains explicit for every action. No
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

History entries carry `schemaVersion: 1` and UUID identity. `AttemptExecution`
appends before requesting credentials or sending, then appends the terminal snapshot
before publishing a saved outcome. It owns cancellation and rejects callbacks from
older attempts. AppModel and both lookup surfaces project that same lifecycle.
Record requested and, when returned, actual service tier separately.

A failed terminal append retains the exact completed, interrupted, or failed snapshot
in memory by UUID and presents **Unsaved** with its own save error. The response,
provider error, frozen input, metrics and tier stay attached to that attempt. New
lookup, History selection and hiding a surface preserve it. **Save again** only
repeats that snapshot's history append, without authentication, prompt preparation,
or another provider request. It is unavailable during an active request or pending
launcher submission. Successful persistence restores the original terminal outcome;
a failed retry preserves Unsaved. Copy and Export remain available. Successful
lookup deletion also removes its recovery snapshot; failed deletion preserves it.

Unsaved is a transient projection, not a new on-disk status or recovery store.
Latest-snapshot-per-UUID loading makes save-only retries safe after an uncertain
write/flush failure. Bytes never persisted cannot survive quitting EZ; startup
retains the existing pending-to-interrupted classification and never resubmits.
Global storage warnings describe startup/history-load problems, not attempt durability.
Optional response metrics retain server-reported input/output/reasoning counts and
client-observed stream timing; older history remains readable with unknown metrics.
Both surfaces expose token counts and timing in Details; disabling Min Mode
also pins a compact status line below the composer/actions. Response tokens mean
output minus reasoning and can include non-visible formatting tokens. Missing
reasoning is unknown, not zero. TTFT uses a monotonic
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

SQLite upserts retain the current snapshot for each UUID. Writes are transactional
and owner-only. Never silently submit an unrecorded query. Startup under EZ's
session lock marks its abandoned pending records interrupted; refreshing history
never alters another app's execution state. Shared history is read again on activation.

Individual deletion belongs to the main window and confirms deletion from EZ and
Saul. It removes the selected native record and blobs, or the selected browser
passage with its runs. Failure preserves unsaved recovery. Retired JSONL, lock and
image files are read only by one-time migration, verified, then removed; malformed
sources remain intact with a blocking error. There are no permanent backups or
fallback writers. The shared database preserves browser anchors and native metadata.

## Extension points

Add a new text workflow as an action in Configuration. `QueryMode` remains the
legacy history discriminator and starter icon mapping. Features requiring
conversation context need an explicit conversation model and retention decisions.
API-key billing is explicit in API presets, with separate credentials;
never silently use it after a plan-usage failure. Global shortcuts and menu-bar
access should call the same app actions. See the roadmap for deferred work.

## Quick Lookup

The [surface contract](surfaces.md) is the canonical product boundary; the
[glossary](../GLOSSARY.md) defines names. Main-window management grows separately
from the compact execution panel.

Quick Lookup is a native, nonactivating `NSPanel` hosting SwiftUI. **Control–Option–Space**
is registered with Carbon's hotkey API while EZ is running; it does not monitor global
keystrokes or require Accessibility permission for opening. Registration failures are visible in
both the panel and menu-bar menu, which remains an alternate entry point. The panel
appears on the pointer's display and can accompany other apps and full-screen Spaces.
It takes keyboard focus without activating EZ; hiding it releases that focus.

The panel and main window share one `AppModel`: action, draft inputs, preset override,
selection, account, request lifecycle, and history. Shortcut/menu invocation uses
`showFreshLookup`, which starts a new lookup when idle. Plain `show` preserves
prepared Services/Raycast inputs. The surface contract owns the invocation behavior.
With Accessibility access, `SelectedTextCapture` reads only the frontmost external
app's focused element's selected text, once per idle invocation. Reads run off the
UI actor with a 150 ms messaging timeout per AX call. No clipboard or document-body
fallback is used. Missing permission, unsupported/empty selections, and text above
16,384 UTF-8 bytes leave the lookup empty. Settings → Shortcuts provides an explicit
Accessibility settings action; invocation never prompts for permission. Autofill
only prepares the first field and never submits. Dismissal or a new invocation
cancels the pending fill; changed drafts, active work and Settings reject late results.
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
In Min Mode, selecting an answer hides the panel's input fields and replaces
the action picker with the answer's saved action name, and the preset selector
with its saved preset name and requested speed. Exact
model and service tier information remains in Details. Edit
draft restores the current inputs and preset selector without changing them;
Hide draft returns to reading. New/Stop and Copy remain reachable. Field visibility
participates in panel sizing, so the reading layout does not reserve blank form space.
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
Settings sections, model/action editor rows, and the main Settings entry use
`FullRowButton`, a plain native button with an explicit rectangular content shape
around the complete padded label. Selection changes its background, not its hit area.
Dropdowns receive wheel events through AppKit’s normal hit-testing, so only the
hovered control changes; there are no app-wide scroll monitors. Discrete wheel steps and accumulated
precise deltas use the existing selection bindings. Choices clamp at the ends;
momentum is ignored and steps are throttled. Quick Lookup’s fixed-width preset
selector changes overrides; its adjacent information button opens request details.

`LookupCommand` names lookup actions and ordered action positions. `AppModel`
executes them through existing New/Send/Stop/chooseRecipe actions and request guards.
Next/Previous wraps; positions 1–8 and Last follow Configuration order. A repeated
selection is a no-op; leaving historical replay selects a live action. Action
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

## Spelling comparison presentation

`SpellingComparison` derives a local word/punctuation diff from completed spelling
history with a single input. It recognizes explicit corrected-text / changes
labels, either standalone or followed by same-line content, including Markdown
emphasis and supported Chinese equivalents; ambiguous unlabelled responses
retain the ordinary answer renderer. It does not alter prompts, saved history,
copy/export contents, or make a second request. Markdown inline decoration is
removed from the corrected comparison text; original input is preserved literally.
Notes are separated only at a recognized heading. The complete literal response stays in
Inspect input/output on both lookup surfaces. Failed, interrupted, and streaming answers never claim to be
completed corrections. Diff work is bounded at 4,000 tokens per side and 2,000,000
token pairs; larger passages still compare without highlights and disclose that limit.

Wide spelling comparisons use shared paragraph rows. Unchanged word positions from
the existing diff anchor corresponding blocks; blank lines and list-item starts
form block boundaries. One-to-many and many-to-one anchors group paragraph splits
and merges. Unanchored blocks occupy their own side with the opposite cell empty,
so insertions/deletions do not shift later matches. Each row grows to its taller
cell without fixed heights or independent scrolling. Narrow presentation retains
the full text; the existing long-input limit also bounds alignment work and falls
back to a single unhighlighted pair.

## Unified configuration

`ConfigurationStore` imports the local configuration into
`Little Clarity/settings.json` → `apps.ez.configuration` once, retaining the old
file for recovery. Subsequent loads and saves use the scoped JSON section; shared
model definitions remain in `modelPresets`. Section revisions reject stale saves.
Account selection and credentials never belong to a model preset. Native shortcuts,
Min Mode and window placement retain their existing local stores.

Speak presets preserve a Realtime model and strict `speechOptions.voice` in the
shared store. The native preset editor can change those choices. Playback currently
runs only in Saul. Native availability/preparation and the final execution boundary
block Speak before credential resolution; native actions expose Write and Draw.

## Shared credential owner

EZ uses the independently installed signed Saul owner for official OpenAI operations.
See the [shared credential contract](../../../contracts/credentials.md) for caller
validation, migration, disconnect, sign-out and failure behavior. The app has no
production secret-reading adapter. Offline suites inject disposable credentials.
