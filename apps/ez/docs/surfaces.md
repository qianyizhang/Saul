# EZ surface contract

Canonical responsibilities for the two lookup surfaces. Names are defined in
[the glossary](../GLOSSARY.md); action behavior is defined in [ADR 0002](adr/0002-model-presets-and-recipes.md).

| Surface | Core function | Boundary |
| --- | --- | --- |
| **Quick Lookup panel** | Choose an action, fill its generated inputs, Run/Stop, read/copy or download the result. | Keep compact. Reveal preset overrides and request details on demand; open the main window for history, authoring, and providers. |
| **Main window** | Run lookups, search/review/reuse/export/delete history, manage actions, presets, and providers. | Own feature growth and configuration; avoid adding management UI to the panel. |

- **One workspace:** Both share the draft inputs, action, preset override, selected answer, history, account, and one active request. Switching surfaces preserves work.
- **Action-driven:** Editable/removable starters and custom actions use the same inputs. Selecting an action or New lookup restores its default preset. Unavailable preset choices block sending; never silently substitute.
- **Compact presentation:** Grow for inputs/results/notices; scroll long content and keep Run/Stop reachable. Show the preset and requested speed; reveal exact choices and the answer's actual tier on demand.
- **Min Mode:** On by default, reversible in Settings and Quick Lookup actions. Follow the expert everyday policy in DESIGN.md. Omit routine subtext and use short action labels; keep errors, account blockers, unsaved changes, and current model/speed choices visible or explicitly available. Main-window Details and the panel's information button retain exact metadata and clearly labeled metrics. The preference is local to EZ and does not synchronize with Saul.
- **Reading and editing:** A new main-window lookup puts the composer below the heading. Saved answers prioritize Copy. Min Mode puts Reuse/Export/Delete in More and inspection in Details; Standard view also shows Use again. In Min Mode, Quick Lookup hides inputs while reading; Edit/Hide changes presentation only. New, Stop, and Copy remain reachable. Use again explicitly restores a saved request.
- **Lifecycle:** Shortcut/menu invocation starts an empty lookup when idle, clearing previous inputs and answer selection while keeping the action and restoring its default preset. Running requests and pending launcher submissions are preserved; history is retained. The shortcut hides an already focused panel. Opening never submits. Esc/⌘ W hide without cancelling; ⌘ . stops; ⌘ N starts fresh when idle. Closing the main window leaves menu-bar access; Quit exits.
- **Unsaved answers:** Both surfaces retain an attempt-level Unsaved notice with Save (Save again in Standard view) and Export. Copy remains available. New lookup and History preserve the answer in memory; Save again writes its frozen result without generating again. Save or export before quitting. The [persistence contract](architecture.md#persistence-contract) owns recovery semantics.
- **Keyboard and wheel:** Both lookup surfaces share configurable New/Run/Stop and action navigation in Settings → Shortcuts. Wheel changes native selectors without opening them; compact preset selectors also scroll. Defaults above remain the initial bindings.
- **Entry points:** Shortcut/menu invocation optionally fills the fresh lookup's first input from the active app's selected text, with Accessibility access and source-app support; absent or unavailable selection leaves it empty. It never submits. Raycast fills the first input: one-field Write actions submit; Draw and multi-field actions wait for completion and explicit Run. **Look Up in EZ** fills the first input from the Services pasteboard and always waits for Run; existing drafts, active work, and open Settings reject the incoming selection without mutation.

Both surfaces own **Ask a follow-up** below completed answers, sharing one per-answer
draft and the active request. Each Send keeps the saved request and earlier exchanges,
uses its model choices and the selected local account, and saves a linked history
entry. Previous answer navigates to the retained parent. Opening, hiding and switching
surfaces never submits. Unsaved/partial answers must recover or finish before they
can supply follow-up context.

Future features must declare which surface owns them and preserve these shared-state and request boundaries.

**Illustration** is a Draw action in the same workspace, not a third surface.
Both surfaces show its inputs, Run/Stop and image result. Presets owns image
options; Providers owns credentials. History owns PNG retention and deletion.
Draw always waits for explicit Run after launcher input. Image results prioritize
Download, retain Reuse and Details, and omit text follow-ups. Unsaved image recovery
retries storage without another request. See [Providers and Illustration](architecture.md#providers-and-illustration).

Future mobile surfaces should reuse the action vocabulary, reading/editing
separation, and progressive disclosure in the shared design contract. Mobile is
not implemented; touch layouts, platform keyboard behavior, account access, and
cross-device persistence still need an explicit product decision.
