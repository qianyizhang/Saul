# Product behavior

See the [glossary](../GLOSSARY.md) for shared domain and surface names.

## Reading

1. Select a term or short passage, choose an action, and select **Explain & open** or **Illustrate & open**. The card opens once the submission is accepted, including when saved work is reused.
2. **Alt+Shift+E** and **Command/Ctrl+Enter** use the selected or default action and queue quietly. Repeated keyboard requests also stay quiet; View opens their saved or active request.
3. Saul saves the request and adds a quiet underline. For work outside the open card, a completion notification offers **View**; the badge and page list retain unread state. Completion never reopens a closed card.
4. Click a marker or open the page list with **Alt+Shift+L** to inspect progress or the saved answer.

Reading jobs survive card closure, refresh, navigation, or source-tab closure while the extension runtime remains available. **Stop** cancels queued or running work and retains partial text. **Regenerate** and follow-ups create new attempts; the last successful answer remains available if a later attempt fails.

Opening a completed answer marks it read. Dismissing a notification does not. Error notifications can be muted from Settings or an error notification; success notifications and inline explanation errors remain visible.

### Illustrate and reading activity

Choose the Draw preset and PNG/GIF in the selection widget, then **Illustrate &
open**. Existing action libraries can add the starter in Settings → Actions.
Each attempt keeps its own image. Download preserves the original bytes, and
GIF Play/Pause respects Reduce Motion. Loading or inspecting an image never sends.

The [answer divider](../assets/surface.css) uses warning while connecting or
waiting, green only on a provider thinking signal, and static light under
Reduce Motion. Reserve its height. Clear the light at answer/refusal text;
keep truthful **Generating response…**, **Saving…** and saved/error status.
Queued work shows **Waiting…**, including in Min Mode.

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
- **Ask a follow-up** accepts a custom question below a saved answer. Send or Command/Ctrl+Enter includes the saved source and earlier exchanges with the same model choices. The question appears with its answer; earlier answers remain in Past attempts. Drafts survive closing/reopening the card within the page. Stop and incomplete answers retain the last successful answer.
- Follow-ups are limited to 2,000 characters per question and 120,000 compiled
  conversation characters; reject overflow rather than dropping context.
- Copy reports clipboard failures rather than claiming success.

## History

The popup opens directly to History. Search and bookmarks stay visible; export and deletion of the entire library are under **Export and manage history**. The full workspace uses the same views with a wider reading area.

**Min Mode** is the default expert everyday view, following [DESIGN.md](../../../DESIGN.md#min-mode).
It shows the current input/answer, action or preset choice, essential state and primary
actions. Routine subtext is omitted; buttons use one clear word or a familiar symbol,
with complete accessible names and tooltips. More/Details retain uncommon operations,
regeneration, inspection and history management. Errors, unsaved work, unavailable
choices and billing/permission consequences stay visible. Preferences save immediately,
independently of configuration drafts, and update open extension surfaces, including
the summary panel. The board keeps its own presentation preference.

See the [keyboard reference](../../../design/keyboard.md#saul) for reading,
workspace and browser shortcuts. **Settings → Preferences → Shortcuts** shows
Chrome's current assignments.

The full workspace provides:

- search across selected text, readable explanations, concept notes, titles, and URLs;
- bookmarks, pagination, source navigation, and per-passage attempt history;
- Markdown export of retained passages and attempts, including incomplete labels;
- deletion and **Clear all**, which cancel affected work and block late writes from recreating it.

[History](../../../contracts/history.md) is shared with EZ. The helper is
required even for API providers. Removing a browser profile does not delete it.
Repeated reading actions disclose reuse and offer **Run again with current input**;
normal Regenerate keeps the frozen request.

## Settings and models

Settings has focused sections: Overview, Presets, Actions, Calls, Preferences
and Connections. Overview leads with reading defaults; Presets keeps the selected
preset beside its fields, with a compact selector at narrow widths. Section changes
preserve the mounted configuration draft. Save and conflict recovery remain reachable
across sections; preferences and access retain their independent immediate-save behavior.

Stale or uncertain saves keep the draft and block another save. **Review latest**
compares the original, saved and local values; same-field conflicts need an explicit
choice (**Mine / Latest**). Show only local edits; retain non-conflicting ones.
**Apply to draft** changes only the draft, then Save checks the fresh revision. Cancel
keeps the draft. Edits already present in saved settings need no second save.
**Reload** replaces it with saved settings after confirming discard
when dirty. The [shared transaction contract](../../../contracts/configuration.md#unified-configuration-scopes)
owns revision and atomic-save guarantees.

- Named actions pair editable prompts with a default model preset. Explain, Lookup, and Nudge are editable starters. A preset binds a connection, capability, model, and supported options. ChatGPT plan presets use their connection’s bound account when present, including in standalone mode. In standalone mode, a preset without a bound account uses the locally selected account.
- Inspecting a preset does not change the standalone account or the saved provider/profile defaults, including when another edit is saved. Standalone Original summary continues to use the saved local account.
- New installations start with explicit Actions and Presets. Choosing another action for the same passage creates a new attempt; retry keeps the original request choices even after Settings changes.
- Templates substitute `{{text}}`, `{{context}}`, `{{page title}}`, `{{page url}}`, `{{heading}}`, and `{{paragraph}}` once. `{{text}}` is required; unavailable referenced context blocks submission. Enabled context is included once, and template expressions are unsupported.
- OpenAI-compatible profiles keep separate endpoint, model, temperature, and key values.
- Changing endpoint origin clears the current key.
- Missing referenced profiles remain unavailable until explicitly repaired; no replacement profile is synthesized.
- Invalid or obsolete saved settings show the affected field and offer an explicit backup-and-reset action. Unsupported old records remain untouched; Saul does not infer Actions or synthesize profiles from them.
- Save, connection test, and generation test use the current draft without overwriting unreadable stored settings.
- A saved attempt whose credential owner or endpoint changed keeps its output and
  shows “Select a new preset in Settings, then start a new attempt.” Retry never
  silently adopts the new route.
- Model setup appears first. Save and validation feedback stay visible while scrolling; leaving a changed draft asks before discarding it.
- Response language and context controls apply to new submissions.
- Chrome on-device AI is retired. Saved selections remain readable and prompt an explicit switch to ChatGPT plan or OpenAI compatible. New local requests are blocked; Saul does not switch providers automatically.
- [ChatGPT plan](chatgpt-plan.md) uses the same sign-in flow and control labels as EZ, with shared saved sign-ins when connected to the macOS Saul credential owner; standalone browser installations retain local sign-ins. Its account catalog supplies model names, reasoning effort, and Fast/Standard choices. Saved unavailable choices block requests rather than changing silently. It requires the local helper, omits unsupported temperature and output-token options, and never switches billing providers after a failure.

Local tests cover the provider boundary with deterministic fixtures. They do not establish external-provider authentication, model quality, or device performance.

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
other platforms use Saul labels. Helper and page-access controls live
under **Settings → Preferences → Integrations**. External access is off by default.
Rows show readable titles with hostname fallback, full original title/URL on
hover, and names/counts above the list. Display text does not change saved
sources or browser metadata. Preserve focus, scroll and surviving choices on
refresh. See [native messaging](native-messaging.md) and the [Tab board](mcp-app.md).

### Summaries

[Calls and summaries](calls.md) owns page capture, the reader, PDFs and retry.

## Compatibility

- Saul targets Google Chrome MV3 only.
- The native bridge supports macOS and Linux Chromium-family browsers; Google Chrome is the verified target.
- See [testing](testing.md) for covered behavior and evidence limits.

See [shared presets](../../../contracts/configuration.md) and
[Speak preview](chatgpt-plan.md#speech-preview) for provider and capability rules.

## Browser annotations

See [annotations](annotations.md) for capture, replies, evidence and retention.
