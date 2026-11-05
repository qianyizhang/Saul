# EZ

A small native Mac app for definitions, spelling checks, and quick answers.
SwiftUI UI, direct OpenAI Responses API, and history saved on your Mac.

The [surface contract](docs/surfaces.md) defines the **main window** and
**Quick Lookup panel**, their core functions, and their shared workspace.

This app lives in `apps/ez`; run the commands below from that directory.
See the [monorepo setup guide](../../docs/setup.md) for component selection.

## Run

Requires macOS 14+ and Apple Command Line Tools with Swift 6.3+ (`xcode-select --install`).
The app has no third-party runtime packages. Write actions use ChatGPT sign-in or
an explicit OpenAI API preset. Draw and web search use an OpenAI API key with
separate billing. No Codex installation is needed.

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

In EZ, open **Settings → Connections → ChatGPT plan → Set up**, finish sign-in
in your browser, and allow ChatGPT plan usage. Choose an action, fill its inputs,
then press **⌘ Return**. **Min Mode** is on by default: the draft sits below
the new-lookup heading, answers get a quiet reading view, and **Details** holds
request settings, token counts, and timing. Turn it off in Settings → Preferences or Quick
Lookup's actions menu to restore extra guidance and the persistent metrics footer.
The choice is saved on this Mac. Check Connections → ChatGPT plan → More → Usage for ChatGPT plan
allowance. Metrics are saved with new lookups; older history has no metrics.
**⌘ N** starts a new lookup and **⌘ .** stops generation.
Settings uses the same focused design as Saul: Overview, Presets, Actions,
Preferences, Connections and Shortcuts. One editor is shown at a time and section
changes preserve drafts. Min Mode assumes a familiar user: everyday controls
stay visible, with one-word or symbol-only actions. Turn Min Mode off for explanatory help.

**Research** searches the web on each Run and returns clickable inline citations.
Its API Write preset is explicit; missing search/model access fails without changing
providers. **Settings → Actions → Search the web** enables this for other Write
actions. Search-enabled follow-ups search again and add API/search charges.

**Make meme** accepts a sketch plus instructions. Drop, paste or choose one PNG,
JPEG or WebP (up to 20 MB), then Run. Attachments prepare a draft without sending.
The source is saved with History for Reuse; deletion removes that saved copy and
the generated PNG. Your original file remains yours. **Settings → Actions → Image
input** adds a named required image to other Draw actions. Existing text-only
Illustration still generates from a prompt. Both starters are editable and added
once; removing them is respected.

Selected answers open in a reading view. **Edit** reveals your current inputs;
**Hide** returns to reading, and **More → Reuse** restores the saved request.
**Details → Inspect** shows the saved instructions, input fields, assembled
prompt and literal response with per-section Copy. It is also in Quick Lookup's
Details popover, including for incomplete answers.
You can copy answers, export Markdown, and search previous lookups. To delete a
lookup, use **More → Delete lookup** below its answer or right-click its history row, then
confirm. Deletion removes its saved snapshots from this Mac and cannot be undone;
it is unavailable while a request or launcher submission is active. Your current
draft is preserved.

If an answer cannot be saved, it stays marked **Unsaved** with **Save** (Save again in Standard view).
That action retries only the local save; it never generates another answer. New
lookup and History keep the answer available in memory. Save or export it before
quitting EZ.

Completed Spell Check answers with recognized corrected-text or changes labels
show an Original / Corrected comparison: paragraph-aligned columns, highlighted
edits, and expandable explanations. Narrow windows show the correction first.
Other response formats keep the normal reading view; Copy and Export retain the
full response. Long original passages sit behind **Original text**.

For quick access while EZ is running, press **⌃⌥ Space** (Control–Option–Space)
or choose **Quick Lookup** from EZ’s menu-bar icon. Type or paste text and press
**⌘ Return** after filling the action's inputs. The panel starts small and grows
for results; long forms and answers scroll. Choose a preset override in the panel’s
preset selector. Click its information button for exact request choices and the
displayed answer's actual service tier. In Min Mode, an answer hides the input
fields until **Edit**; **New**, **Stop**, and **Copy** stay reachable as
appropriate. Use the
actions menu for Settings. **Esc** hides the panel and returns keyboard focus to
your work. A running answer continues while hidden; **⌘ .** stops it. **⌘ N** starts
a new lookup. Invoking Quick Lookup through the shortcut or menu starts an empty
lookup when idle: it clears previous inputs and the displayed answer, keeps the
selected action, restores its default preset, and focuses the first input. With
Accessibility access, selected text from the active app fills the first input when
that app supports it; otherwise the input stays empty. Enable access through
**Settings → Shortcuts → Accessibility settings**. This reads only on invocation,
leaves the clipboard alone, and never sends automatically. A running
request or pending launcher submission is preserved. Previous answers remain in
History. Pressing the shortcut while the panel has focus hides it. Drafts and answers
are shared with the full window. Use its history button to open the main window. Closing
the full window leaves EZ available through the menu bar; **Quit EZ** exits it.
If another app holds the shortcut, EZ displays a warning and menu access still works.

### Query from Raycast

With EZ installed at `~/Applications/EZ.app`, add this repository's
`integrations/raycast` folder in **Raycast Settings → Script Commands** (under
Extensions in Raycast v1). Give **EZ Lookup** the alias **ez**. Then open Raycast,
type **ez**, press **Space**, type your query, and press **Return**. EZ launches if
needed and streams the answer in its compact panel. On macOS 15+, a cold launcher
start suppresses the full window; macOS 14 may also display the full window.

The command fills the selected action’s first input and uses its preset and the
selected provider. A single-field Write action submits immediately; a Draw or multi-field action
opens the panel for you to complete the remaining inputs and explicitly Run.
After restart, EZ selects the first remaining action. Raycast does not generate or bill for the
answer. Return explicitly submits single-field Write actions through the selected provider
flow. An in-progress lookup is preserved and a second submission is refused.
If sign-in, model loading, or history storage blocks sending, the panel shows the
error and retains your query for manual retry. It does not send later on sign-in.
Escape hides the panel. The command pins the installed app, so an indexed build
in `dist` cannot steal the submission. See [Raycast integration](docs/raycast.md).

The signed Saul credential owner accesses shared sign-ins and the API key.
Keychain denial blocks affected requests while keeping history and drafts available.
See the [credential ownership contract](../../contracts/credentials.md) for migration,
signing continuity and removal behavior.

ChatGPT plan access depends on account eligibility and rollout. The integration
uses OAuth with explicit `chatgpt.tokens.use.direct` permission, then
`POST https://api.openai.com/v1/responses` with `store: false` and `stream: true`.
Fast requests priority service only when advertised by the model catalog; it can
consume more allowance and is not a guarantee of latency. Use **Manage usage** in
settings to inspect your app allowance. No fallback API billing is configured.

### Look up selected text

Select text in another Mac app, then choose **Services → Look Up in EZ** from
that app's menu (or its selection's contextual menu, when offered). EZ opens
Quick Lookup and fills the selected action's first input. Complete any remaining
fields and press **⌘ Return** to Run. Invoking the service never submits a request,
including after sign-in. It uses the action's default preset; normal unavailable
model/account/storage checks still apply when you Run.

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

## Illustration

Choose **Illustration** in the Action picker. Save your OpenAI API key in
**Settings → Connections → OpenAI API**, fill Context and click **Run** (⌘Return).
Saving a key refreshes its model catalog; Check retries discovery without generating output. API usage is billed
separately from ChatGPT plan usage. Each Run requests one image. Choose **PNG** or **GIF · animated** in the Draw composer.

**Settings → Presets → Illustration** owns the image model and optional size/quality.
New starters use low quality and 1024×1024; choose a model from the live catalog. Existing presets retain
their saved model; choose a 2.6 model in Presets for GIF output. Access depends on your API project
and organization. **Stop** (⌘.) cancels locally; OpenAI may still finish and bill an
accepted request. There are no automatic retries.

The result appears in the same History and Quick Lookup as text. **Download**
exports its original PNG or GIF; **Details** shows frozen inputs and settings. **Reuse**
restores a draft without sending. Draw actions always wait for Run after launcher
input. Images are saved as blobs in shared SQLite history; deleting a run removes its owned
image bytes. GIF is generation-only; image edits require PNG.
If saving fails, **Unsaved → Save again** retries the exact result without generation.
Save or download unsaved results before quitting.

## Configure connections, presets and actions

**Connections** shows a capability line, an account email or endpoint/key suffix, status,
and Check. Add another connection for another account or endpoint. Existing identities
are fixed; More contains sign-in or key replacement. The signed Saul owner manages
credentials and token refresh. Helper and app-binding controls live in Preferences → Integrations.

**Presets** binds a connection, Write/Draw/Speak, model and supported options. Connections
and presets share the local store and stale-save revision with Saul; both apps and the
helper must use compatible builds. Models refresh from each connection's catalog.
Removed models remain in saved presets with an explicit repair warning; no model or
account is substituted. Unbound old plan connections require an explicit account choice.

Both apps edit and execute Draw. Speak presets offer short-text generation and deliberate
playback in Settings → Presets. Audio and preview text remain in memory and are never
saved to history. API speech is billed separately from ChatGPT plan usage.

**Actions** owns instructions, type and a compatible default preset. Use
`{{fuzzy term}}` and `{{fuzzy context}}` to generate two required inputs. Repeated
names share one field; substitution is literal, without expressions. Save edited
items explicitly. Section changes preserve drafts; changing items or closing asks
before discard. History and Reuse retain original action, inputs and preset.
Starters are editable/removable. Illustration is added once during migration and
is not restored after deletion. Action chaining is out of scope.

## Selectors and keyboard shortcuts

Scroll over an action, preset, model, effort, or account dropdown
to move through its choices without opening the menu. Wheel selection stops at the
ends; trackpad momentum is ignored. Disabled selectors stay locked. Scrolling the
compact panel’s preset selector changes the override directly; the adjacent
information button opens details. Each native selector keeps its allocated width
and full click/scroll target when labels change.
Settings sidebar sections and editor rows use full-row click targets, independent
of selection or title length. Configuration edits still require Save.

A **lookup** is an independent request and answer; a **action** is a reusable prompt.
Both lookup surfaces offer **Ask a follow-up** below a completed answer. Send or
⌘Return from the field includes the saved request and earlier exchanges with the
same model/effort/speed, using the currently selected local account. Each follow-up
is a linked history entry; **Previous answer** returns to its parent. Draft questions
are shared across the panel and main window and survive dismissal during the app
session. They clear when sent or the parent is deleted. Questions allow 2,000
characters; conversations stop at 120,000 characters without dropping context.
Stop and save recovery use the same
lookup lifecycle. No question is sent on opening or switching surfaces.

| Action | Default shortcut |
| --- | --- |
| New run | ⌘N |
| Run / send follow-up | ⌘Return |
| Stop generation | ⌘. |
| Previous / next action | ⌘⇧[ / ⌘⇧] |
| Action at position 1–8 | ⌘1–8 |
| Last action | ⌘9 |

Open **Settings → Shortcuts** to record replacements, clear bindings, or restore
defaults. **Use Chrome navigation** assigns ⌘⌥← / ⌘⌥→ to previous/next action.
You can assign ⌘T to New lookup if you prefer Chrome’s new-tab key. Shortcuts work
while typing in either lookup surface. The Lookup menu and action hints reflect
custom bindings. Settings and modal sheets suspend lookup shortcuts so recording,
editing, and confirmations take priority. Text-editing and reserved app keys cannot
be reassigned; conflicts are reported without saving. Shortcut changes save immediately.

Previous/next wraps in Configuration order; numbered bindings follow that order,
and missing positions do nothing. Selecting the current action leaves the draft
intact. Selecting another action clears inputs and restores its default preset;
action navigation and New are blocked while a request or launcher submission is active.
Global Quick Lookup (⌃⌥Space), Settings (⌘,), and panel hiding (Esc / ⌘W) remain fixed.
New lookup follows [VS Code’s new-item shortcut](https://code.visualstudio.com/shortcuts/keyboard-shortcuts-macos.pdf).
Numbered and last-item navigation follow [Chrome’s shortcuts](https://support.google.com/chrome/answer/157179).

## Local data

- Shared history and input/output images: `~/Library/Application Support/Little Clarity/history.sqlite3`, owner-only. Saul and EZ browse the same saved records. The old JSONL/images are removed after verified migration.
- API key and ChatGPT registrations: separate shared Keychain records accessed only by the signed Saul credential owner. Former EZ-owned records are migration sources; see the [credential contract](../../contracts/credentials.md).
- Shared model presets: owner-only `~/Library/Application Support/Little Clarity/settings.json` → `modelPresets`.
- EZ actions/configuration: the same file → `apps.ez.configuration`; the old `EZ/configuration.json` remains a migration recovery copy.
- Keyboard bindings: owner-only `~/Library/Application Support/EZ/shortcuts.json`.
- Previous model/effort/Fast preferences seed the initial Current preset.
- Build products: ignored `.build/` and `dist/`; regenerate them with `make app`.

History stores one SQLite row per lookup. A pending request is saved before sending;
the terminal snapshot updates that row. Abandoned pending requests appear interrupted
on restart. Deletion removes the owned row and image blobs in a transaction. New runs
send their current inputs; explicit follow-ups also include their saved conversation
context. Local history is plaintext and is not encrypted by EZ.

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
