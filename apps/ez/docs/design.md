# Native design

[DESIGN.md](../../../DESIGN.md) owns Little Clarity: green accent, serif subjects,
system controls, quiet surfaces and reading space. Native system surfaces stay
native. `AppStyle.swift` connects generated `DesignTokens.swift` roles to EZ;
never hand-edit tokens. The generated file records its source SHA-256.

## Feature UI review

Follow the shared [feature UI review](../../../design/SKILL.md#feature-ui-review).
Map the task and information hierarchy before editing; use [surfaces](surfaces.md)
for placement and [UI journeys](ui-qa.md) for acceptance. Review affected main,
Quick Lookup and Settings states, including long/missing values, errors,
Min/Standard and light/dark. Shared token changes need rendered review in both apps.

From the monorepo root, with Node 24 and pinned dependencies:

```sh
pnpm design:generate
pnpm design:check
```

Then run EZ's `make format`, `make check` and native review. Ordinary Swift builds
need no JavaScript runtime or sibling checkout. Move/version the generator with
the contract. Keep captures outside Git under root `.artifacts/ez/`; record material
acceptance limits in [verification](verification.md).

## Offline previews

Run these from `apps/ez`; each builds a separate app under `dist/` from production
views and stages/verifies its bundle before replacement.

| Command                | Use                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `make design-preview`  | **EZ Design Preview.app**: disabled production controls, main/Settings and appearance comparison                   |
| `make surface-preview` | **EZ Surface Preview.app**: interactive fixtures, synthetic Write/Draw providers, main/panel and Settings journeys |

Previews use disposable history, no real accounts/Keychain/network, and no global
shortcut. `surface-preview` uses an in-memory API key store; `--unsaved-attempt`
fails its first terminal save for recovery checks. It starts in Min Mode without
reading/writing the personal preference. Fixture names and actions live in
[UI QA](ui-qa.md); previews do not prove installed or live-service behavior.

## Min Mode and Settings

Follow the shared [Min Mode policy](../../../DESIGN.md#min-mode). The local
preference defaults on and is shared by both lookup surfaces. Short labels retain
full accessible names/help. Hide routine hints, help-only disclosures, documentation
links and pinned metric strips; retain errors, blocked choices, unsaved work and
recovery. Omit the routine Standard preset suffix; Fast stays explicit.

Settings has Overview, Presets, Actions, Preferences, Providers and Shortcuts.
Show one editor at a time, preserving drafts across sections and guarding item
changes/dismissal. Overview routes current choices to their editor. Align the plan
account actions in one row; put History's title and Reveal action together.
[Surfaces](surfaces.md) owns reading/editing and action placement.

## Controls and metadata

- Dropdowns keep a full-width click/scroll target regardless of label length.
  Quick Lookup's footer preset selector is 250 points wide, with adjacent Details.
- Disclosure headers use a full-width button at least 32 points high. Chevron,
  label and whitespace toggle once; expanded content remains interactive.
  Keyboard activation and an accessible Expanded/Collapsed value are required.
- Details uses stable label/value columns, primary-text values and three-column
  token/timing groups. Wrap long IDs; show unknown metrics as a dash and missing
  actual tier as Not reported. Standard footer shows first-text and total time.
- Main composer information describes Next lookup. Quick Lookup shows Answer
  details when selected, with Next lookup collapsed in both modes.
- Multi-input fields keep labels after typing; single-input fields use a compact
  placeholder. Reserve hint space and scroll keyboard-focused fields into view.
  Fixed shortcut references also use aligned label/value rows.

## Activity and answer presentation

`ThinkingDivider` uses yellow while waiting and green after a reasoning-item event.
Its 3.2-second round trip spans at most 84 points, with a 2-point core and 3-point
glow. Reduce Motion uses a stationary light. The light stops permanently at first
answer/refusal text or termination; hidden panels remove it. Do not add a second spinner.

Long passages use body typography. Recognized completed Spell Check answers show
Original/Corrected: removed text has warm tint/strikethrough; additions green/underline.
Labels make color nonessential. Wide layouts align paragraph rows in one scroll
area; narrow layouts show Corrected first and disclose Original. Notes sit under
Why these changes. Unrecognized formats keep ordinary reading with long original
text collapsed. Literal output remains in Details → Inspect; Standard also exposes
the main inspector directly. [Architecture](architecture.md#spelling-comparison-presentation)
owns parsing and bounds.

Search citations are clickable in both readers. Image fields show preview,
Choose/Replace, Paste and Remove above instructions; errors stay beside the image.
Quick Lookup reserves attachment space and keeps Run reachable. API/search charges
remain visible in both modes. Details records search required/completed and source
name. Reuse prepares a draft without sending.
