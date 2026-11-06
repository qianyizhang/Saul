# Shared behavior and interfaces

This is the shared semantic contract, implemented in TypeScript and Swift.
Model presets use one local store. App-specific configuration uses scoped sections; active execution remains app-owned; opted-in macOS credentials use the [Saul owner](credentials.md); saved history shares one SQLite store.

## Action preparation

The conceptual interface accepts an action, supplied inputs and an explicit preset;
it returns prepared instructions/prompt and frozen choices, or a useful validation
error. Preparation does not send, change configuration, or resolve by falling back.

- Substitute `{{field name}}` literally once. Inserted text is never parsed again.
- Preserve input Unicode and whitespace. Required missing or blank values block.
- Reject malformed delimiters, expressions/control blocks and oversized templates.
- A surface advertises its available inputs; unsupported input requirements block.
- Historical inspection reads saved input/output, never current settings.

Current adapters deliberately differ: the browser requires `text` and accepts a
fixed set of page-context fields; native templates accept up to 16 named fields.
Browser prompt assembly may append enabled source context. Native inputs come
from a form. This migration does not erase those semantics or claim action interchange.

[Template fixtures](fixtures/templates.json) cover the common literal-substitution
subset and invalid syntax in both production implementations. Native tests load
these files relative to their source, so the runner's current directory is irrelevant.
Broader behavior remains covered by each app's existing state/provider/storage tests.

## Execution

The conceptual interface submits prepared input, exposes activity and terminal
outcome, and accepts explicit cancellation. Both adapters must:

- Freeze prompts and model choices at submission; later edits affect new work.
- Keep terminal success distinct from partial/interrupted/provider-error output.
- Require the provider's completion signal and successful local save before
  presenting a saved successful result.
- Preserve available partial output and honest errors after cancellation/failure.
- Never resubmit after restart, import or uncertain loss without an explicit action.
- Keep dismissing a view distinct from stopping work.
- Keep draft restoration distinct from execution.

Concurrency, source capture and anchors are app-specific. History shares SQLite.

[Attempt fixtures](fixtures/attempts.json) run through both production execution
owners: Saul's ReadingRunner and EZ's AttemptExecution via AppModel actions. They
cover initial-save failure, completed and saved output, terminal-save failure,
provider failure, missing completion and cancellation. The common assertions are
provider-call count, retained output and saved success, not matching status enums.
EZ projects a failed terminal save as **Unsaved** and retries only that frozen
terminal record. Saul retains its existing failed/save-failed projection and
durable recovery before an explicit new attempt. Neither app reports saved success
from a provider completion signal alone.

## History operations

Saul and EZ share the SQLite schema and these behavioral meanings, with native
interfaces and record projections in each app:

| Operation             | Shared outcome                                                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read                  | Return literal saved prompts/output, including Unicode; never generate.                                                                                                       |
| Save a frozen attempt | Repeating the same terminal save retains one record and its original input/output. Publish saved success only after storage acknowledges it.                                  |
| Delete                | Refuse deletion while the other app owns an active attempt. A successful delete remains absent on reopen; the execution owner discards that attempt's unsaved recovery state. |
| Open a store          | Reject an unknown newer schema, preserving it for recovery.                                                                                                                   |

[History fixtures](fixtures/history.json) run against the production Node and Swift
stores: repeated terminal saves, durable deletion, foreign active-attempt guards,
and newer-schema rejection. The existing [Attempt fixtures](fixtures/attempts.json)
and execution-owner checks cover save failure, no inference replay and invalidated
recovery. An upsert primitive is not permission to retry a deleted attempt.

Only Saul needs reconnect after Native Messaging loss. Its exhaustive
[operation catalogue](../apps/saul/native/history-protocol.mts) owns admission and
classifies reads, repeatable writes and explicit writes. The browser derives
reconnect eligibility from that catalogue: at most three connection attempts,
keeping the same request identity. Delete, Clear and Bookmark stay single-attempt
after an uncertain reply; migration transfers and unknown operations never
reconnect automatically. Sender permissions remain separately validated.

EZ accesses SQLite directly. It retains explicit Save again for the exact unsaved
terminal snapshot, and never adds a reconnect loop or repeats generation. The
native implementations remain separate; this contract adds no Node dependency,
shared process, runtime manifest or database migration.

## Connections and presets

ChatGPT model presets share `~/Library/Application Support/Little Clarity/settings.json`.
The JSON document has a `modelPresets` section containing one `revision`, `presets`
and `connections`. Each connection has a
stable unique `key`, `name`, `kind` (`chatgpt-plan` / `openai-api`), optional pinned
`accountId` for plan connections, and optional `baseUrl` for API connections.
Account and endpoint cannot change once bound; another identity needs another
connection. Plan supports Write; official OpenAI supports Write, Draw and Speak;
custom chat-completions endpoints support Write.
Both clients read and save these same connection definitions; neither owns a second list.
`kind` selects the provider; `key` identifies the saved connection. The default connection
IDs are `gpt-plan` and `openai-api`, not provider identifiers or a `gpt-api` kind.
See the [source-name mapping and storage upgrade policy](../docs/architecture.md#provider-connection-and-protocol).
Legacy definitions in EZ’s app scope seed the shared list once; the shared list
then wins. [Connection fixtures](fixtures/connections.json) are validated in both runtimes.
Preset saves preserve all other sections. Each preset has a UUID `id`,
`name`, `model`, `effort` (empty means Default), and `fast`, plus optional
`connectionKey`, `capability` (`write` / `draw` / `speak`), `imageOptions` (`size`, `quality`, optional `outputFormat`) and
`speechOptions` (`voice`).
Absent typed fields decode as `gpt-plan` / Write. Image settings accept square,
landscape or portrait sizes and low/medium/high quality. `outputFormat` accepts
`png` or `gif`; absence means PNG. GIF generation requires GPT Image 2.6 and
cannot be combined with an input image. Animation uses the API defaults (9 frames,
200 ms per frame); callers preserve the returned bytes and media type. Both clients preserve
these fields even when the capability is unavailable locally. Credentials stay behind the selected owner. Saves replace the file atomically; stale editor revisions require Reload and
preserve the draft. Both native adapters serialize the read/check/replace through
`settings.json.lock.sqlite3`: a SQLite `BEGIN IMMEDIATE` lease with a five-second
busy timeout and no settings data. The lease is released on process exit. Keep
the lock file in place while either app may use it; deleting it would split the lock.

Write presets show Model, Effort and Standard/Fast speed where supported.
Draw presets hold image model, size, quality and default output format. New API
starters leave the model unassigned until a current catalog choice is made. Both apps freeze a runtime PNG/GIF choice in the
attempt preset snapshot. Saul supports selection-based Illustrate; EZ also supports
image edits with PNG output. Existing saved model choices are retained until edited. Plan
Fast is selectable only when the account catalog advertises it. Native API Write
can explicitly request priority; Saul blocks API presets with reasoning/Fast options
its transport cannot honor, while preserving those fields for EZ. Unsupported saved choices remain visible
and block execution. New model selections prefer advertised none/minimal/low,
then the advertised default, then the first effort, and start at Standard.

Each app imports its old ChatGPT presets once. Duplicate names get numeric
suffixes; preset IDs and action references are preserved or remapped locally.
After migration the shared store owns these presets. Deleted presets stay deleted;
actions referencing them need another explicit choice. Presets retain `connectionKey`
as their stored connection reference. Managed plan connections pin one `accountId`;
preset selection cannot retarget that connection. Unbound legacy entries require
an explicit account choice in Connections. Existing standalone browser routes keep
their local account/profile selection until explicitly connected to the shared owner.
Freeze connection, account, endpoint, model and billing route for execution and retry.
A changed owner or endpoint blocks the saved attempt; never promote an old route or
retry inference automatically. Historical output remains readable.

Both apps edit Draw presets and execute image actions; native additionally supports
image inputs. Speak previews run in both Settings surfaces through OpenAI Realtime,
with deliberate playback and no audio or preview-text history. Speak is not a Write
action. The signed owner stores official and explicitly added custom API keys by
connection; existing standalone browser credentials keep their local owner. Secrets
and ephemeral speech authorization never enter the settings document or history.

Model choices use live connection catalogs. The shared owner serializes discovery
and refresh, caches one validated snapshot per connection for five minutes, and
keeps the last successful models on failure. Settings entry, setup and stale action
preparation trigger bounded refresh; Check forces it. A successful complete empty
catalog means no models; malformed or incomplete discovery does not mean removal.
A removed model stays in the preset with a visible update requirement. Presets are
never rewritten to another model. Protocol-family support is separate from catalog
membership; unknown capabilities are not inferred from a successful HTTP request.
No recurring polling process or catalog history is retained.

Upgrade both clients and the signed credential helper before saving connection
bindings; older strict readers cannot consume the added fields.
Swift and Node read the same JSON file; Saul accesses it through its existing ChatGPT helper.
Neither app needs the other app running. Settings load/reload and new requests
read the current store; EZ also reads on activation outside Settings. Open editors
keep their drafts until Save or Reload. Historical and prepared requests stay frozen.

The conceptual interface exposes identity, permission, available models and
supported options, then resolves the preset's fixed managed connection (or a standalone local profile) for
execution. Sign-in and plan-use permission are separate. Unsupported model,
effort, account or tier blocks; no silent provider, account or billing fallback.
Credentials stay outside prompts, saved results, shared fixtures and exports.

Shared account labels and disclosure rules live in [DESIGN.md](../DESIGN.md).
An optional shared implementation must satisfy the
[replacement contract](../docs/architecture.md#optional-shared-capabilities) before
an app can opt into it. The [macOS Saul credential owner](credentials.md) implements this replacement for official OpenAI connections.

## Presentation

[DESIGN.md](../DESIGN.md) owns visual roles and interaction semantics, including
Min Mode, action placement, focus, error disclosure and input/output inspection.
Platform controls and density remain bespoke. Build/fixture checks do not establish
native visual or live-provider acceptance.

## Unified configuration scopes

The same JSON document holds `apps.saul.settings`, `apps.saul.calls`, and
`apps.ez.configuration`. Each section has a numeric `revision` and object `value`;
one locked atomic replacement preserves sibling scopes and unknown root fields.
An editor Save checks both expected revisions and commits its scope and shared
connections/presets together, or changes neither. Stale saves preserve the draft.
Browser scopes are limited to 750 KB
of serialized UTF-8 JSON, leaving room under the 1 MiB native-message limit.
Connection names and presets share the same stale-save revision. An unrelated scope
can change concurrently without being overwritten. Both adapters stage and flush
the complete JSON before replacement; validation or staging failure retains the
previous document. Chrome-local credential writes remain separate and report
uncertain completion without replay. There is no background process or settings
database migration. Upgrade both apps/helper before relying on this guarantee;
an older writer does not honor the lease.

Saul stores preferences, connection metadata, actions and non-plan model presets
in its settings scope. Custom API keys and local credential bindings remain in trusted Chrome storage;
shared official credentials remain in the signed Saul owner. Connection keys are restored only for the same connection
and endpoint. Shared Connection and Preset definitions come only from `modelPresets`.
For standalone browser connections, Saul’s `connectionProfiles` maps shared keys to local API profile IDs without
copying credentials. It adopts only the already-selected official OpenAI endpoint
or an explicit profile choice. EZ stores actions and configuration choices in its scope; its old configuration file is retained for
recovery after migration. Neither app needs the other running.

Call presets retain approved action source/revision and a model-preset reference.
Saul's built-in Summarize remains selectable. Builder drafts, partial generation,
errors and progress remain Chrome runtime state. Without the optional config
helper, API-only Saul keeps its existing local settings and call library. Once
unified settings are adopted, helper loss blocks saves rather than silently
changing configuration owners.

Further sharing candidates are literal action preparation and presentation
preferences. Action input contracts differ between apps; browser Call actions
and native template actions retain their runtime contracts. They remain app-scoped. Min Mode, EZ shortcuts,
window placement and board layout still use app-local stores. Credentials, history and active execution are outside the unified config. Saved history uses the [shared SQLite store](../docs/architecture.md#shared-history).

### Example configurations

[`config.example.json`](../config.example.json) is a credential-free complete shared
configuration with two account-independent model presets and separate Saul/EZ
actions. [`config.calls.json`](fixtures/config.calls.json) adds a saved Call preset
that returns a source title without inference. Summarize remains selected by default;
the sample module is not pre-approved and is initialized only on explicit selection.
Both examples are loaded by TypeScript and Swift production-store tests in temporary
folders. Model names/options are illustrative; execution still checks the account's
current catalog. They are not an account backup or an import command. Do not replace
a personal settings file with an example; preserve existing presets, IDs and revisions.

The product term is Action. Legacy serialized keys (`recipes`, `recipeSnapshot`)
and app-specific type names remain stable for migration. Write/Draw/Speak are domain
capabilities, separate from transport endpoints such as Responses and Images.

[Image-option fixtures](fixtures/image-options.json) pin accepted string values and
reject coercible arrays, unknown fields and null. Both stores preserve rejected
input bytes rather than silently normalizing unsupported settings.

[Speech-option fixtures](fixtures/speech-options.json) pin the Realtime voice list
and reject null, arrays, unknown fields and unsupported values in both stores.
Missing `speechOptions` uses Marin in the preview; the model is always explicit.
