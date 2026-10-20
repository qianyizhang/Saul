# EZ

A small native Mac app for definitions, spelling checks, and quick answers.
SwiftUI UI, direct OpenAI Responses API, and history saved on your Mac.

The [surface contract](docs/surfaces.md) defines the **main window** and
**Quick Lookup panel**, their core functions, and their shared workspace.

This app lives in `apps/ez`; run the commands below from that directory.
See the [monorepo setup guide](../../docs/setup.md) for component selection.

## Run

Requires macOS 14+ and Apple Command Line Tools with Swift 6.3+ (`xcode-select --install`).
The app has no third-party runtime packages and needs no API key or Codex installation.

```sh
make tools
make check
make app
open dist/EZ.app
```

For a persistent installation at `~/Applications/EZ.app`, follow the one-time
[local signing setup](docs/releasing.md#local-signing-and-installation), run
`make signing-setup`, quit EZ, then run `make install`. Future upgrades use
`make install` and reuse the pinned signing identity. This preserves app identity;
self-signing alone does not prevent Keychain prompts after upgrades. See
[the Keychain limitation](docs/keychain.md#why-a-rebuild-can-ask-again).
The previous installed bundle is retained for rollback.

In EZ, open **Settings → Account & history → Continue with ChatGPT**, finish sign-in
in your browser, and allow ChatGPT plan usage. Choose a recipe, fill its inputs,
then press **⌘ Return**. **Minimum Mode** is on by default: the draft sits below
the new-lookup heading, answers get a quiet reading view, and **Details** holds
request settings, token counts, and timing. Turn it off in Settings or Quick
Lookup's actions menu to restore extra guidance and the persistent metrics footer.
The choice is saved on this Mac. Check Settings → Manage usage for ChatGPT plan
allowance. Metrics are saved with new lookups; older history has no metrics.
**⌘ N** starts a new lookup and **⌘ .** stops generation.
Selected answers open in a reading view. **Edit draft** reveals your current inputs;
**Hide draft** returns to reading, and **Use again** restores the saved request.
**Inspect input/output** shows the saved instructions, input fields, assembled
prompt and literal response with per-section Copy. It is also in Quick Lookup's
Details popover, including for incomplete answers.
You can copy answers, export Markdown, and search previous lookups. To delete a
lookup, use **More → Delete lookup** below its answer or right-click its history row, then
confirm. Deletion removes its saved snapshots from this Mac and cannot be undone;
it is unavailable while a request or launcher submission is active. Your current
draft is preserved.

Completed Spell Check answers with recognized corrected-text or changes labels
show an Original / Corrected comparison: paragraph-aligned columns, highlighted
edits, and expandable explanations. Narrow windows show the correction first.
Other response formats keep the normal reading view; Copy and Export retain the
full response. Long original passages sit behind **Original text**.

For quick access while EZ is running, press **⌃⌥ Space** (Control–Option–Space)
or choose **Quick Lookup** from EZ’s menu-bar icon. Type or paste text and press
**⌘ Return** after filling the recipe's inputs. The panel starts small and grows
for results; long forms and answers scroll. Choose a preset override in the panel’s
preset selector. Click its information button for exact request choices and the
displayed answer's actual service tier. In Minimum Mode, an answer hides the input
fields until **Edit draft**; **New**, **Stop**, and **Copy** stay reachable as
appropriate. Use the
actions menu for Configuration. **Esc** hides the panel and returns keyboard focus to
your work. A running answer continues while hidden; **⌘ .** stops it. **⌘ N** starts
a new lookup. Drafts and answers are shared with the full window, and reopening
the panel preserves them. Use its history button to open the main window. Closing
the full window leaves EZ available through the menu bar; **Quit EZ** exits it.
If another app holds the shortcut, EZ displays a warning and menu access still works.

### Query from Raycast

With EZ installed at `~/Applications/EZ.app`, add this repository's
`integrations/raycast` folder in **Raycast Settings → Script Commands** (under
Extensions in Raycast v1). Give **EZ Lookup** the alias **ez**. Then open Raycast,
type **ez**, press **Space**, type your query, and press **Return**. EZ launches if
needed and streams the answer in its compact panel. On macOS 15+, a cold launcher
start suppresses the full window; macOS 14 may also display the full window.

The command fills the selected recipe’s first input and uses its preset and the
current account. A single-field recipe submits immediately; a multi-field recipe
opens the panel for you to complete the remaining inputs and explicitly Send.
After restart, EZ selects the first remaining recipe. Raycast does not generate or bill for the
answer. Return explicitly submits single-field recipes through EZ’s existing ChatGPT plan
flow. An in-progress lookup is preserved and a second submission is refused.
If sign-in, model loading, or history storage blocks sending, the panel shows the
error and retains your query for manual retry. It does not send later on sign-in.
Escape hides the panel. The command pins the installed app, so an indexed build
in `dist` cannot steal the submission. See [Raycast integration](docs/raycast.md).

macOS may ask whether **EZ** can access its Keychain item to save or restore your
sign-in. EZ queries only its own credential record. Locally signed development
rebuilds can trigger another prompt; refusing access keeps history available but
prevents the saved sign-in from loading.
See [Keychain access](docs/keychain.md) for the stored data, permission choices,
and why a rebuild can ask again. The same explanation is available in Settings.

ChatGPT plan access depends on account eligibility and rollout. The integration
uses OAuth with explicit `chatgpt.tokens.use.direct` permission, then
`POST https://api.openai.com/v1/responses` with `store: false` and `stream: true`.
Fast requests priority service only when advertised by the model catalog; it can
consume more allowance and is not a guarantee of latency. Use **Manage usage** in
settings to inspect your app allowance. No fallback API billing is configured.

### Look up selected text

Select text in another Mac app, then choose **Services → Look Up in EZ** from
that app's menu (or its selection's contextual menu, when offered). EZ opens
Quick Lookup and fills the selected recipe's first input. Complete any remaining
fields and press **⌘ Return** to Send. Invoking the service never submits a request,
including after sign-in. It uses the recipe's default preset; normal unavailable
model/account/storage checks still apply when you Send.

The service reads the selection's dedicated Services pasteboard. It does not read
or change your clipboard, replace the source selection, or require Accessibility
permission. It accepts nonblank text up to 16,384 UTF-8 bytes and preserves its
spacing and Unicode. Existing drafts, active requests, sign-in, and open EZ Settings
are preserved: finish active work, choose **New lookup** to clear any draft, and close
Settings before invoking the service again. Sending retains the draft inputs.
No incoming selection is queued for later.

Install with `make install`, then open the installed EZ once to register the service.
If it is hidden, enable **Look Up in EZ** under **System Settings → Keyboard →
Keyboard Shortcuts → Services → Text**; a custom Services shortcut can be assigned
there. Availability depends on the source app exposing selected text to Services.
A cold start may also show EZ's main window.

## Configure presets and recipes

Open **Settings → Configuration**. A **model preset** names a model, effort, and
Fast/Standard choice, for example `lit`. A **recipe** selects a default preset and
contains the entire prompt. Add `{{fuzzy term}}` and `{{fuzzy context}}` to create
two inputs with those placeholders. Repeated names share one field; all fields
are required. Templates support substitution only, without Jinja expressions.
Save each edited preset/recipe explicitly. Unsaved edits survive Settings section
changes; switching items or closing Settings asks before discarding them.
The input preview shows the generated form.

Dictionary, Spell Check, Ask, and Lookup are editable/removable starters. They are
not restored after removal. Select a recipe during use; the preset picker can
override its default until New lookup or another recipe is selected. Unavailable
saved model/effort/Fast choices block sending rather than silently changing them.
History and Use again preserve the original recipe, inputs, and preset. See
[configuration decisions](docs/adr/0002-model-presets-and-recipes.md).

## Selectors and keyboard shortcuts

Scroll over a recipe, preset, model, effort, account, or Settings section selector
to move through its choices without opening the menu. Wheel selection stops at the
ends; trackpad momentum is ignored. Disabled selectors stay locked. Scrolling the
compact panel’s preset selector changes the override directly; the adjacent
information button opens details. Each native selector keeps its allocated width
and full click/scroll target when labels change.
Configuration edits still require Save.

A **lookup** is an independent request and answer; a **recipe** is a reusable prompt.
Lookups do not yet have conversation follow-ups.

| Action | Default shortcut |
| --- | --- |
| New lookup | ⌘N |
| Send | ⌘Return |
| Stop generation | ⌘. |
| Previous / next recipe | ⌘⇧[ / ⌘⇧] |
| Recipe at position 1–8 | ⌘1–8 |
| Last recipe | ⌘9 |

Open **Settings → Shortcuts** to record replacements, clear bindings, or restore
defaults. **Use Chrome navigation** assigns ⌘⌥← / ⌘⌥→ to previous/next recipe.
You can assign ⌘T to New lookup if you prefer Chrome’s new-tab key. Shortcuts work
while typing in either lookup surface. The Lookup menu and action hints reflect
custom bindings. Settings and modal sheets suspend lookup shortcuts so recording,
editing, and confirmations take priority. Text-editing and reserved app keys cannot
be reassigned; conflicts are reported without saving. Shortcut changes save immediately.

Previous/next wraps in Configuration order; numbered bindings follow that order,
and missing positions do nothing. Selecting the current recipe leaves the draft
intact. Selecting another recipe clears inputs and restores its default preset;
recipe navigation and New are blocked while a request or launcher submission is active.
Global Quick Lookup (⌃⌥Space), Settings (⌘,), and panel hiding (Esc / ⌘W) remain fixed.
New lookup follows [VS Code’s new-item shortcut](https://code.visualstudio.com/shortcuts/keyboard-shortcuts-macos.pdf).
Numbered and last-item navigation follow [Chrome’s shortcuts](https://support.google.com/chrome/answer/157179).

## Local data

- Queries/answers: `~/Library/Application Support/EZ/history.jsonl`, owner-only.
- Credentials, issued client IDs, and host ID: macOS Keychain (`local.ez.app.chatgpt`).
- Model presets and recipes: owner-only `~/Library/Application Support/EZ/configuration.json`.
- Keyboard bindings: owner-only `~/Library/Application Support/EZ/shortcuts.json`.
- Previous model/effort/Fast preferences seed the initial Current preset.
- Build products: ignored `.build/` and `dist/`; regenerate them with `make app`.

History uses append-only snapshots during requests: a query is saved before
sending, followed by a terminal snapshot with the same ID. The latest valid
snapshot wins; abandoned pending requests appear interrupted on restart.
Explicit deletion atomically rewrites the
file to remove all snapshots with the selected ID. Unrelated bytes, including
damaged lines with no identifiable ID, are preserved. Queries are sent to OpenAI;
previous lookups are not sent. Local history is plaintext; it is not encrypted by EZ.

## Development

```sh
make tools        # Checksum-pinned development linters
make format
make check        # Lint, strict build, offline core/state and install checks
make app          # Build and locally sign dist/EZ.app
```

Inside an agent sandbox that rejects nested SwiftPM sandboxing, prefix commands
with `EZ_SWIFTPM_DISABLE_SANDBOX=1`; this keeps the outer sandbox active.
After `make clean`, restore linters with `make tools`.

Install shared Git hooks from the monorepo root with `bash scripts/install-hooks.sh`.

See [contributing](CONTRIBUTING.md) for setup, tool pins, hooks and CI;
[testing](Tests/README.md) for focused checks;
[design](docs/design.md) for disposable native previews;
[architecture](docs/architecture.md) for implementation contracts;
[verification](docs/verification.md) for evidence and acceptance gaps;
and [releasing](docs/releasing.md) for signing and distribution.
Future candidates live in the [roadmap](docs/roadmap.md).
Development tools add no runtime dependencies to the app.

## Official integration references

- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts and refresh](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and Responses](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview constraints](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

This is a local personal project. No distribution license has been selected.
A release for other people requires the steps in the release guide.
