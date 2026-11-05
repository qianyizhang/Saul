# EZ surface contract

[Glossary](../GLOSSARY.md) owns names; [architecture](architecture.md) owns execution
and persistence; [design](design.md) owns presentation.

| Surface                | Responsibility                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Quick Lookup panel** | Compact action/input selection, Run/Stop, reading, Copy/Download; disclose presets and Details on demand. Open the main window for management. |
| **Main window**        | Lookups plus history search, reuse, export, deletion and Settings. Own feature growth, configuration and providers.                            |

## Shared workspace

- Both surfaces share inputs, image, action, preset override, selected answer,
  history, account, per-answer follow-up draft and one active request. Handoff
  preserves work. Switching surfaces never sends.
- Selecting another action or New restores its default preset. Unavailable choices
  block; never substitute account, model, billing or tier.
- New main-window lookups put the composer below the heading. Edit/Hide reveals or
  hides the retained draft; Reuse explicitly restores the saved request.
- Answers prioritize Copy (Download for images). Min Mode puts Reuse/Export/Delete
  in More and inspection in Details; Standard also shows Use again. Quick Lookup
  hides inputs while reading in Min Mode. New/Stop remain reachable.
- Min Mode defaults on and is local to EZ. Settings → Preferences and the panel
  menu change the same preference. Exact model, requested/actual tier and metrics
  remain available in Details; errors, blockers and unsaved recovery stay visible.
- Compact layout grows for forms/results/notices; long content scrolls while
  Run/Stop stay reachable. Preset and requested speed remain identifiable.
- Both surfaces offer follow-ups for saved completed native Write answers and
  Previous answer navigation. Draw has no text follow-up. Follow-up context and
  limits belong to [architecture](architecture.md#follow-ups).
- Unsaved answers retain Save (Save again in Standard), Copy/Export and in-memory
  recovery across navigation. Retry saves only; save/export before quitting.
  See [persistence](architecture.md#persistence-contract).

## Invocation and lifecycle

| Entry point           | Idle behavior                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Shortcut/menu         | Start empty, keep action, reset preset; optionally fill first input from selected text with Accessibility access. Never submit.                |
| Raycast               | Fill first input; single-field Write submits, Draw/multi-field waits for explicit Run. See [Raycast](raycast.md).                              |
| Look Up in EZ Service | Fill first input from the dedicated Services pasteboard; always wait for Run. Reject existing drafts, active work and open Settings unchanged. |

Shortcut/menu invocation preserves running requests and pending launcher work;
the shortcut hides an already focused panel. Esc/⌘W hide without cancellation,
⌘. stops and ⌘N starts fresh when idle. Hiding preserves history and clipboard.
Closing the main window leaves menu-bar access; Quit exits.

Both surfaces share configurable lookup/action shortcuts and wheel selectors;
Settings → Shortcuts owns bindings. Global Quick Lookup (⌃⌥Space), Settings (⌘,)
and panel hiding stay fixed. [Architecture](architecture.md#selector-scrolling-and-keyboard-commands)
owns input routing and conflict handling.

Illustration is a Draw action in this workspace. Providers owns credentials,
Presets image options and History saved PNGs. Launcher input always waits for Run;
unsaved image recovery never generates again.

Future features must name their owning surface and preserve these boundaries.
Mobile is not implemented; touch layout, platform keys, account access and
cross-device persistence need explicit decisions.
