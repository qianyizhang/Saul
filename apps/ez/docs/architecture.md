# Architecture

EZ is native SwiftUI/AppKit. `EZApplication` in `Sources/EZ` owns UI and app
orchestration. `EZCore` owns lookup, request and SQLite logic. Shared
configuration values, the credential client and the signed owner build under
[`native/credentials`](../../../native/credentials/Package.swift). The installed app
needs no Codex, Node, Python, Electron or webview runtime.

| Boundary | Owner |
| --- | --- |
| Windows, menu bar, Services and launcher | `EZApp`, [Quick Lookup controller](../Sources/EZ/QuickLookupController.swift) and [Services](../Sources/EZ/SelectedTextService.swift) |
| App composition and navigation | [EZComposition](../Sources/EZ/EZComposition.swift) assembles installed adapters. [AppModel](../Sources/EZ/AppModel.swift) coordinates the workspace, Settings and shutdown. |
| Lookup workflow | [LookupSession](../Sources/EZ/Lookup/LookupSession.swift) owns the [draft](../Sources/EZ/Lookup/LookupDraft.swift), prepares Send, Follow-up, Retry and Reuse, and cancels superseded preparation. Lookup views observe the session directly. |
| Frozen submission | `LookupRequest` / `LookupRoute` |
| Settings and connection session | [ConfigurationEditor](../Sources/EZ/ConfigurationEditor.swift), `ConfigurationStore`, [ConnectionSession](../Sources/EZ/Connections/ConnectionSession.swift) and `ConnectionChecks` |
| Attempt and history | [AttemptExecution](../Sources/EZCore/AttemptExecution.swift) decides when to send and what to save. [HistoryCollection](../Sources/EZ/HistoryCollection.swift) owns refresh and deletion; [HistoryWriter](../Sources/EZCore/HistoryWriter.swift) serializes SQLite changes. |
| Provider calls | [SaulGeneration](../Sources/EZCore/SaulGeneration.swift) maps the frozen request to the [signed credential owner](../../../contracts/credentials.md). `ResponsesRequest` and `ResponseAccumulator` encode requests and interpret stream evidence. |
| Signed caller, OAuth and Keychain | [Saul credential contract](../../../contracts/credentials.md); [Keychain diagnosis](keychain.md) |

[Surfaces](surfaces.md) owns use and lifecycle at the UI boundary; [design](design.md)
owns native presentation. [ADR 0001](adr/0001-screenshot-first-design-review.md) and
[ADR 0002](adr/0002-model-presets-and-recipes.md) record review and template rationale.

ConnectionSession admits managed commands. A [setup coordinator](../Sources/EZ/Connections/ConnectionSetupCoordinator.swift)
uses the reviewed connection and its app-local recovery record to finish a transaction.
AppModel supplies the configuration store and publishes accepted settings. An explicit continuation checks the original account or endpoint.
[Setup contract](../../../contracts/credentials.md#connection-identity-and-catalogs)

## Direct plan-backed requests

EZ sends plan, official API and bound custom endpoint requests through a pipe
to the signed Saul owner. There is no app-local secret-reading adapter,
fallback or tool executor; offline tests inject disposable credentials.

Plan Write sends the compiled template as one user message, without hidden
starter instructions, tools, temperature, max-output settings or saved
response IDs. It sets `store: false`, `stream: true` and the chosen/default
tier; effort requires support. Legacy history retains its saved instruction
semantics. Unavailable model, effort or Fast blocks. Text completion requires
`response.completed`. [Shared execution](../../../contracts/actions-and-attempts.md#execution)
owns completion, save and replay guarantees.

## Connections and Illustration

Run freezes the action, input, preset and connection; changed on-disk choices
require review before sending. API Write uses an explicit catalog model ID;
API Fast requests `priority`. Plan Fast uses the bound account catalog.

Text-only Draw uses one Images generation request with the compiled prompt.
Initial options are low quality 1024×1024 PNG. The draft can override format;
Run saves it in the preset snapshot. [Shared Draw rules](../../../contracts/configuration.md#connections-and-presets)
own supported formats and GIF compatibility. Exact returned bytes are saved and
downloaded. Stop rejects late output but does not promise remote cancellation
or avoid billing. Image requests reject redirects, time out after 180 seconds
and report bounded, status-specific errors.

## Web search and image inputs

Native actions can enable `webSearch` (off by default) or require one named
`imageInput`; neither field belongs to shared presets. Migrations seed
Illustration, Research and Make meme once, preserving user edits and removals.

API search requires `web_search` with `tool_choice: required` and completed
search activity to report success. Retain validated HTTP(S) citations and offsets
separately from literal response text. Readers and Markdown export render links.
Follow-ups inherit search policy. There is no background research or retry.

`ImageAttachment` accepts detected single-frame PNG/JPEG/WebP up to 20 MB,
40 megapixels and 8,192 pixels per edge. Run saves exact source bytes before
one multipart Images edit with PNG output. Reuse immediately restores editable text
while the history reader loads and validates the saved image. Run waits for the
image. Reattach a missing or invalid required image, or draw a new Sketch.
Continue without an image requires an explicit choice when the saved action
allows it. A new draft, changed history selection, replacement image or sketch
edit supersedes the old restore. Make meme's stable action ID opens Sketch;
Run renders edited work to a square PNG, while plain imports keep original bytes.
Its composition and undo history are draft-local; Reuse restores one frozen layer.

## Persistence contract

[Shared history](../../../contracts/history.md) owns storage and deletion guarantees.
EZ commits one native snapshot entry per lookup UUID. Native `schemaVersion: 1`
JSON and image blobs commit with the record revision and operation receipt. On launch, the writer prepares or migrates the database under the session lock
and marks abandoned EZ rows interrupted. Run and deletion wait for preparation
to finish. Startup and activation reload History without changing Saul's execution. A serial
reader uses a separate query-only connection. Full-detail reads pair the saved snapshot with its record revision, then decode
after releasing the transaction. Library list queries project bounded row values. Live and saved rows derive action labels and icons from the same metadata.
History owns the selected detail and loads its output image separately. The image
follows the selected record and the source run for Saul records. Updates to other
rows leave a loaded image in place.
The app discards a refresh overtaken by a later refresh or shutdown. Local
deletion and attempt changes during a refresh supersede the affected rows.
History lists use 100-row cursor pages with bounded titles and no answer or replay
payload. Scrolling loads the next page; Load more also retries a failed page.
Search matches visible stored query and answer text using the same Foundation
localized case-insensitive substring comparison as before. The count is all
matches, not loaded rows. Native timestamps retain saved JSON precision; browser
rows retain the latest eligible attempt's timestamp and stable identity.

Selecting a row loads its exact saved record separately. The selected answer
survives list refresh and filtering, including Previous answer links outside the
loaded pages. Detail failures stay visible with Retry. Superseded page/detail
reads cannot replace newer state. The detail cache retains at most 20 recent
records plus selected, active and unsaved outcomes; history refresh discards
transient unsaved data according to the attempt contract.

Deletion uses the selected native UUID or browser selection ID. The browser
guard and deletion share a write transaction; neither delete decodes unrelated rows.

`AttemptExecution` waits for the writer to acknowledge pending input before
credentials or transmission. Stop during that initial save prevents the send. If
the pending write finishes, EZ settles it as cancelled. Stop during generation
rejects later callbacks and saves the partial outcome. Stop is unavailable
while the writer settles the attempt. Only acknowledgment of a terminal save
shows saved success. Generation and completion errors remove the pending row
and its attachments. The current result keeps the error, frozen Retry inputs
and any partial output in memory until selection changes. Previously saved
failures keep their history records.

Console's macOS Unified Log shows failed lookups under subsystem `local.ez.app`
and category `Lookup`. It includes the failure stage and error domain/code, with
the error description marked private. If removing the pending row fails, EZ
reports the cleanup error and leaves the original row recoverable as interrupted.
An unacknowledged write does not trigger another write or send. Unsaved output
stays copyable until history is reloaded. Shared deletion clears a selected
history result only after the store acknowledges it.

Normal Quit stops admission, cancels generation and rejects late callbacks. It
waits up to six seconds for history preparation, deletion or the attempt's
decided save or cleanup, then exits. An already accepted completion remains the
outcome during this wait; active generation settles as interrupted. A forced
exit or expired deadline can leave a pending row for the next launch to recover.
No request is replayed. See the
[decision record](adr/0003-settle-attempts-with-async-history.md).

**Retry same request** creates a new attempt from the frozen prompt, action,
preset, connection and image. The history reader loads and validates saved input
bytes off the main actor. Stop, a different history selection or newer draft work
can supersede preparation. The frozen route is checked again after loading, then
the normal pending-save boundary applies. Changed or missing inputs offer review. Completed and Unsaved entries
do not offer Retry. See [surfaces](surfaces.md#reading-and-inspection).

## Follow-ups

A saved, completed native Write answer can supply earlier exchanges, the original
request and its route/search policy to a linked attempt. Limit questions to
2,000 UTF-16 units and compiled conversations to 120,000. Partial, unsaved,
Draw and browser answers are ineligible; missing saved connections require a new
lookup. Per-answer drafts stay in memory until Send or deletion.

## Metrics and activity

Requested and recorded service tiers remain separate. Response tokens are output
minus reasoning; absent reasoning usage is unknown. TTFT measures monotonic time
from HTTP start after auth to the first nonempty answer/refusal delta, not metadata
or terminal-only text. Tokens/s divides response tokens by the remaining stream
duration through its terminal event; missing values or invalid intervals stay
unknown. Partial/failing attempts can retain observations. No reasoning payload,
estimated plan quota or cost is recorded. [Design](design.md#activity-and-answer-presentation)
owns the divider treatment.

## Unified configuration

[Shared configuration](../../../contracts/configuration.md) owns atomic revisioned
saves and compatibility. EZ seeds the initial Current preset from prior
model/effort/Fast settings. The editor preserves current lookup overrides and
historical actions; a failed save retains the original item and draft. Reload
explicitly adopts newest settings. Shortcut storage is separate: corrupted or
unsupported bindings retain their file and use defaults pending explicit restore.
See [selectors and shortcuts](surfaces.md#selectors-and-shortcuts).

## Official integration references

- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts and refresh](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and Responses](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview constraints](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Search](https://developers.openai.com/api/docs/guides/tools-web-search) and [image edits](https://developers.openai.com/api/docs/guides/image-generation#edit-images)
