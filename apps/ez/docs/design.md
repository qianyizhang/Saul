# Native design

[DESIGN.md](../../../DESIGN.md) owns shared presentation. Native system surfaces
stay native. `AppStyle.swift` uses `DesignTokens.swift`, generated from the
[canonical tokens](../../../design/tokens.md). Edit the source, not the generated Swift.

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
fails its first terminal save to check the result and history failure states. It starts in Min Mode without
reading/writing the personal preference. Fixture names and actions live in
[UI QA](ui-qa.md); previews do not prove installed or live-service behavior.

## Min Mode and Settings

Follow the shared [Min Mode policy](../../../DESIGN.md#min-mode). Both lookup surfaces share the local preference. The Standard metrics footer
and routine guidance stay out of Min Mode.

Settings has Overview, Presets, Actions, Preferences, Connections and Shortcuts.
Show one editor at a time, preserving drafts across sections and guarding item
changes/dismissal. Overview routes current choices to their editor. Use the shared connection-row layout; put History's title and Reveal action together.
[Surfaces](surfaces.md) owns reading/editing and action placement.

## Controls and metadata

- Both composers put equal Action and Preset choice buttons above the full-width
  inputs. The role, value and chevron share one horizontal control row. Open the button to search the
  complete catalog in its configured order; current and unavailable rows are marked.
  Long names and reasons remain available in tooltips and accessibility. Keep Fast
  visible and show the connection and billing route while composing. Other native
  dropdowns keep a full-width click/scroll target regardless of label length.
- Disclosure headers use a full-width button at least 32 points high. Chevron,
  label and whitespace toggle once; expanded content remains interactive.
  Keyboard activation and an accessible Expanded/Collapsed value are required.
- Details uses stable label/value columns, primary-text values and three-column
  token/timing groups. Wrap long IDs; show unknown metrics as a dash and missing
  actual tier as Not reported. Standard footer shows first-text and total time.
- Main composer information describes Next lookup. Quick Lookup shows Answer
  details when selected, with Next lookup collapsed in both modes.
- Give every draft field a persistent name, including a single text input. Apply the
  [Notebook editor](../../../DESIGN.md#notebook) to the composer and follow-ups.
  Keep focused fields reachable in long forms and budget fewer lines in Quick Lookup.
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
text collapsed. Literal output is available in the reader’s Saved text view in both modes.
[SpellingComparison](../Sources/EZCore/SpellingComparison.swift) compares only
completed single-input results with recognized headings; long or ambiguous
inputs keep readable fallback text. It removes Markdown decoration only for the
comparison, aligns unchanged-word anchors across paragraphs/lists and leaves a
cell empty where no matching block exists. Copy and export retain literal output.

Show **Searching…** only from observed search-tool activity; search/API charges
stay beside Run. Citations are clickable in both readers. Generic image fields show preview,
Choose/Replace, Paste and Remove above instructions. Make meme uses a square
Sketch canvas in the main window, with Draw, Select, Add text, undo and redo.
The selected image shows a resize handle; the selected text shows its editor.
Quick Lookup has a compact preview, Paste and Edit sketch. Errors stay beside the
image; Run and API charges stay reachable. Details records search
required/completed and source name. Reuse prepares a draft without sending.

[Shared control symbols](../../../design/symbols.html) defines the glyphs and
meanings used by both apps. Symbol-only controls retain full accessible names and
tooltips in Min Mode and Standard view.

## Speak preview

Presets uses a saved Realtime model and strict voice choice. Show API billing
and AI-generated audio with Generate/Stop and deliberate playback. The
[client](../Sources/EZCore/SpeechPreviewClient.swift) receives only short-lived
authorization, bounds the stream and creates WAV only after completion.
Leaving the view cancels work and releases in-memory audio; preview text and
audio never enter history.
