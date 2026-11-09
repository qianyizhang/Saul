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
this notice visible after navigating away and back, including in Min Mode.
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

## Min Mode

Min Mode is the default **expert everyday view**: assume the user already
knows the app and normally needs only its common tasks. Show current inputs and
answers, action/preset choices, essential state and the next useful action.
Omit routine explanatory subtext, repeated facts, coaching and decorative labels.
Remove help-only disclosures and documentation links entirely in Min Mode; do not
move explanatory paragraphs behind Details. Disclosures remain for controls,
recorded data and actionable recovery.
Keep uncommon operations in named More, Details or Settings destinations. Revealing
one task must not expand unrelated editors into the same page.

Buttons show one clear word or a familiar symbol alone, not both.
Copy, Send, Refresh and sidebar toggles use symbols in both modes. Keep complete
accessible names and tooltips. Prefer Send, Stop, Copy, Save, Reuse, Edit, Add,
Remove, Reload and Connect. Dynamic user-authored names, selected values and
keyboard bindings are not action wording. Destructive confirmations retain their
exact scope. Save retries only persistence; regeneration remains a distinct action.
Errors, unsaved work and unavailable choices remain visible. Keep action scope and
billing/permission meaning in control names, tooltips and consequential confirmations,
without permanent explanatory paragraphs.

It is reversible in
Settings (or the board's View options), independent of model configuration, and
saved locally on each surface. EZ's two windows share the setting; Saul's extension
pages and reading cards share it. The embedded board keeps its own preference.
There is no cross-app or cross-device preference sync. At compact preset selectors,
omit the default Standard speed suffix; keep Fast visible. Exact speed remains in Details.

| Always available                                                | Min Mode                                                         | Standard view                     |
| --------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------- |
| Current content, inputs, Send/Explain, Stop, Copy               | Visible                                                          | Visible                           |
| Errors, interrupted or unsaved work, missing account/model      | Visible with a useful next action                                | Same                              |
| Source, chosen preset/provider and requested speed              | Visible at the point of choice; exact recorded values in Details | Same                              |
| Model, timing, token counts, earlier attempts                   | Details or More                                                  | May also appear beside the answer |
| Follow-ups, export, deletion                                    | More or an explicit disclosure                                   | May appear in the action row      |
| Repeated instructions, keyboard coaching, local-storage slogans | Omitted                                                          | Brief guidance may appear         |

Min Mode changes presentation, never execution or retention. It does not clear a
draft, alter an action, mute errors, change providers, send a request, or skip a
confirmation. Empty space is preferable to a new tip. Keep accessibility labels,
tooltips and focus indicators even when visible labels are shortened.

## Language and actions

Use sentence case and concrete nouns. Prefer **History**, **Settings**, **Details**,
**More**, **Copy**, **Send**, **Stop**, **Save**, and **Cancel** across surfaces.
Use **Saved**, **Waiting…**, **Thinking…**, **Saving…**, **Stopped**, **Interrupted**,
or **Incomplete** only when that state is known. Do not repeat “saved on this
device” on every answer. Place storage explanations in Settings.

Keep meaningful differences explicit. **Explain** starts a reading request from
selected text; **Send** submits a draft. **Reuse** restores an editable draft;
**Regenerate** starts another attempt. An **action** declares inputs, capability,
instructions and a result; a **preset** binds connection key, capability, model and
options; a **connection** is a saved account or endpoint with a stable key. Do not call
all three “model.” Hide technical identifiers from routine reading, not from the
settings or details needed to inspect them.

Keep one primary action per state. Compose: Run (EZ), Send or Explain (Saul). Running: Stop.
Reading: Copy for text or Download for an image, with secondary actions grouped. Manual organization: act directly.
Codex proposals: review, then Apply.
An unavailable action keeps its reason nearby; it does not silently select an
alternative account, model, service tier, or billing path. Fast is a request,
not a promise of latency. Details identifies the requested speed; show the actual
service tier only when it was returned and recorded, never inferred from Fast.

## Shared control symbols

[The symbol sheet](design/symbols.html) shows shared meanings, web glyphs and
native SF Symbol names. [The registry](design/symbols.json) owns these mappings;
`pnpm design:generate` emits both runtime mappings and the sheet. Do not edit the
generated copies. Copy, Send, Refresh and sidebar toggles are symbol-only in
both modes, with full accessible names and tooltips. Other familiar controls may
use symbols in Min Mode; menus, named disclosures and consequential actions retain
text where it explains scope. Use native sidebar controls on macOS.

Refresh reads current state. Reload reads saved settings and guards dirty drafts.
Reuse restores a draft without sending. Regenerate starts generation and must not
use the refresh glyph. Opening the main window uses a window glyph, not the
sidebar toggle. Close dismisses a surface; Stop cancels active work.

## Connections, presets, and actions

Settings uses focused sections: Overview, Presets, Actions, Preferences, Connections
and Shortcuts (EZ), with Saul's Calls and other app-specific destinations.
Keep the selected item beside its editor, one task visible at a time. Preserve
editor drafts across section changes; switching items or closing asks before
unsaved work is discarded. Keep native controls, existing density and Min Mode.
Advanced options belong in named disclosures; errors and billing routes stay visible.
Each Settings overview shows its own **Version · Build**, including in Min Mode.
Use the loaded app's version and build identity; show **Unavailable** when the build
identity is missing. Version bumps and build-input ownership live in [setup](docs/setup.md).

Connections is the common Settings destination in Saul and EZ. Start with ChatGPT
plan and OpenAI API. Each row uses the same order: name, one capability line, one
identification line (account email or endpoint and key suffix), then status and
Check. Render each capability as an inline-code chip (`Write`, `Draw`, `Speak`) on
one line. Render the key suffix as `sk-***abcd`, not “Key ending abcd”; keep the
endpoint and mask on the identification line. Do not show technical IDs, name editors, secret fields or cross-app footers
in the default list. Errors and recovery remain visible in Min Mode.

A saved connection pins its account or endpoint. Add creates another connection;
existing presets never follow a different selected account. Keep stable persisted
keys during migration. An unbound legacy connection asks the user to choose its
account; do not resolve conflicting account choices automatically. Setup is specific
to plan sign-in, official API key, or a custom endpoint. Keep credentials behind
the selected owner, and serialize refresh there. Replace key and Sign in again
repair the same identity. In plan setup, choose a saved account before reauthorizing;
Add another account is the explicit registration action. Sign out and Remove key state their effect on both apps.

Check is an explicit bounded protocol check, not generation. Show failures with a
recovery action and distinguish authentication, helper availability and catalog
failure. Helper setup, app binding and migration cleanup belong in Preferences →
Integrations. Model and generation options belong in Presets.

Model options come from the connection catalog, not a model-ID allowlist. Refresh
on setup, Settings entry and stale action preparation; coalesce requests and retain
only the latest successful catalog and timestamp per connection. Stop on timeout,
cancellation or connection change. Failed discovery keeps last-known options and
shows uncertainty. Confirmed removal keeps the saved model ID, marks the preset
and affected action, and offers Edit preset. Never replace the model or replay a
request automatically. Capability support remains separate from catalog membership.

Speak preview is available in both apps: short text, Generate/Stop, explicit API
billing and AI-generated audio, then deliberate playback. Audio and preview text
stay in memory. Preserve draft input while a preset is repaired.

Presets bind connection, capability, model and options. Write exposes reasoning and
requested speed where supported; Draw exposes its model and an Image settings
disclosure for size/quality. Speak exposes a Realtime model and voice, with a
short-text preview in both apps. Its Generate action shows API billing and AI-generated
audio in both display modes. Keep unsupported saved choices visible and block Run
with a useful reason. Never change the provider, model or billing route implicitly.
Plan models come from the connection's bound account catalog. API Write uses
an explicit model ID. Exact recorded choices belong in run Details.

Actions declare Write or Draw, literal prompt templates and a compatible default
preset. Choose an action at the point of use; show only compatible preset overrides.
EZ collects generated input fields; Saul supplies selected text and enabled page
context. Action names are personal data. The legacy word Recipe and JSON keys are
storage contracts, not another visible settings concept. Chaining is out of scope.

The shared settings store owns Connection definitions and Presets, including stable
keys, display names, kinds, capabilities and model options. Both apps use that same
configuration and revision; a connection rename preserves preset bindings. Legacy standalone browser bindings and Action inputs stay app-owned. History and credential
ownership follow the architecture's [data ownership](docs/architecture.md#data-ownership).
Both apps edit Draw presets and execute image actions. Speak presets can be edited
and previewed in both apps. Speech previews require
a saved preset and connection. Stop or leaving the preview cancels generation and
releases audio; audio and input are never saved to history. Realtime speech is
generative, so exact wording is not guaranteed.

Connection setup lives in Connections. Presets contains connection, capability, model
and applicable options; account selection, endpoint and credentials have no second
editor there. Standalone browser installations retain their existing local-profile editor. Each draft retains edits while navigating
between sections or items; closing or reloading confirms discarding unsaved edits.
Save validates connection syntax without requiring live credentials or model access.
Availability is refreshed on Settings entry and before stale action preparation.

## Illustration

Illustration is a Draw action in the existing action picker. It uses the same
composer, Run/Stop, Quick Lookup, History, reuse and inspection flow as Write.
There is no separate image window or duplicate connection editor. Keep the API
billing route visible at Run in both display modes. Draw launcher input prepares
a draft and waits for explicit Run, including single-field actions.

Run freezes inputs, preset, provider and the selected output format. Offer **PNG**
and **GIF · animated** in the Draw composer; the preset supplies the default.
GIF requires GPT Image 2.6 and an action without an input image. Keep an invalid
choice visible with its correction; never silently change format or model.
Stop cancels locally; it cannot promise server cancellation or prevent billing.
There are no automatic generation retries. Save exact result bytes in shared
SQLite history. Download exports the original PNG or GIF. Details shows frozen
choices. Storage failures retain the result for Download and save-only recovery.
History deletion removes owned output; external downloads remain user-owned.
Images do not offer text follow-ups. Reuse prepares an explicit new run.

Saul offers **Illustrate** beside its reading actions. Selection → Illustrate →
PNG/GIF → Illustrate starts one image generation using an API Draw preset.
Existing installations can add the starter in Settings → Actions → Add Illustrate.
Show generated images in the passage card and History, with original-byte Download.
Earlier attempts retain their own image; image loading and recovery never generate.
GIF preview offers Play/Pause and respects reduced motion.

EZ Draw actions may declare one named, required image input. Choose, paste or drop
shows its preview and a replace/remove action beside the instructions. Invalid
replacement keeps the previous image and shows a field error. Run freezes and
saves the source bytes before sending an image edit; text-only Draw still generates
from scratch. Reuse restores source and instructions; a missing source blocks Run
until reattached. History deletion removes the owned source and result.

EZ Write actions may enable **Search the web**. Each explicit Run or follow-up
requires a completed search through an API Write preset; incompatible providers
block without fallback. Show API/search charges at Run, **Searching…** from real
tool activity and prominent clickable inline citations in the answer. Record
sources and search completion with the attempt. Search failure preserves the draft
and any partial answer, marked failed. Research and Make meme are editable starters
added once; removing them does not cause them to return on launch.

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

Saul's browser command **Call Saul** uses **Control+S (⌃S)** on macOS,
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
status visible in Min Mode and reserve the divider height to avoid jumps.

### Follow-up questions

Keep **Ask a follow-up** below a completed answer in both widget presentations.
Use a labelled multiline field and **Send**; Command/Ctrl+Enter sends from that field.
Each explicit Send includes the saved source/request and earlier exchanges, retains
the answer's model choices, and creates a saved attempt. Show the submitted question
with its answer. Keep prior answers available through attempts/history. Preserve
unsubmitted drafts on dismissal and surface switches; clear only after submission
is accepted. Block empty questions, more than 2,000 characters and conversations
over 120,000 characters without silently dropping context. Stop, partial output,
errors and save-only recovery use the existing attempt lifecycle.

### Answer details

Give each fact one labelled place. Metadata uses aligned label/value columns,
muted labels and primary-text values; never a dot-separated sentence of unrelated
names and numbers. Wrap long values within their column. Group token counts and
timing by unit, with tabular digits and units beside the values.

Details describes the displayed answer. Keep current draft settings separate:
show them when composing, or behind **Next lookup** when reading. Do not expand
both model summaries by default. Keep requested speed and recorded service tier
separately labelled; unknown values stay unknown. Keep **Details** outside More.
EZ places **Inspect** inside Details in Min Mode; Standard view also exposes the
main-window inspector directly. Saul keeps **Inspect input/output** beside Details.
Inspection need not repeat metadata already available for the same answer.
Use full-row disclosure targets.

### Input/output inspection

Offer **Inspect input/output** on each answer and earlier attempt, collapsed by
default in both Min Mode and Standard view. Inspect the recorded attempt,
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

### Calls and summaries

**Call Saul** is the page command (Control+S). **Call preset** selects the work.
**Model preset** supplies the connection, model and options. Settings → Calls
shows the Call preset first. **Summarize (default)** has a Model preset selector
that saves with Settings. Its **Original summary setup** preserves the previous
ChatGPT plan route for existing installs. Unavailable saved presets remain
visible for repair and never fall through to the original setup.

**Customize Call Saul** keeps **Call request** and **Build with** together. Show
**Candidate source** and **Run with** before **Save and select**. A custom Call preset retains the approved revision and its runtime
model preset as a pair. The Call preset selector names both; switching to
Summarize never deletes custom choices. Checking never loads code; saving or
selecting initializes trusted code without starting a page run. Local file
checking and rollback belong in a named disclosure. Preserve unsubmitted editor
fields within the tab through navigation and reload.

In the reader and HTML export, identify the saved preset and model. In the reader,
keep progress and Stop visible, and
intermediate model output in inspection. Built-in bilingual summaries keep their
existing layout.

The page context menu offers **Call Saul** for the clicked HTTP(S) tab.
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
**PDF processing** in Settings → Calls, independent of model presets. Default
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
