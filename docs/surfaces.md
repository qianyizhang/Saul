# EZ surface contract

Canonical responsibilities for the two lookup surfaces. Names are defined in
[the glossary](../GLOSSARY.md); recipe behavior is defined in [ADR 0002](adr/0002-model-presets-and-recipes.md).

| Surface | Core function | Boundary |
| --- | --- | --- |
| **Quick Lookup panel** | Choose a recipe, fill its generated inputs, send/stop, read/copy the answer. | Keep compact. Reveal preset overrides and request details on demand; open the main window for history, authoring, and accounts. |
| **Main window** | Run lookups, search/review/reuse/export/delete history, manage recipes, presets, and accounts. | Own feature growth and configuration; avoid adding management UI to the panel. |

- **One workspace:** Both share the draft inputs, recipe, preset override, selected answer, history, account, and one active request. Switching surfaces preserves work.
- **Recipe-driven:** Editable/removable starters and custom recipes use the same inputs. Selecting a recipe or New lookup restores its default preset. Unavailable preset choices block sending; never silently substitute.
- **Compact presentation:** Grow for inputs/results/notices; scroll long content and keep Send/Stop reachable. Show the preset and requested speed; reveal exact choices and the answer's actual tier on demand.
- **Minimum Mode:** On by default, reversible in Settings and Quick Lookup actions. Remove repeated guidance and persistent metric strips; keep errors, account blockers, unsaved changes, and current model/speed choices visible or explicitly available. Main-window Details and the panel's information button retain exact metadata and clearly labeled metrics. The preference is local to EZ and does not synchronize with Saul.
- **Reading and editing:** A new main-window lookup puts the composer below the heading. Saved answers prioritize Copy and Use again, with Export/Delete in More. In Minimum Mode, Quick Lookup hides inputs while reading; Edit draft/Hide draft changes presentation only. New, Stop, and Copy remain reachable. Use again explicitly restores a saved request.
- **Lifecycle:** Ordinary opening never submits. Esc/⌘ W hide without cancelling; ⌘ . stops; ⌘ N starts fresh when idle. Closing the main window leaves menu-bar access; Quit exits.
- **Keyboard and wheel:** Both lookup surfaces share configurable New/Send/Stop and recipe navigation in Settings → Shortcuts. Wheel changes native selectors without opening them; compact preset selectors also scroll. Defaults above remain the initial bindings.
- **Entry points:** Menu bar, Raycast, and macOS Services are access routes. Raycast fills the first input: one-field recipes submit; multi-field recipes wait for completion and explicit Send. **Look Up in EZ** fills the first input from the Services pasteboard and always waits for Send; existing drafts, active work, and open Settings reject the incoming selection without mutation.

Future features must declare which surface owns them and preserve these shared-state and request boundaries. Conversation follow-ups remain a separate planned feature.

Future mobile surfaces should reuse the action vocabulary, reading/editing
separation, and progressive disclosure in the shared design contract. Mobile is
not implemented; touch layouts, platform keyboard behavior, account access, and
cross-device persistence still need an explicit product decision.
