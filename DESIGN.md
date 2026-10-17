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
  canvas-dark: '#20211f'
  surface: '#ffffff'
  surface-dark: '#292b27'
  subtle: '#f0f1eb'
  subtle-dark: '#30332e'
  ink: '#242722'
  ink-dark: '#e8e9e2'
  muted: '#62685d'
  muted-dark: '#b3b9ae'
  line: '#d7dcd1'
  line-dark: '#454b40'
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

Use one heading for the current task. Avoid repeating the selected navigation label,
adding a slogan above an input, or boxing every history row. A new lookup puts its
inputs near the heading; a saved answer gives that space back to reading. Keep
configuration and history management outside compact reading surfaces.

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
Reading: Copy, with secondary actions grouped. Management: Preview, then Apply.
An unavailable action keeps its reason nearby; it does not silently select an
alternative account, model, service tier, or billing path. Fast is a request,
not a promise of latency. Details identifies the requested speed; show the actual
service tier only when it was returned and recorded, never inferred from Fast.

## Accounts, presets, and recipes

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
The two apps do not sync configuration, accounts, or history.

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
