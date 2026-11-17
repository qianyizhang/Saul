# Architecture

EZ is native SwiftUI/AppKit. `Sources/EZ` owns UI and app orchestration;
`Sources/EZCore` owns request, protocol and persistence logic. The installed app
needs no Codex, Node, Python, Electron or webview runtime.

| Boundary | Owner |
| --- | --- |
| Windows, menu bar, Services and launcher | `EZApp`, [Quick Lookup controller](../Sources/EZ/QuickLookupController.swift) and [Services](../Sources/EZ/SelectedTextService.swift) |
| Shared actions and draft | [AppModel](../Sources/EZ/AppModel.swift) and [LookupDraft](../Sources/EZ/LookupDraft.swift) |
| Frozen submission | `LookupRequest` / `LookupRoute` |
| Settings editing | [ConfigurationEditor](../Sources/EZ/ConfigurationEditor.swift), `ConnectionChecks` and `ConfigurationStore` |
| Attempt and terminal save | [AttemptExecution](../Sources/EZCore/AttemptExecution.swift) and [HistoryStore](../Sources/EZCore/HistoryStore.swift) |
| Provider calls | [SaulGeneration](../Sources/EZCore/SaulGeneration.swift), `ResponsesRequest`, `ResponseAccumulator` and `ImagesClient` |
| Signed caller, OAuth and Keychain | [Saul credential contract](../../../contracts/credentials.md); [Keychain diagnosis](keychain.md) |

[Surfaces](surfaces.md) owns use and lifecycle at the UI boundary; [design](design.md)
owns native presentation. [ADR 0001](adr/0001-screenshot-first-design-review.md) and
[ADR 0002](adr/0002-model-presets-and-recipes.md) record review and template rationale.

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
one multipart Images edit with PNG output. Reuse validates saved bytes; missing
or invalid input needs reattachment. Make meme's stable action ID opens Sketch;
Run renders edited work to a square PNG, while plain imports keep original bytes.
Its composition and undo history are draft-local; Reuse restores one frozen layer.

## Persistence contract

[Shared history](../../../contracts/history.md) owns storage and deletion guarantees.
EZ upserts one snapshot per UUID; native `schemaVersion: 1` JSON and image blobs
commit together. Startup under the session lock marks abandoned EZ rows interrupted;
startup and activation reload History without changing Saul's execution. A serial
reader uses a separate query-only connection and releases its SQLite snapshot
before decoding rows. Image bytes load separately for the selected answer.
The app discards a refresh overtaken by a later refresh or shutdown. Local
deletion and attempt changes during a refresh supersede the affected rows.
Deletion uses the selected native UUID or browser selection ID. The browser
guard and deletion share a write transaction; neither delete decodes unrelated rows.

`AttemptExecution` saves pending input before credentials or transmission.
Cancellation invalidates callbacks; terminal save must succeed before saved
success. Unsaved output may remain copyable until history is reloaded; the
pending row reads as interrupted when inactive. Successful deletion alone clears
the visible result.

**Retry same request** creates a new attempt from the frozen prompt, action,
preset, connection and image. Revalidate saved bytes and immutable route through
the normal pending-save boundary, without touching the editor or previous
result. Changed/missing inputs offer review. Completed and Unsaved entries
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
