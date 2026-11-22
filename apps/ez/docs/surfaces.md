# EZ surfaces and use

[Glossary](../GLOSSARY.md) owns names; [architecture](architecture.md) owns execution
and persistence; [design](design.md) owns presentation.

| Surface                | Responsibility                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Quick Lookup panel** | Compact Action/Preset and input selection, Run/Stop, reading, Copy/Download and Details. Open the main window for management. |
| **Main window**        | Lookups plus history search, reuse, export, deletion and Settings. Own feature growth, configuration and connections.         |

## Shared workspace

- Both surfaces share inputs, image, action, preset override, selected answer,
  history, account, per-answer follow-up draft and one active request. Handoff
  preserves work. Switching surfaces never sends.
- Make meme shares one Sketch draft. The main window owns the canvas; Quick Lookup
  can preview, paste or run, and Edit sketch opens the same draft in the main window.
  After a run, Edit draft shows the canvas again; Hide draft returns to the answer.
- Selecting another action or New restores its default preset. Unavailable choices
  block; never substitute account, model, billing or tier.
- Both composers put Action and Preset above inputs. Edit/Hide keeps the draft;
  Reuse restores saved input without sending.
- The main reader shows available Copy or Download, Reuse, Export and Delete in
  one row in both modes. Delete appears for history records at the far edge and
  confirms shared deletion. Details holds the record and inspection, followed by the follow-up.
  Quick Lookup hides inputs while reading in Min Mode and keeps its utilities
  menu and workspace handoff. New/Stop remain reachable.
- Settings → Preferences and the panel menu change the same local
  [Min Mode](design.md#min-mode-and-settings) preference. Details retains exact
  model, tier and metrics.
- Compact layout grows for forms/results/notices; long content scrolls while
  Run/Stop stay reachable. Preset and requested speed remain identifiable.
- Both surfaces offer follow-ups for saved completed native Write answers and
  Previous answer navigation. Draw has no text follow-up. Follow-up context and
  limits belong to [architecture](architecture.md#follow-ups).
- A failed request shows the error and Retry in the current result. Its History
  row drops out after cleanup. A failed history write or cleanup shows Unsaved
  and the storage error. Use Copy, Export or
  Download when output is available. A new Run makes a new request.
  See [persistence](architecture.md#persistence-contract).

## Invocation and lifecycle

| Entry point           | Idle behavior                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Shortcut/menu         | Start empty, keep action, reset preset; optionally fill first input from selected text with Accessibility access. Never submit.                |
| Raycast               | Fill first input; single-field Write submits, Draw/multi-field waits for explicit Run. See [Raycast](raycast.md).                              |
| Look Up in EZ Service | Fill first input from the dedicated Services pasteboard; always wait for Run. Reject existing drafts, active work and open Settings unchanged. |

Shortcut/menu invocation preserves running requests and pending launcher work;
the shortcut hides an already focused panel. Hiding preserves active work,
history and clipboard.
Closing the main window leaves menu-bar access. Stop is available while the
request is being saved or generated. When the outcome is decided, both surfaces
show Saving until history confirms it. Quit interrupts generation and gives the
app a short time to finish writing history before exiting.

The [Quick Lookup controller](../Sources/EZ/QuickLookupController.swift)
owns a nonactivating panel on the pointer's display, including full-screen Spaces
and focus restoration. It registers the global shortcut without monitoring keys
or requiring Accessibility for opening. [Selected text capture](../Sources/EZ/SelectedTextCapture.swift)
reads the external focused selection once, off the UI actor. It never reads
the clipboard, prompts for permission or submits. Dismissal, a new invocation,
or a changed draft rejects stale capture. The panel grows down from its top edge;
forms and answers scroll independently of actions.

## Connections and actions

In **Settings → Connections**, choose **Sign in again** on a saved connection
or **Add connection → ChatGPT plan** to use another account. Follow the shared
[sign-in and app naming steps](../../saul/docs/chatgpt-plan.md#setup).
Account eligibility and rollout govern access. **More → Usage**
opens the plan allowance view; Fast can consume more allowance without guaranteeing
latency. There is no fallback API billing.

Settings has Overview, Presets, Actions, Preferences, Connections and Shortcuts.
Connections shows capability, account or endpoint/key suffix, status and Check.
Add a connection for another identity. Use **More** to rename a connection,
move presets to another connection, or delete an unused connection. Sign-in
and key replacement also live in **More**.
Run and preset guidance use the connection saved on that preset. Check forces
discovery for its connection; a successful plan Check clears only that
account's pause and leaves Retry to the user. A sign-out warning about remote
revocation stays beside the locally signed-out account.
Helper and app-binding controls live in Preferences → Integrations. See the
[shared contract](../../../contracts/configuration.md#connections-and-presets) for identity,
catalog and preset guarantees.

See [Speak preview](design.md#speak-preview) for Settings playback.

Actions hold instructions, type and a compatible default preset. For example,
`{{fuzzy term}}` and `{{fuzzy context}}` create two required inputs; repeated names
share a field. Choose an action, fill its inputs and press **⌘ Return**. Save edited
configuration explicitly. Section changes preserve drafts; changing items or
closing asks before discard. Starters remain editable/removable and are added only
once. Action chaining is out of scope. See [template semantics](../../../contracts/actions-and-attempts.md#action-preparation)
and [native configuration](architecture.md#unified-configuration).

## Reading and inspection

**Details → Inspect** shows saved instructions, input fields, assembled prompt
and literal response with per-section Copy, including incomplete answers. It is
also available in Quick Lookup's Details popover, opened by the footer's information
button. That popover separates the selected answer's actual choices from Next lookup
settings. Metrics are saved with new
lookups; older history may have none. See [metrics](architecture.md#metrics-and-activity)
for their meaning.

The main-window history row also offers deletion through its context menu.
Deletion confirms removal from shared history, cannot be undone, and is blocked
while a request or launcher submission is active. The current draft is preserved.
[Persistence](architecture.md#persistence-contract) owns inference Retry, save failures
and restart behavior.

Completed Spell Check answers with recognized corrected-text or changes labels
show Original / Corrected columns, highlighted edits and expandable explanations.
Narrow windows show the correction first; long originals sit behind Original text.
Other response formats use the ordinary reader. Copy/Export retain the full
response. See the [comparison presentation](design.md#activity-and-answer-presentation).

## Image and search actions

**Research** searches on each Run and returns clickable citations. **Settings →
Actions → Search the web** enables it for other Write actions. Select an API Write
preset; search-enabled follow-ups search again and add API/search charges.

**Illustration** uses an API key under **Settings → Connections → OpenAI API**.
Key Save refreshes the model catalog; Check retries discovery without generating.
Choose the image model and size/quality under **Settings → Presets → Illustration**,
then fill Context and Run. The composer offers **PNG** or **GIF · animated**.
Download preserves the original format. Model/format constraints, defaults,
cancellation and billing limits belong to [Illustration architecture](architecture.md#connections-and-illustration).

**Make meme** accepts a Sketch plus instructions. Draw on the main-window canvas,
or paste, drop or choose a PNG, JPEG or WebP. Select moves items, resizes images
and edits text. See [shared workspace](#shared-workspace) for the Quick Lookup
handoff. Only Run sends it. Reuse restores the exact saved source
as one editable layer. Deletion removes saved input/output bytes, never the original
file. **Settings → Actions → Image input** adds a required attachment to other
Draw actions. See [input limits and persistence](architecture.md#web-search-and-image-inputs).

## Quick Lookup access

While EZ runs, press **⌃⌥ Space** or use the menu-bar **Quick Lookup** command.
Use the panel's history button to open the main window and its actions menu for
Settings. Enable optional selected-text capture through **Settings → Shortcuts →
Accessibility settings**; unsupported apps leave the input empty. The invocation
table above defines draft and request handling. Shortcut conflicts show a warning;
menu access remains available. [Raycast](raycast.md) owns launcher setup and use.

### Look up selected text

Select text in another app, then choose **Services → Look Up in EZ** from its menu
or selection context menu. Fill any remaining fields and press **⌘ Return**.
The service uses a dedicated pasteboard and needs no Accessibility permission.
Finish active work, choose New lookup to clear an existing draft, and close Settings
before invoking it. [SelectedTextService](../Sources/EZ/SelectedTextService.swift)
reads only the Services payload, validates before mutation and never queues or
writes history before Send. Empty or oversized input, sign-in, Settings, active
work or a retained draft (including overrides and Sketch redo) block unchanged.
A valid draft may wait while signed out or loading models. Cold launch can also
show the main window; checking the callback alone does not prove installed delivery.

After [installation](../../../docs/setup.md), open the installed EZ once to register
Services. If hidden, enable **Look Up in EZ** in **System Settings → Keyboard →
Keyboard Shortcuts → Services → Text**; assign a Services shortcut there if wanted.
The source app must expose selected text to Services.

## Selectors and shortcuts

Action/Preset choosers in both composers open searchable popovers. Scroll over a
choice to step through enabled options; selection clamps at the ends and ignores
momentum. Settings retains native dropdowns for other choices. Labels do not change
the click/scroll target. The [keyboard reference](../../../design/keyboard.md)
owns defaults, editing and fixed commands. **Settings → Shortcuts** records,
clears or restores bindings; valid changes save immediately. Menus and hints reflect
custom bindings. Settings and modal sheets take priority over lookup shortcuts.
An open chooser gives search/navigation priority. Escape and preset selection
return focus to its button; changing action focuses the first input. Reselecting
the same action is a no-op; another action exits historical replay and restores
its default preset. Previous/Next wraps and numbered/Last commands follow
configured order. One app-local monitor handles both surfaces without repeating
actions on key repeat. Conflicts, reserved keys and unsupported binding versions
are validated before atomic save; defaults remain available for explicit repair.

### History loading

History loads the newest 100 list rows first and adds pages as you scroll.
Search covers all saved query and answer text. The count in Standard view is the
total matching history. Load more retries a failed page without changing the
selection. Opening a row loads its complete saved input and output; a loading
indicator or Retry keeps unavailable details distinct from an empty answer.
Filtering and refreshing retain the selected answer, even outside loaded pages.
