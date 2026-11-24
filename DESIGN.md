# Little Clarity design

## Overview

Little Clarity is quiet and reading-first. Saul and EZ share vocabulary, visual
roles and interaction rules; keep native controls and the host's appearance.
[Design tokens](design/tokens.md) own the values used to generate platform
assets. This guide owns visual and interaction rules. Use the
[design workflow](design/SKILL.md) to change tokens and verify the outputs.

## Colors and typography

Reserve green for the primary action, keyboard focus, links and meaningful activity.
Use neutral text and a subtle fill for everyday navigation, hover and selection. Pair light
roles with their `-dark` values. Dark neutrals stay achromatic. Use text with
warning and danger cues; check normal text at 4.5:1 and meaningful control/focus
cues at 3:1 against adjacent colors.

Use one system sans family. Give subjects weight and space, set writing and answers
in the same body role, and use the control role for navigation, pickers and tabs.
Use captions for secondary facts. Support wrapping, selection, zoom and platform scaling.

Use images where they are part of the work: a source capture as evidence or a
generated image as a result. Keep decorative imagery out of reading and lookup
surfaces.

## Layout and first read

Make the subject, state and next useful action apparent. Separate the displayed
answer, editable draft and saved configuration. Put caveats beside their claim.
Let the layout explain how controls and content relate. Avoid unnecessary
secondary labels and descriptions, including headings and badges that repeat
information already visible. Keep the labels and status people need to act or recover.
Use generous measure for reading, tighter spacing in popups and lookup panels,
and dense rows for boards. Keep the primary action reachable at narrow widths.
Use tonal layers and quiet dividers; reserve shadows for overlays. Use soft
rectangles for controls and panels, pills for small status or floating cues.

Keep essential labels after typing. Name disclosures by their contents and give
them a full-row target. Opening one preserves focus context, draft and selection.
Stale saves retain the draft and require an explicit recovery path. Failed saves
remain visible in the affected reader and never appear saved or recoverable;
see [attempt guarantees](contracts/actions-and-attempts.md#execution).

## Notebook

A writing surface and its saved answer share a comfortable reading column. Keep
the editor borderless, with a persistent field name, several lines of breathing
room and a visible focus rule. Put run choices above the editor and the billing
route beside Send. Settings fields still need visible boundaries where many
editable values appear together.

Use the shared control-row height, spacing and radius for ordinary desktop
controls. Make the entire row clickable. Use the same neutral selection treatment
for a sidebar item and a reader tab. Keep compact controls in narrow overlays
and dense boards, and preserve larger touch targets.

Show one level of inspection at a time. Place literal input fields, prompt and
response on one left edge with a name and Copy for each. Separate sections with
spacing or a quiet rule. Give long text a bounded reading area with Find and
full-text Copy. The native layout and compact panel adaptation are described in
[EZ surfaces](apps/ez/docs/surfaces.md#reading-and-inspection).

## Min Mode

Default to the expert everyday view with current content, inputs, choices,
essential state and useful actions. Show no secondary labels or descriptions in
Min Mode, including inside expanded menus and settings. Keep uncommon operations
and recorded facts in named More, Details or Settings views. Standard view may
show brief guidance or secondary metadata inline. Keep primary labels, errors,
unsaved work, unavailable choices, source information, billing and permission
effects visible in both modes.

Min Mode is a reversible local presentation preference. It never sends, changes
execution, clears drafts, alters retention or skips confirmation. Compact preset
labels omit routine Standard; Fast remains visible. Preserve full accessible
names, tooltips and focus cues.

## Language, actions and symbols

Use sentence case and concrete names from the [glossary](GLOSSARY.md). Keep
**History**, **Settings**, **Details**, **More**, **Save**, **Cancel** and **Stop**
consistent. Show status only when observed. **Reuse** restores an editable draft.
**Run again**, **Regenerate** and **Retry** start attempts with the input defined
in the glossary. **Refresh** reads current
state; **Reload** reads saved settings and guards dirty drafts. Closing a view
does not Stop. Fast requests a speed tier; it does not promise latency or prove
the returned tier.

Use one clear word or familiar symbol. Copy, Send, Refresh and sidebar toggles
use symbols in both modes with accessible names. Keep text when consequential
actions need scope. Copy reports a failed clipboard write; show confirmation
only after the clipboard accepts the write. Use native sidebar controls on macOS. See the
[generated symbol sheet](design/symbols.html) and [owning registry](design/symbols.json).

## Settings

Show one focused editor at a time with a nearby selection. Preserve drafts
across sections; guard item changes, closing and Reload. Put advanced options
in named disclosures. The overview shows the loaded **Version · Build** in
both modes, or **Unavailable** when identity is missing.

Connections owns identity, endpoint and credentials; Presets owns the selected
connection, capability, model and applicable options. Connection rows show
name, capability chips, account or endpoint/key mask, then status and Check.
Show preset counts alongside connection names in Standard view.
Mask keys as `sk-***abcd`. Keep technical IDs and secret fields out of the
summary. Check is not generation: distinguish auth, helper and catalog errors
and offer repair. Put binding and migration under Preferences → Integrations.
Missing saved models remain visible with Edit preset. Use
[configuration](contracts/configuration.md) and [credentials](contracts/credentials.md)
for binding, refresh and execution rules.

Write shows supported effort and speed. Draw shows model and Image settings.
Speak shows its saved model/voice, Generate/Stop, billing and AI-generated audio
before deliberate playback. Actions show compatible overrides. Exact recorded
choices belong in answer Details.

## Reading and inspection

Keep **Details** outside More. It describes the displayed answer, with aligned
labels, readable values and metrics grouped by unit. Wrap long values; show
unknown values explicitly. Separate requested speed from actual tier. Current
draft choices are shown while composing or behind **Next lookup**.

Offer on-demand inspection for the selected attempt and earlier attempts in
both modes. Use labelled selectable blocks for instructions, context/inputs,
assembled prompt and literal response. Preserve whitespace and markup; allow
per-block Copy with error feedback. Show unavailable, partial and prepared data
honestly. Saved inspection never fetches current input, reruns the model or
reveals credentials, raw traffic or hidden reasoning. Large blocks use bounded
searchable sections with full-text Copy.

Put a labelled follow-up field below eligible answers; keep prior attempts
reachable. Only explicit Send submits. A Draw result uses Download for original
bytes, with exact saved format and billing route visible at the point of choice.
A format override stays in the draft until Run. No launcher, Close, Reuse or
preview is an implicit Draw send.

## Keyboard, motion and mobile direction

Follow [keyboard rules](design/keyboard.md). Restore useful focus after dismissal;
offer a pointer or touch alternative to essential shortcuts. Keep motion brief,
non-blocking and tied to observed changes. Reduce Motion keeps a static cue;
activity lights never stand in for status text. Do not reopen a closed reader
or steal focus on completion.

Mobile is a future surface. Use a reading column and bottom composer with
History and Settings separate. Keep drafts through dismissal, support 44-point
touch targets, safe areas and text scaling. Touch cannot depend on hover or
wheel input. Narrow desktop reflow does not establish mobile acceptance.

## Feature owners

- Saul: [Reading, Settings and Window](apps/saul/docs/product.md),
  [Calls and PDFs](apps/saul/docs/calls.md), [annotations](apps/saul/docs/annotations.md)
  and [Tab board](apps/saul/docs/mcp-app.md).
- EZ: [native design](apps/ez/docs/design.md) and [surfaces](apps/ez/docs/surfaces.md).

Use the [feature UI review](design/SKILL.md#feature-ui-review) when behavior or
presentation changes. Generated token checks alone do not establish usability.
