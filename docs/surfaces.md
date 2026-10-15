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
- **Lifecycle:** Ordinary opening never submits. Esc/⌘ W hide without cancelling; ⌘ . stops; ⌘ N starts fresh when idle. Closing the main window leaves menu-bar access; Quit exits.
- **Keyboard and wheel:** Both lookup surfaces share configurable New/Send/Stop and recipe navigation in Settings → Shortcuts. Wheel changes native selectors without opening them; compact preset selectors also scroll. Defaults above remain the initial bindings.
- **Entry points:** Menu bar and Raycast are access routes. Raycast fills the first input: one-field recipes submit; multi-field recipes wait for completion and explicit Send.

Future features must declare which surface owns them and preserve these shared-state and request boundaries. Conversation follow-ups remain a separate planned feature.
