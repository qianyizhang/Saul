---
version: alpha
name: Little Clarity
description: A calm, reading-first identity, derived from EZ and shared across native and browser surfaces.
colors:
  primary: '#296e59'
  primary-dark: '#6ec2a1'
  primary-hover: '#205642'
  primary-hover-dark: '#84d1b1'
  on-primary: '#ffffff'
  on-primary-dark: '#14251d'
  canvas: '#fafaf7'
  canvas-dark: '#1e1e1e'
  surface: '#ffffff'
  surface-dark: '#262626'
  subtle: '#f0f1eb'
  subtle-dark: '#303030'
  ink: '#242722'
  ink-dark: '#e8e8e8'
  muted: '#62685d'
  muted-dark: '#b5b5b5'
  line: '#d7dcd1'
  line-dark: '#484848'
  wash: '#eaf2ec'
  wash-dark: '#253d31'
  danger: '#a3312a'
  danger-dark: '#f3a79e'
  danger-wash: '#fff0ed'
  danger-wash-dark: '#472a28'
  warning: '#805417'
  warning-dark: '#e2bd83'
  warning-wash: '#f7efdf'
  warning-wash-dark: '#403425'
  window-blue: '#356a99'
  window-blue-dark: '#8ebde5'
  window-violet: '#78539a'
  window-violet-dark: '#c4a3e2'
  window-rose: '#a34f69'
  window-rose-dark: '#e4a0b6'
typography:
  subject:
    fontFamily: 'ui-serif, Georgia, serif'
    fontSize: 24px
    fontWeight: 500
    lineHeight: '1.3'
  body:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: 15px
    fontWeight: 400
    lineHeight: '1.65'
  control:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: 14px
    fontWeight: 500
    lineHeight: '1.5'
  caption:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: 12px
    fontWeight: 400
    lineHeight: '1.5'
rounded:
  control: 8px
  panel: 12px
  composer: 14px
  pill: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  reading: 32px
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.on-primary}'
    rounded: '{rounded.control}'
  button-primary-dark:
    backgroundColor: '{colors.primary-dark}'
    textColor: '{colors.on-primary-dark}'
  reading:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    typography: '{typography.body}'
  reading-dark:
    backgroundColor: '{colors.surface-dark}'
    textColor: '{colors.ink-dark}'
  caption:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.muted}'
  caption-dark:
    backgroundColor: '{colors.canvas-dark}'
    textColor: '{colors.muted-dark}'
---

## Overview

Quiet, personal, and useful: a small space for finding clarity. EZ and Saul are
surfaces of the same personal tool. Carry the same action names, reading hierarchy,
and interaction rules between them; adapt to native controls and the surrounding app.
Tokens are authoritative values. This document is the one authored design source;
platform files are generated. The format is Google Labs DESIGN.md alpha, with
paired `-dark` colors as this contract's explicit appearance convention.

## Colors

Use the green primary for actions, selection, and meaningful emphasis. Neutral
canvas, surface, and subtle layers separate content without competing with it.
Dark neutral layers, text and dividers use achromatic grays. Keep green confined
to actions, focus and meaningful selection or emphasis; do not tint whole reading
surfaces or ordinary cards. Use wash for these accent states, not as another
background layer. A structural container alone does not imply selection or status.
Muted text stays readable. Danger and warning always accompany a text explanation.
Pair each color with its `-dark` value in dark appearance. Native controls may use
system semantic surfaces; preserve the shared accent and content hierarchy.

## Typography

Use serif subject headings for a query or passage, and system sans for answers,
navigation, and controls. Captions carry secondary information without becoming
faint fine print. Map `ui-serif` to SwiftUI's system serif; use available system
fonts on the web. Allow content wrapping, text selection, zoom, and platform scaling.

## Layout

Give reading content a comfortable measure and generous breathing room. Compact
popups and lookup panels use tighter spacing; tab boards use dense, scannable rows.
Preserve the same hierarchy across these densities. Reveal advanced options when
needed, keep the primary action reachable, and avoid horizontal scrolling at narrow widths.

**Window** is the extension view of its containing Chrome window. **Tab board**
is the MCP view across windows. Both use the same tab rows, checkboxes, group
headings and selection actions: **Group**, **Move to**, **Summarize**. Show
window name and tab count before the list; group and move inputs appear only
when needed. Use hostnames on rows and full URLs in accessible titles.
Tab labels show readable plain text from markup-like page titles, with the site
name as a fallback. Keep the original page title and URL in the row's hover text;
selection labels and search also use the readable title. This is display-only:
browser titles, saved sources and protocol data retain their original values.

Manual drags and selection actions change Chrome immediately. Never deduplicate
as a side effect of a manual edit. Provide one contextual **Undo** when the
affected arrangement can still be restored. Drag group headings to move intact
groups; dragging individual tabs into or out of groups changes membership.
Pins are selectable for summaries and remain protected from group/move actions.
Use **Select all** and range selection rather than another summary workflow.

Codex proposals retain a compact review bar and **Apply** with visible duplicate
closure counts. **Discard** restores the current board view. Proposed edits
never execute without Apply; manual editing resumes after Apply or Discard.
Window cards fold and reorder locally; exact browser position numbers are
useful only when reviewing a proposed change, not on every normal tab row.
Preserve focus, surviving selections and scroll position on refresh. Keep
success to one line. Connection management belongs in Settings. The board composer sends the typed
message directly; an unchecked attachment control adds only the browser session,
revision and selected tab IDs when chosen.

The Tab board keeps an accessible **App info (ⓘ)** control in both Codex and
standalone web mode. Info, registered Tools, Conversation flow and Interactions
are named disclosures; exact frozen inputs/results stay out of the default board.
Each send offers **Inspect send**. A host acknowledgment means **Accepted by host**;
conversation arrival remains separately observed. Standalone uses **Copy message**
and the same tab operations, including reviewed Apply. Automatic diagnostics save
metadata only; payloads stay live until an explicit selected-interaction capture.
Show the canonical log path, retention, masking and recording failures in Info.

Use one heading for the current task. Avoid repeating the selected navigation label,
adding a slogan above an input, or boxing every history row. A new lookup puts its
inputs near the heading; a saved answer gives that space back to reading. Keep
configuration and history management outside compact reading surfaces.

### First-read clarity

A surface should make its subject, current state and next useful action apparent
before the user reads supporting detail. Give each visible fact a purpose in that
task. Group comparable values by meaning and unit; use alignment and typography
to distinguish labels from values. Place caveats beside the claim they qualify.
Keep the displayed answer, editable draft and saved configuration visibly distinct.

In EZ, when a terminal answer cannot be saved, keep the available answer attached to its
attempt and show **Unsaved** with Copy/Export and an explicit save recovery action.
**Save again** writes the retained result; it never starts generation. Keep
this notice visible after navigating away and back, including in Minimum Mode.
Explain that unsaved output must be saved or exported before quitting.

A stale Settings save must preserve the local draft and selection. Show the
conflict beside Save and offer an explicit reload of the current saved settings.
Confirm discarding a dirty draft before reloading. An unknown save outcome also
requires reloading before another save; never silently overwrite or merge it.

Input labels remain identifiable after typing, especially in multi-field forms.
Disclosures name what they reveal and have a full-row activation target. Opening
one preserves selection, draft and reading position. Essential actions, errors
and unsaved work remain reachable in narrow layouts and in every display mode.

Evaluate a feature in its surrounding screen and sibling surfaces. Finish the
[feature UI review](design/SKILL.md#feature-ui-review) before claiming visual
completion; a build or token check alone does not establish readability.

## Minimum Mode

Minimum Mode is the default presentation for personal use. It is reversible in
Settings (or the board's View options), independent of model configuration, and
saved locally on each surface. EZ's two windows share the setting; Saul's extension
pages and reading cards share it. The embedded board keeps its own preference.
There is no cross-app or cross-device preference sync.

| Always available                                                | Minimum Mode                                                     | Standard view                     |
| --------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------- |
| Current content, inputs, Send/Explain, Stop, Copy               | Visible                                                          | Visible                           |
| Errors, interrupted or unsaved work, missing account/model      | Visible with a useful next action                                | Same                              |
| Source, chosen preset/provider and requested speed              | Visible at the point of choice; exact recorded values in Details | Same                              |
| Model, timing, token counts, earlier attempts                   | Details or More                                                  | May also appear beside the answer |
| Follow-ups, export, deletion                                    | More or an explicit disclosure                                   | May appear in the action row      |
| Repeated instructions, keyboard coaching, local-storage slogans | Omitted                                                          | Brief guidance may appear         |

Minimum changes presentation, never execution or retention. It does not clear a
draft, alter a recipe, mute errors, change providers, send a request, or skip a
confirmation. Empty space is preferable to a new tip. Keep accessibility labels,
tooltips and focus indicators even when visible labels are shortened.

## Language and actions

Use sentence case and concrete nouns. Prefer **History**, **Settings**, **Details**,
**More**, **Copy**, **Send**, **Stop**, **Save**, and **Cancel** across surfaces.
Use **Saved**, **Waiting…**, **Thinking…**, **Saving…**, **Stopped**, **Interrupted**,
or **Incomplete** only when that state is known. Do not repeat “saved on this
device” on every answer. Place storage explanations in Settings.

Keep meaningful differences explicit. **Explain** starts a reading request from
selected text; **Send** submits a draft. **Use again** restores an editable draft;
**Regenerate** starts another attempt. A **recipe** is a prompt template; a
**preset** saves model choices; a **provider** identifies the service. Do not call
all three “model.” Hide technical identifiers from routine reading, not from the
settings or details needed to inspect them.

Keep one primary action per state. Compose: Send or Explain. Running: Stop.
Reading: Copy, with secondary actions grouped. Manual organization: act directly.
Codex proposals: review, then Apply.
An unavailable action keeps its reason nearby; it does not silently select an
alternative account, model, service tier, or billing path. Fast is a request,
not a promise of latency. Details identifies the requested speed; show the actual
service tier only when it was returned and recorded, never inferred from Fast.

## Accounts, presets, and recipes

Saul Settings leads with AI service, account/model and reading defaults. Keep
preset management, recipe editing, model tuning and diagnostics in named
disclosures. Essential meaning and billing distinctions remain visible in Minimum
Mode. Put independent preferences after the configuration Save area and label
their immediate-save behavior. The toolbar popup should support ordinary reading
and setup without requiring a full tab; use a wider desktop layout and verify
its actual browser bounds. Collapsed History entries show a short passage preview;
opening the entry reveals the full selection and answer.

Use **Continue with ChatGPT**, **Cancel**, **Add account**, **Enable plan usage**,
**Refresh models**, **Manage usage**, and **Sign out** for the same account actions.
Both surfaces use ChatGPT's direct sign-in flow and account model catalog. Each
app keeps its own sign-ins; signing in or out of one does not change the other.
Account identity and permission to use the plan are separate states. Show recovery
actions when needed; keep routine connection details behind a disclosure.

A named **preset** records a model and its supported options, including reasoning
effort and requested Fast or Standard service. A named **recipe** contains editable
prompt text and a default preset. Choose the recipe at the point of use; edit
recipes and presets in Settings. Keep one editor for each choice. An unavailable
saved choice blocks the request with a useful explanation instead of falling back.

Use the same concepts with surface-specific inputs: EZ collects recipe fields in
a draft; Saul supplies the selected passage and enabled page context. Saved
attempts retain their original prompts and model choices when configuration is
edited. Recipe and preset names are personal data, not fixed navigation labels.
ChatGPT model presets share one local store: editing a name, model, effort or speed
in either app updates new requests in both. Model choices come from each app's
signed-in account catalog. Use Model, Effort (including Default), and Speed with
Standard/Fast choices in both editors. Keep unsupported saved choices visible;
disable unsupported Fast selection. Open editors preserve drafts and require Reload
after a conflicting save. Recipes, accounts, API connections and history stay app-owned.

## Keyboard and focus

| Intent                    | EZ                                   | Saul                                                                 |
| ------------------------- | ------------------------------------ | -------------------------------------------------------------------- |
| Submit current input      | ⌘Return                              | ⌘/Ctrl+Return on a captured selection, outside editable page content |
| Stop active work          | ⌘.                                   | ⌘/Ctrl+. for the active reading card                                 |
| Dismiss a compact surface | Escape, without cancelling           | Escape, without cancelling                                           |
| Settings                  | ⌘,                                   | ⌘/Ctrl+, in the extension workspace                                  |
| New lookup                | ⌘N                                   | Not applicable; select another passage                               |
| Reading entry points      | Quick Lookup ⌃⌥Space; macOS Services | Existing Alt+Shift+E / Alt+Shift+L                                   |

EZ's configured bindings override its defaults. Do not capture browser navigation,
new-tab, find, address-bar or text-editing shortcuts to imitate a native app.
Scope commands to the active surface; let menus, forms and dialogs take priority.
Keep shortcut reference in menus/Settings, not permanent “press X to do Y” banners.
Closing a reading card leaves work running. Restore useful focus when a disclosure
or transient surface closes. Every essential action must also work by click or tap.

Saul's browser command **Saul Summarize** uses **Control+S (⌃S)** on macOS,
leaving **Command+S** with Chrome. Other platforms default to **Alt+Shift+S**.
**Control+W (⌃W)** closes only the summary panel in the current window; closing
keeps generation running. Other platforms use **Alt+Shift+W**. The panel also
offers Close. **Command+W** remains Chrome's tab command.
Settings → Shortcuts shows Chrome's actual binding and opens Chrome's shortcut
configuration; show an unassigned binding explicitly. The command summarizes
only the current regular HTTP(S) page through the same action as the context menu.

## Mobile direction

Mobile is a future surface, not a shipped app or a sync promise. Reuse these
semantics and typography roles, with one reading column, a bottom composer, and
History and Settings as separate destinations. Present Details and More as sheets;
preserve a draft when a sheet closes. Use the platform share sheet for selected
text, with explicit Send after capture.

At touch widths, allow wrapping and platform text scaling; use at least 44-point
action targets and visible tap alternatives to hover, wheel selection and dragging.
Keep Send/Stop above the keyboard and respect safe areas. Test 360–440px web
reflow now, but do not describe a narrow desktop extension as native mobile support.

## Elevation & Depth

Use tonal layers and quiet dividers for persistent surfaces. Reserve restrained
shadows for overlays that need separation from the page. Keep host-page styling
outside extension overlays, and keep overlays within the viewport.

## Shapes

Soft rectangular controls and panels follow the rounded scale. Pills are for small
status cues or floating entry points. Use existing platform icons consistently.

## Components

### Reading activity

Use a quiet thinking light on the answer boundary, matching EZ. A 24%-width
light moves smoothly across a fixed 2px divider on a 3.2-second round trip.
Use warning color while connecting/waiting and primary green only after an
explicit reasoning event. Stop the light when answer text arrives; keep a
**Generating response…** label until terminal completion, then **Saving…** and
**Saved**. Show **Connecting…**, **Waiting for answer…**, or **Thinking…** from
actual runner/provider signals, never a timer. Keep queued work labelled
**Waiting…**. Reduced motion uses a static centered light. Keep the textual
status visible in Minimum Mode and reserve the divider height to avoid jumps.

### Answer details

Give each fact one labelled place. Metadata uses aligned label/value columns,
muted labels and primary-text values; never a dot-separated sentence of unrelated
names and numbers. Wrap long values within their column. Group token counts and
timing by unit, with tabular digits and units beside the values.

Details describes the displayed answer. Keep current draft settings separate:
show them when composing, or behind **Next lookup** when reading. Do not expand
both model summaries by default. Keep requested speed and recorded service tier
separately labelled; unknown values stay unknown. Place **Details** directly beside
**Inspect input/output**, not inside More. Inspection need not repeat metadata
already available for the same answer. Use full-row disclosure targets.

### Input/output inspection

Offer **Inspect input/output** on each answer and earlier attempt, collapsed by
default in both Minimum Mode and Standard view. Inspect the recorded attempt,
never the current draft or settings. Keep its status beside the content; model identity belongs in Details.
Use labelled, selectable blocks for **Instructions**, **Context / inputs**,
**Prompt · user**, and **Response · raw text**. Context shows the saved source
fields; the assembled prompt is the authority for what was submitted. Use quiet
tonal backgrounds, a neutral rule for inputs and the shared green for response;
labels must convey the distinction without color. Preserve whitespace and literal
markup, wrap long lines, and provide Copy per block with honest failure feedback.
Show partial, empty, and unavailable data explicitly. A queued request is prepared,
not proof of delivery. This is retained model text, not an HTTP/event log or hidden
reasoning. No extra model request, credential capture, or debug-mode prerequisite.
Large blocks use searchable, bounded sections with Previous/Next and a full-text
Copy action. Keep literal text selectable and wrapped; mount one section at a time.
For summaries, show capture time, size and coverage before the source, with saved
and current input as explicit views. Comparing reads current source text on demand
(fetching the current document for local PDFs); URL attachments compare metadata
only. Never silently replace the generation's saved input.

Use a clear primary action per task, quiet secondary actions, and explicit destructive
labels. Search, lists, selection, focus, tooltips, notices, and loading feedback must
share the palette and hierarchy. Keep keyboard access and honest persisted/error states.

## Do's and Don'ts

- Keep brand roles consistent while adapting native controls and task density.
- Validate normal text contrast at 4.5:1 and meaningful control/focus contrast at 3:1.
- Show content before model details; preserve important status and provenance access.
- Avoid unrelated accent colors, nested decorative cards, and oversized branding.
- Compare real light/dark, compact/wide, populated, loading, and error states after applying.

## Motion

Motion explains a state change or spatial relationship. Favor brief, subtle feedback;
preserve readability and input responsiveness. Honor reduced-motion preferences,
including streaming indicators. Future VFX (particles, glow, distortion) are optional
accent treatments, kept away from reading text and never required to understand status.
Add concrete motion/effect tokens and platform mappings when an actual effect is adopted.

### Summaries

Custom Summarize has one home under Settings → Summaries, behind Customize
Summarize. Keep request and builder preset together; show the checked source and
action preset before explicit Load/Replace. Checking never loads code, and loading
never starts a page run. Local file checking and rollback belong in a named
disclosure. Preserve unsubmitted editor fields within the current tab through
navigation and reload. In the reader, show the saved action/preset in Details, keep progress
and Stop visible during work, and distinguish intermediate model output in
inspection from the action's completed text/Markdown answer. Built-in bilingual
summaries retain their existing layout.

The page context menu offers **Saul Summarize** for the clicked HTTP(S) tab.
Chrome reading actions open the summary in the browser's side panel and keep
the source tab active. The panel retains its current summary across tab switches;
opening another summary deliberately replaces its view. For one page, lead with the page title,
an explicit source link and plain-language progress. Avoid repeating the title
or batch counts for one page. Keep multi-tab results in their existing order.

Summarize opens a reader immediately. A summary represents one explicit
selection, possibly across windows, retaining tab order and source-window
labels. Results and source captures persist; the reader is disposable and
closing it does not cancel work. Keep **Export HTML**, **Stop**, **Retry
unfinished**, coverage and failures in the reader. History offers **Passages**
and **Summaries**. Tab surfaces show only a compact active-progress link.

In the built-in summary, English precedes equivalent Simplified Chinese. The first read has one lead
and two to four concrete points; limits stay visible, deeper material is
collapsed. Keep successful and processed counts distinct. Completion must
never steal focus or open another tab. Explain capture limitations for
video/audio pages; page text is not the media itself.

Online PDFs use the same reader, progress, failure and inspection surfaces. Keep
**PDF processing** in Settings → Summaries, independent of model presets. Default
to **PDF URL attachment (server)**; offer **Local parsing · send text**. Saving
changes the default for new summaries and Run again. Retry keeps the saved method.
URL attachments send the link to OpenAI without a Saul download. Explain beside
the result that source contents are not stored and Retry may read a newer version.
The inspector shows Prepared time and the exact file URL input; it must not invent
extracted text, character counts, page coverage or a Text unchanged result.
Keep local PDF coverage in the existing Source coverage disclosure: pages read,
pages with no extractable text, truncation and the current-document download.
Do not imply that local parsing read images or scanned text. Use the existing
failure area for unavailable URLs, model support, download, password and OCR-required
errors; never silently switch processing methods.

Repeated Summarize actions reuse the latest saved selection, matching exact URLs
and tab order, or reopen its active run. Put **Saved summary reused**, its original
date, and the input comparison before the answer. Show exact matches, whitespace
changes, token additions/removals and changed request fields separately; never call
a token estimate semantic equivalence. Unknown capture state stays explicit.
**Run again** captures current input in a new saved attempt; **Retry unfinished**
uses the original frozen input. Repeated reading requests also disclose reuse and
offer **Run again with current input**; their normal Regenerate keeps saved input.
No age threshold or estimated change score silently starts generation.
