# Architecture and decisions

EZ is native SwiftUI/AppKit. UI lives in `Sources/EZ`; reusable protocol, storage
and request logic lives in `Sources/EZCore`. The installed app needs no Codex,
Node, Python, Electron or webview runtime.

## Owners

| Owner                                                        | Responsibility                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `EZApp` / `QuickLookupController`                            | Windows, menu bar, Services, launcher and keyboard lifecycle                   |
| `AppModel` / `ProviderState`                                 | User actions, selected configuration, draft, history and visible errors        |
| `AttemptExecution`                                           | Frozen attempt, generation, cancellation, terminal save and save-only recovery |
| `GenerationProvider` / `SaulGeneration`                      | Supported operations and requests to the signed credential owner               |
| `ChatGPTAuth` / `LoopbackListener` / `OIDC`                  | Owner-side OAuth, bounded loopback callback and verified identity              |
| `ResponsesRequest` / `ResponseAccumulator` / `CredentialSSE` | Request serialization, stream parsing and completion                           |
| `ImagesClient` / `ImageAttachment`                           | Bounded image requests and validated source images                             |
| `HistoryStore`                                               | Shared SQLite snapshots, image blobs, migration and deletion                   |
| `ConfigurationStore` / `SharedPresetsStore`                  | Scoped configuration, shared presets, migration and stale-save checks          |

[Surfaces](surfaces.md) owns feature placement; [design](design.md) owns native
presentation. [ADR 0001](adr/0001-screenshot-first-design-review.md) records review
rationale; [ADR 0002](adr/0002-model-presets-and-recipes.md) records the template
and preset decision.

## Direct plan-backed requests

Use the documented Sign in with ChatGPT direct flow through native `URLSession`.
No agent, CLI, app-server or tool executor runs in EZ. Plan model choices come
from `/v1/models`; unavailable model, effort or Fast choices block sending.

Write sends its compiled template as one user message; starter instructions
are editable template text, with no hidden mode instructions. Legacy history keeps
its saved instruction semantics. Requests set `store: false`, `stream: true` and
an explicit chosen/default tier; effort is included only when supported. They add
no temperature, max-output-tokens, saved response ID or unsupported preview fields.
Plan requests contain no tools. Text success requires `response.completed`;
partial streams remain incomplete.

## Providers and Illustration

`ProviderDefinition` owns stable keys, names and transports. Defaults are `gpt-plan`
(Write) and `openai-api` (Write/Draw/Speak). Presets bind provider, capability, model
and options, never a plan account or secret. Unknown/incompatible choices block
before generation. Never silently change account, model, billing or service tier.

Illustration uses the same workspace and single active attempt as Write. API Write
uses an explicit model ID; Fast sends `service_tier: priority`, while plan Fast is
catalog-controlled. See the [API Fast guide](https://developers.openai.com/api/docs/guides/fast-mode).
Text-only Draw sends one `POST /v1/images/generations`; its default is GPT Image
2.5 Flare, low quality, 1024×1024 PNG. The compiled template is the exact prompt;
image options belong to the preset. Key Save/Reload and inspection never generate.

Run freezes action, inputs, preset and provider snapshots. Stop cancels locally
and rejects late output; it cannot promise server cancellation or avoided billing.
There are no automatic generation retries. Image requests time out after 180s,
reject redirects, bound bytes/dimensions and report safe status-specific errors.

## Web search and image inputs

Action-only `webSearch` (default false) and optional named, required `imageInput`
never enter shared presets or Saul actions. Versioned migrations seed Illustration,
Research and Make meme once, preserving IDs, edits and removals. Research defaults
to API Write / GPT-6.1 Sol; Make meme to API Draw / GPT Image 2.5 Flare.

Search requires the API provider and Responses
`tools: [{type: "web_search"}]`, `tool_choice: "required"`. A completed text answer
without a completed search action fails; it never triggers a fallback or retry.
History retains validated HTTP(S) citations and offsets separately from raw text.
Readers and Markdown export render source links; inspection preserves literal
output. Follow-ups inherit search policy and search again. No background research,
custom engine, domain controls or automatic search is added.
See [web search](https://developers.openai.com/api/docs/guides/tools-web-search).

`ImageAttachment` accepts detected single-frame PNG/JPEG/WebP, at most 20 MB,
40 megapixels and 8,192 pixels per edge. Choose/Paste/Drop prepare only a draft;
invalid replacement keeps the prior source. Run freezes and saves exact input
bytes before transmission. An image input selects one multipart
`POST /v1/images/edits` with the same output contract as generation, without a
hidden analysis or second request. See [image edits](https://developers.openai.com/api/docs/guides/image-generation#edit-images).
Reuse validates the saved source; missing/invalid bytes require reattachment.
Deletion removes saved blobs, never the original file or external exports.

## Authentication invariants

The [shared credential contract](../../../contracts/credentials.md) owns caller
validation, migration, refresh, disconnect and sign-out. Owner-side OAuth must:

- Preserve the host ID and each issued client ID's identity, even for equal emails.
- Register with `dynamic_agent_client`, save the issued ID before exchange, and
  reauthenticate with that ID plus fresh state, nonce and PKCE.
- Bind only `127.0.0.1`, use `/auth/callback`, preserve the exact redirect URI and
  validate state, callback parameters and client ID.
- Verify RS256/ES256 signatures against discovered JWKS plus issuer, audience,
  expiry, subject and nonce; reject unsupported algorithms and unverified JWTs.
- Separate identity from granted `chatgpt.tokens.use.direct` usage permission.
- Keep secrets in Keychain, persist rotations together and serialize refresh with
  a cross-process kernel lease. Blocking reads run off the UI actor; cancellation
  must not publish a partial restore or prevent history access.
- Clear tokens on terminal refresh failure, retain them on network/5xx errors,
  and report unconfirmed logout revocation.
- Exclude OAuth URLs, codes, tokens and raw auth diagnostics from history.

[Keychain access](keychain.md) explains stored items and signing limits.

## Persistence contract

[Shared history](../../../docs/architecture.md#shared-history) owns database
location, schema, cross-app behavior and one-time migration. Native entries retain
`schemaVersion: 1` and UUID identity; SQLite upserts one current snapshot per UUID.
Input/output image blobs and frozen JSON save atomically in that row, without
sidecar files. Startup under EZ's session lock marks its abandoned pending entries
interrupted; activation reloads history without changing Saul's execution state.

`AttemptExecution` saves pending input before credentials or transmission, then
saves the terminal snapshot before publishing a saved outcome. An initial save
failure blocks the request. Cancellation invalidates callbacks from older attempts.
Requested and returned service tiers remain separate.

A terminal save failure retains the exact completed/interrupted/failed snapshot,
images, provider error and metrics in memory by UUID, projected as **Unsaved**
with a separate save error. New lookup, selection and hiding preserve it.
**Save again** retries only that snapshot's upsert, without auth, prompt preparation
or generation. It is blocked during an active request/pending launcher. Success
restores the original outcome; failure retains Unsaved. Copy/Export remain usable.
Bytes never saved cannot survive quitting; startup never resubmits.

Main-window deletion confirms its scope across EZ and Saul. It removes a native
record and blobs, or a browser passage and its runs. Only successful deletion
clears in-memory recovery. Migration alone reads retired JSONL/lock/image files;
verified import precedes removal, while malformed sources remain with a blocking
error. No fallback writer or permanent migration backup is created.

## Follow-ups

A saved, completed native Write answer can supply explicit follow-up context.
`HistoryEntry.prepareFollowUp` keeps the saved request, instructions, earlier
exchanges, model/effort/speed and search policy, using the selected local account.
Each Send creates a linked history entry; no context is silently dropped.
Questions are limited to 2,000 UTF-16 units and compiled conversations to 120,000.
Unsaved/partial answers must finish or recover first. Draw and browser entries
cannot run follow-ups in EZ. AppModel holds per-answer question drafts in memory;
deletion or successful Send clears them. Stop and recovery use `AttemptExecution`.

## Metrics and activity

Metrics are optional; older history stays readable. Record server usage and
client-observed timing. Response tokens = output minus reasoning, including any
non-visible formatting tokens; missing reasoning is unknown, not zero.

TTFT runs on a monotonic clock from HTTP start after auth to the first nonempty
answer/refusal delta. Empty/metadata events or terminal-only text do not establish
TTFT. Tokens/s = response tokens / (stream duration through terminal event − TTFT).
Missing usage, TTFT or a valid interval leaves speed unknown. Failure/partial output
retains observations without claiming completion. See [Responses usage](https://developers.openai.com/api/reference/resources/responses)
and [output counting](https://developers.openai.com/api/docs/guides/token-counting).

Cost and plan quota percentages are omitted. API rate-limit headers are not plan
allowance; Settings → Manage usage is the supported path, with no extra request.
See [usage guidance](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions#tracking-usage).
Activity follows reasoning-item events and nonempty text deltas; no reasoning
payload is requested or saved. [Design](design.md#activity-and-answer-presentation)
owns the divider treatment.

## Quick Lookup

A nonactivating `NSPanel` hosts SwiftUI and shares one `AppModel` with the main
window. Carbon registers ⌃⌥Space while EZ runs, without global keystroke monitoring
or Accessibility permission for opening. Registration errors remain visible;
the menu bar is the fallback. The panel opens on the pointer's display, supports
full-screen Spaces and returns focus when hidden.

`showFreshLookup` resets idle work; plain `show` preserves Services/Raycast drafts.
With Accessibility access, `SelectedTextCapture` reads the external focused
element's selection once per idle invocation, off the UI actor with a 150 ms
per-call timeout. It never reads the clipboard or falls back to document text.
Missing permission, unsupported/empty selection or more than 16,384 UTF-8 bytes
leaves the lookup empty. Invocation never prompts for permission or submits.
Dismissal/new invocation cancels capture; changed drafts, active work and Settings
reject late results. Shutdown cancels work and unregisters event handlers.

The panel starts 460 points wide (420 minimum), with minimum content height starting
at 200. It grows for inputs, notices and reading space, preserving its top edge
within the display. Forms/answers scroll independently of actions. Configuration
and history open the main window. [Surfaces](surfaces.md) owns reading/editing,
shortcuts, Min Mode and shared-state behavior.

## Selected-text Services

`NSServices` advertises **Look Up in EZ**, plain-text input with no return types.
`EZAppDelegate` retains/registers `SelectedTextService` after the panel is ready.
Its `lookupSelectedText:userData:error:` callback reads only the supplied Services
pasteboard and synchronously prepares a draft. It never changes the clipboard or
source selection, sends, awaits auth or queues work; errors use the Services pointer.

`AppModel.prepareSelectedText` validates nonblank text and the 16,384-byte limit
before mutation. Active work, sign-in, Settings, nonempty inputs or an image reject
it unchanged. Unavailable configuration reports its error; empty configuration
asks for an action. Otherwise it uses the selected configured action (first remaining
if a historical action was removed), resets the override and fills the first field.
Signed-out/catalog-loading states may hold the draft; Send remains explicit and
no history is written before it. Cold launch may also show the main window.
See [Apple's contract](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/SysServices/Articles/providing.html);
a direct callback check does not prove installed cross-app delivery.

## Launcher submissions

[Raycast](raycast.md) owns setup and URL behavior. The delegate shares its initial
connection task with launcher handling. Pending submission locks sending and
query/account/preference edits until startup completes, then calls normal Send.
Busy/signing-in/duplicate submissions preserve active work. Connection, permission,
model or storage errors retain the draft for manual retry, never later auto-send.
Shutdown cancels startup and launcher tasks. `--ez-launcher` suppresses the main
window on macOS 15+; macOS 14 cold launch may show it.

## Selector scrolling and keyboard commands

`SelectorPicker` wraps width-filling `NSPopUpButton`; label length never changes
its hitbox. AppKit routes wheel events only to the hovered control. Selection clamps
at the ends, ignores momentum and throttles steps. `FullRowButton` gives Settings
sections/editor rows and the main Settings entry a rectangular padded hit area;
selection changes background only.

`LookupCommand` calls existing AppModel actions and guards. Previous/Next wraps;
positions 1–8 and Last follow configuration order. Reselecting the current action
is a no-op; choosing another resets inputs/default preset and exits historical replay.
One app-local key monitor serves both surfaces, including focused text fields.
Settings, sheets and dialogs take priority; key repeats do not repeat actions.
Global panel and lifecycle keys stay fixed.

`LookupShortcutsStore` validates version, keys, modifiers, reserved shortcuts and
collisions in owner-only `shortcuts.json`, including cleared bindings. Corrupt or
unsupported files remain intact with a Settings error; defaults run until explicit
restore. Writes atomically replace a flushed owner-only sibling before publishing
bindings. Chrome navigation updates both bindings together.

## Spelling comparison presentation

`SpellingComparison` locally diffs completed, single-input spelling entries with
recognized corrected-text/changes headings, including Markdown and supported
Chinese labels. Ambiguous/partial/failed responses keep ordinary rendering.
Inline Markdown decoration is removed only in comparison text; saved response,
Copy and Export stay literal. Notes split only at recognized headings. No request
or prompt change occurs.

Diffs are bounded at 4,000 tokens per side and 2,000,000 token pairs; larger inputs
show unhighlighted text and disclose the limit. Unchanged-word anchors align
paragraph/list blocks, group splits/merges and leave opposite cells empty for
unmatched blocks. Rows grow to the taller side in one scroll area. Alignment uses
the same long-input bound and falls back to one unhighlighted pair.

## Unified configuration

`Little Clarity/settings.json` holds shared providers/presets in `modelPresets`
and EZ actions in `apps.ez.configuration`. Section revisions reject stale saves;
`ConfigurationStore` imports old `EZ/configuration.json` once and retains it for
recovery. Shared provider definitions win; legacy EZ definitions are adopted only
when the shared list is absent and omitted on later scope writes. Legacy presets
decode as `gpt-plan`/Write; persisted `recipes`/`recipeSnapshot` keys remain stable.
Account choice/secrets never belong to a preset. Shortcuts, Min Mode and window
placement keep their local stores.

Save is explicit. Preset/Action editors stay mounted across Settings sections;
item changes, Add and dismissal guard dirty edits. Save failure keeps the draft.
Configuration editing preserves lookup overrides and restored historical actions.
Speak presets retain Realtime model and strict `speechOptions.voice`; EZ can edit
them but blocks execution before credentials. Playback runs only in Saul.

## Local packaging identity

[Releasing](releasing.md#local-signing-and-installation) owns signing, installation
and rollback. Stable bundle/credential identities are migration contracts;
packaging must not relocate app data. A stable signature alone does not prove
prompt-free Keychain upgrades; see [Keychain diagnosis](keychain.md#why-a-rebuild-can-ask-again).

## Shared credential owner

EZ requests official OpenAI operations from the independently installed signed
Saul owner. Production has no app-local secret-reading adapter or fallback;
offline suites inject disposable credentials. The [shared contract](../../../contracts/credentials.md)
owns the protocol and lifecycle; [verification](verification.md) separates offline,
installed and live-service evidence.

## Extension points

Add text workflows as actions. `QueryMode` remains a legacy history discriminator
and starter icon mapping. Reuse app actions for shortcuts/menu entry points and
explicit API presets for API billing. Further conversation or provider features
need explicit context, retention and billing decisions; see [roadmap](roadmap.md).
