# Shared behavior and interfaces

This is the shared semantic contract, implemented in TypeScript and Swift.
Model presets use one local store; credentials, recipes and history remain app-owned.

## Recipe preparation

The conceptual interface accepts a recipe, supplied inputs and an explicit preset;
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
from a form. This migration does not erase those semantics or claim recipe interchange.

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

Concurrency, source capture, anchors and storage engines are app-specific.

[Attempt fixtures](fixtures/attempts.json) run through both production execution
owners: Saul's ReadingRunner and EZ's AttemptExecution via AppModel actions. They
cover initial-save failure, completed and saved output, terminal-save failure,
provider failure, missing completion and cancellation. The common assertions are
provider-call count, retained output and saved success, not matching status enums.
EZ projects a failed terminal save as **Unsaved** and retries only that frozen
terminal record. Saul retains its existing failed/save-failed projection and
durable recovery before an explicit new attempt. Neither app reports saved success
from a provider completion signal alone.

## Accounts and models

ChatGPT model presets share `~/Library/Application Support/Little Clarity/settings.json`.
The JSON document has a `modelPresets` section containing `revision` and `presets`.
Preset saves preserve all other sections. Each preset has a UUID `id`,
`name`, `model`, `effort` (empty means Default), and `fast`. Only these fields cross
apps. Saves replace the file atomically; stale editor revisions require Reload and
preserve the draft. This beta uses last-save-wins if both apps save simultaneously;
there is no sync service or cross-process transaction manager.

Both editors show Model, Effort and Standard/Fast speed. Fast is selectable only
when the account catalog advertises it. Unsupported saved choices remain visible
and block execution. New model selections prefer advertised none/minimal/low,
then the advertised default, then the first effort, and start at Standard.

Each app imports its old ChatGPT presets once. Duplicate names get numeric
suffixes; preset IDs and recipe references are preserved or remapped locally.
After migration the shared store owns these presets. Deleted presets stay deleted;
recipes referencing them need another explicit choice. Imported presets in Saul
need an explicit local account selection. API and on-device presets remain Saul-owned.
Swift and Node read the same JSON file; Saul accesses it through its existing ChatGPT helper.
Neither app needs the other app running. Settings load/reload and new requests
read the current store; EZ also reads on activation outside Settings. Open editors
keep their drafts until Save or Reload. Historical and prepared requests stay frozen.

The conceptual interface exposes identity, permission, available models and
supported options, then resolves an explicitly selected local connection for
execution. Sign-in and plan-use permission are separate. Unsupported model,
effort, account or tier blocks; no silent provider, account or billing fallback.
Credentials stay outside prompts, saved results, shared fixtures and exports.

Shared account labels and disclosure rules live in [DESIGN.md](../DESIGN.md).
An optional shared implementation must satisfy the
[replacement contract](../docs/architecture.md#optional-shared-capabilities) before
an app can opt into it. No account sharing or credential migration ships here.

## Presentation

[DESIGN.md](../DESIGN.md) owns visual roles and interaction semantics, including
Minimum Mode, action placement, focus, error disclosure and input/output inspection.
Platform controls and density remain bespoke. Build/fixture checks do not establish
native visual or live-provider acceptance.
