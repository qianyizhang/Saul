# Product behavior

See the [glossary](../GLOSSARY.md) for shared domain and surface names.

## Reading

1. Select a term or short passage, choose a recipe, and select **Explain**. **Alt+Shift+E** uses the selected or default recipe.
2. Saul saves the request, adds a quiet underline, and confirms that the job is queued. It does not open a card automatically.
3. Keep reading. A completion notification offers **View**; the badge and page list retain unread state.
4. Click a marker or open the page list with **Alt+Shift+L** to inspect progress or the saved answer.

Reading jobs survive card closure, refresh, navigation, or source-tab closure while the extension runtime remains available. **Stop** cancels queued or running work and retains partial text. **Regenerate** and follow-ups create new attempts; the last successful answer remains available if a later attempt fails.

Opening a completed answer marks it read. Dismissing a notification does not. Error notifications can be muted from Settings or an error notification; success notifications and inline explanation errors remain visible.

### Page markers

- Saved passages restore on the same URL when quote context identifies one occurrence.
- Queries and hash routes remain part of page identity.
- Markers do not replace page text or intercept native links.
- Changed, missing, overlapping, or ambiguous text remains available in the page list and library.
- Shadow roots, frames, browser-restricted pages, and oversized text maps are outside the current capture surface.

### Explanation card

- **Inspect input/output** reveals the selected attempt's saved instructions,
  context fields, assembled user prompt and literal response text. Each block can
  be selected or copied. History and past attempts use the same inspector. Status
  distinguishes prepared, completed and incomplete attempts; missing older input
  is labelled unavailable. Inspection does not send another request.

- Pin keeps the card open while interacting with the page.
- Concept terms expose notes on hover, focus, or click.
- **Simpler**, **Give an example**, and **Go deeper** retain the captured source context and include the previous explanation.
- Copy reports clipboard failures rather than claiming success.

## History

The popup opens directly to History. Search and bookmarks stay visible; export and deletion of the entire library are under **Export and manage history**. The full workspace uses the same views with a wider reading area.

**Minimum Mode** is on by default. It keeps source links and essential actions visible,
removes routine instructions and repeated headings, and places follow-ups, past attempts,
and selected-entry deletion under **More**. Model and timing information is under
**Details**, directly below the answer. Details uses labelled columns for the saved
attempt’s recipe, preset, provider, model, creation time and duration. Errors, active progress, incomplete results, and unsaved settings remain
visible. Turn it off in Settings for the fuller presentation; the choice saves
immediately and independently of provider drafts, and updates open page overlays.

Shortcuts are listed in a Settings disclosure. **Command/Ctrl+Enter** explains an
available source selection outside editable fields; **Command/Ctrl+.** stops the
open explanation's active job. **Escape** dismisses the reading surface without
cancelling work. **Command/Ctrl+,** opens Settings inside the extension workspace.
The existing **Alt+Shift+E/L** shortcuts remain. Browser shortcuts stay with Chrome.

The full workspace provides:

- search across selected text, readable explanations, concept notes, titles, and URLs;
- bookmarks, pagination, source navigation, and per-passage attempt history;
- Markdown export of retained passages and attempts, including incomplete labels;
- deletion and **Clear all**, which cancel affected work and block late writes from recreating it.

SQLite-WASM stores the library in OPFS for the current browser profile. Data is local to that profile and remains until explicit deletion or browser-profile removal.

## Settings and models

- Named recipes pair editable prompts with a default model preset. Explain, Lookup, and Nudge are editable starters. A preset names the provider, connection/account, model, and supported options.
- The existing prompt and model migrate into Explain and Current. Choosing another recipe for the same passage creates a new attempt; retry keeps the original request choices even after Settings changes.
- Templates substitute `{{text}}`, `{{context}}`, `{{page title}}`, `{{page url}}`, `{{heading}}`, and `{{paragraph}}` once. `{{text}}` is required; unavailable referenced context blocks submission. Enabled context is included once, and template expressions are unsupported.
- OpenAI-compatible profiles keep separate endpoint, model, temperature, and key values.
- Changing endpoint origin clears the current key.
- Missing/stale profile selection preserves the current configuration in a recovered profile.
- Invalid saved settings show the affected field and offer an explicit backup-and-reset action.
- Save, connection test, and generation test use the current draft without overwriting unreadable stored settings.
- Model setup appears first. Save and validation feedback stay visible while scrolling; leaving a changed draft asks before discarding it.
- Response language and context controls apply to new submissions.
- Chrome on-device AI is temporarily disabled while live model setup remains unverified. Saved selections remain readable and prompt an explicit switch to ChatGPT plan or OpenAI compatible. New local requests are blocked; Saul does not switch providers automatically.
- [ChatGPT plan](chatgpt-plan.md) uses the same sign-in flow and control labels as EZ, with separate saved sign-ins. Its account catalog supplies model names, reasoning effort, and Fast/Standard choices. Saved unavailable choices block requests rather than changing silently. It requires the local helper, omits unsupported temperature and output-token options, and never switches billing providers after a failure.

Local tests cover the provider boundary with deterministic fixtures. They do not establish external-provider authentication, model quality, Chrome model availability/download, or device performance.

## Window and Tab board

**Window** manages the Chrome window containing the extension popup or page.
**Tab board** manages all connected normal windows in the MCP app. Window
names, row styling, selection and action labels are shared. Incognito windows
are excluded. Live refresh preserves surviving selections.

Select tabs individually, with Shift for a range, or with Select all. The
selection bar offers only **Group**, **Move to**, and **Summarize**. Pinned tabs
can be summarized; grouping and moving never silently unpin them.

Manual drags and Group/Move act immediately. Individual tabs can leave or join
groups; dragging a group heading moves it intact. Grouping a selection spanning
windows asks for an existing or new destination. Selection order follows the
displayed window and tab order. Keyboard move controls accompany dragging.
Explicit sorting and Ungroup controls are absent.

**Undo** restores the last reversible manual arrangement while its affected
tabs remain unchanged. A move that closes its source window has no Undo:
Chrome's window identity and associated UI cannot be restored. Partial failures
require refreshing and inspecting the result; operations are not replayed.

Codex-generated reorganizations retain the editable proposal service and an
explicit **Apply** boundary. The board shows proposed moves and duplicate
closures together, with an opt-out for deduplication. **Discard** dismisses
the proposal. Manual gestures operate on the current layout after a proposal
is applied or discarded; they never silently remove duplicate tabs.
Pinned/grouped tabs stay protected in automated proposals.

On macOS Chrome, the native helper imports **Name Window** labels through
AppleScript and verifies reviewed renames. Automation errors remain visible;
other platforms use Saul labels. Connection and page-access settings live
under **Settings → Codex connection**. External access is off by default.
See [native messaging](native-messaging.md).

### Summaries

**Select all → Summarize** summarizes a window; a smaller selection summarizes
only those tabs. A selection across windows produces one saved summary in
display order with source-window labels.

Summarize immediately opens a reader in Chrome. It starts using the configured
eligible ChatGPT account, or asks for an account when the choice is ambiguous.
The profile remains GPT-6 Luna, medium effort, concise English followed by
equivalent Simplified Chinese. Missing capability blocks explicitly; no
provider or billing fallback is chosen.

Two items process concurrently within one summary. Results appear in original
order as they finish. Other reading jobs retain their existing concurrency.
Provider failures stop dequeuing new items while in-flight siblings settle;
capture/format failures affect only their own item. **Stop** aborts all active
summary streams and retains completed/partial results. A storage failure stops
all workers before delete, retry, or another summary can proceed.

Loaded HTTP(S) text is captured without focusing or reloading source tabs,
bounded to 120,000 characters. Video, audio, images, frames, linked pages,
collapsed and unloaded content are not read. Source changes and unreadable
pages report their limitations. Restricted pages are skipped.

Summaries and captured text persist in local SQLite. The reader is a disposable
view: closing it never stops processing or deletes data. Reopening never
regenerates results. Browser/extension restart marks unfinished work interrupted
and never automatically spends quota again. **Retry unfinished** explicitly
retries using frozen sources when available.

History separates **Passages** and **Summaries**. The reader contains progress,
Stop, Retry unfinished, source coverage, **Export HTML**, and deletion under
Details. Export creates a self-contained snapshot, including incomplete states.
Completion does not open a second tab or steal focus. Tab surfaces retain only
a compact link to active summary progress. Summary deletion remains separate
from passage History's Clear all action.

## Compatibility

- Saul targets Google Chrome MV3 only.
- The native bridge supports macOS and Linux Chromium-family browsers; Google Chrome is the verified target.
- See [testing](testing.md) for covered behavior and evidence limits.
