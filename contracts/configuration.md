# Shared configuration

Swift and Node share `~/Library/Application Support/Little Clarity/settings.json`.
Saul uses its history/configuration helper to access it. Each app reads saved settings on
load/reload and for new work; EZ also reloads on activation outside Settings.
An open editor retains its draft until explicit save or recovery.

## Connections and presets

`modelPresets` owns the common `revision`, `connections` and `presets`.

- **Connection:** stable `key`, `name`, `kind` (`chatgpt-plan` or `openai-api`),
  with optional pinned `accountId` for plan or `baseUrl` for API. The defaults
  use keys `gpt-plan` and `openai-api`. A bound account or endpoint cannot be
  retargeted. Add another connection instead; unbound legacy entries require
  an explicit choice. The shared list wins over EZ's legacy list after import.
- **Preset:** UUID `id`, `name`, `model`, `effort` (empty means Default),
  `fast`, and optional `connectionKey`, `capability`, `imageOptions` and
  `speechOptions`. Omitted typed fields decode as `gpt-plan` / Write. Presets
  never contain secrets. [Connections](fixtures/connections.json) tests pin
  the stable binding in both runtimes.
- **Write:** Plan and custom chat-completions endpoints support Write; official
  OpenAI also supports Draw and Speak. New model selections use advertised
  none/minimal/low, then advertised default, then first available effort;
  start at Standard. Plan Fast requires catalog support. EZ API Write can request
  priority. Saul preserves API effort and Fast options it cannot run and blocks
  execution rather than silently dropping them.
- **Draw:** `imageOptions` holds size, quality and optional `outputFormat`.
  [Fixtures](fixtures/image-options.json) pin square/landscape/portrait,
  low/medium/high, and PNG/GIF, rejecting arrays, unknown fields and null without
  rewriting the file. Default is PNG. GIF requires GPT Image 2.6 and no source
  image; API defaults are 9 frames at 200 ms. Both apps freeze the chosen format
  in the attempt and preserve returned bytes/media type. EZ additionally supports
  PNG image edits. New API starters require explicit choice of a catalog model.
- **Speak:** saved Realtime model and `speechOptions.voice`; absent voice
  options use Marin. [Fixtures](fixtures/speech-options.json) reject null, arrays,
  unknown fields and unsupported voices. Both apps offer deliberate Settings
  playback without preview history; Speak is distinct from Write.

Keep unsupported or removed saved choices visible for repair. The [credential
contract](credentials.md#connection-identity-and-catalogs) owns catalog discovery,
refresh and lifetime. Catalog membership does not itself establish protocol
support. Use [frozen attempt routing](actions-and-attempts.md#execution) for
execution and retry.

- **Rename connection** changes its display name and preserves the key.
- **Move presets** changes the selected presets’ connection keys in one settings
  save. The destination must support their capabilities. The move preserves preset
  IDs, model choices and options. Unavailable choices stay visible for repair.
  Connections shows how many presets in that app use each connection. **Move
  presets** appears for sources with at least one preset; an empty connection
  can still be a destination. Saul also counts its browser-local presets.
- **Delete connection** removes the definition after its saved preset references
  have been moved or removed, including browser-local preset references in Saul’s
  settings. Sign-out and API key removal are separate credential operations.

## Unified configuration scopes

The scoped sections are `apps.saul.settings`, `apps.saul.calls` and
`apps.ez.configuration`. Each has a numeric `revision` and object `value`.
Save checks the shared and affected scope revisions together. It stages and
flushes a whole-document replacement, preserving sibling scopes and unknown
root fields. Invalid or stale saves leave the document intact and preserve the
draft. Browser scopes are capped at 750 KB of serialized UTF-8 JSON under the
1 MiB native-message limit.

Swift and Node use a SQLite `BEGIN IMMEDIATE` lease in
`settings.json.lock.sqlite3`, with a five-second busy timeout and no settings
data. Process exit releases the lease. Keep the lock file in place while either
app may use it; removing it splits the lock. Upgrade both clients and the helper
before relying on this guarantee; old writers ignore the lease or cannot read
new binding fields. Chrome-local commits are separate; Saul reports uncertain
effects without replay and offers [Settings review](../apps/saul/docs/product.md#settings-and-models).

Shared definitions come only from `modelPresets`. Saul's scope owns local
settings, actions, bindings and app-local presets. Its `connectionProfiles`
maps shared keys to local profiles without copying secrets, adopting only an
already selected official endpoint or an explicit profile choice; a credential
remains bound to its connection and endpoint. Call source/revision and preset
references live in the Calls scope. Builder drafts and active execution stay
in the browser runtime. API-only Saul can use local settings without the
configuration helper; after adoption, helper loss blocks saves. EZ's scope owns
its actions and configuration choices. Min Mode, native shortcuts, window
placement and board layout use app-local stores. History and credentials are
separate owners.

## Connection data upgrades

Each app imports its old ChatGPT presets once. Duplicate names get numeric
suffixes; IDs and action references are preserved or remapped locally. Deleted
presets stay deleted; referencing actions require an explicit new choice.
Legacy EZ definitions seed the shared list only if absent. EZ retains its old
configuration file for recovery.

Configuration and history consume legacy connection fields once, retaining
IDs, model choices and user input. Conflicting old and new fields block upgrades
and preserve the source. Wire/runtime types use canonical names. Serialized
`recipes` and `recipeSnapshot` remain stable. See [setup](../docs/setup.md#shared-history-upgrade)
before opening data with a changed schema.

## Examples

[Shared settings](../config.example.json) and [example Call](fixtures/config.calls.json)
are credential-free production-store fixtures for Swift and TypeScript. The
example Call returns the title without inference; its code remains unapproved
until explicitly selected. Models are illustrative and still require catalog
support. The examples are not backups or import commands.
