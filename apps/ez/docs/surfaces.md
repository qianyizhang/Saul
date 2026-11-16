# EZ surface contract

[Glossary](../GLOSSARY.md) owns names; [architecture](architecture.md) owns execution
and persistence; [design](design.md) owns presentation.

| Surface                | Responsibility                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Quick Lookup panel** | Compact Action/Preset and input selection, Run/Stop, reading, Copy/Download and Details. Open the main window for management. |
| **Main window**        | Lookups plus history search, reuse, export, deletion and Settings. Own feature growth, configuration and connections.                            |

## Shared workspace

- Both surfaces share inputs, image, action, preset override, selected answer,
  history, account, per-answer follow-up draft and one active request. Handoff
  preserves work. Switching surfaces never sends.
- Make meme shares one Sketch draft. The main window owns the canvas; Quick Lookup
  can preview, paste or run, and Edit sketch opens the same draft in the main window.
  After a run, Edit draft shows the canvas again; Hide draft returns to the answer.
- Selecting another action or New restores its default preset. Unavailable choices
  block; never substitute account, model, billing or tier.
- Both composers put Action and Preset above the inputs. The main window puts a
  new composer below the heading. Edit/Hide opens or hides work already retained
  in the shared draft; Reuse restores the selected saved request without running it.
- The main reader shows available Copy or Download, Reuse, Export and Delete in
  one row in both modes. Delete is separated at the far edge and confirms shared
  deletion. Details holds the record and inspection, followed by the follow-up.
  Quick Lookup hides inputs while reading in Min Mode and keeps its utilities
  menu and workspace handoff. New/Stop remain reachable.
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
the shortcut hides an already focused panel. Hiding preserves active work,
history and clipboard.
Closing the main window leaves menu-bar access; Quit exits.

Both surfaces share configurable lookup/action shortcuts and wheel selectors.
See the [keyboard reference](../../../design/keyboard.md) for editing and commands,
and [architecture](architecture.md#selector-scrolling-and-keyboard-commands) for
routing and conflict handling.

Illustration is a Draw action in this workspace. Connections owns credentials,
Presets image defaults, the text-to-image composer its runtime PNG/GIF choice, and History
saved image bytes in SQLite. Launcher input always waits for Run;
unsaved image recovery never generates again.

Future features must name their owning surface and preserve these boundaries.
Mobile is not implemented; touch layout, platform keys, account access and
cross-device persistence need explicit decisions.
