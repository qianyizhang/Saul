# Native design

[DESIGN.md](../../../DESIGN.md) owns shared presentation. EZ uses native semantic
controls and `AppStyle` roles backed by generated `DesignTokens.swift`. Use the
[shared generator](../../../design/SKILL.md#generate) to change those roles.

## Feature UI review

Follow the shared [feature UI review](../../../design/SKILL.md#feature-ui-review).
Use [surfaces](surfaces.md) for placement, [UI journeys](ui-qa.md) for acceptance
and [verification](verification.md) for evidence and limits.

## Offline previews

Run these from `apps/ez`; each builds a separate app under `dist/` from production
views and stages/verifies its bundle before replacement.

| Command                | Use                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `make design-preview`  | **EZ Design Preview.app**: disabled production controls, main/Settings and appearance comparison                   |
| `make configuration-preview` | **EZ Configuration Preview.app**: editable Settings and synthetic connections, catalogs and recovery |
| `make surface-preview` | **EZ Surface Preview.app**: interactive fixtures, synthetic Write/Draw providers, main/panel and Settings journeys |

Previews use disposable history, no real accounts/Keychain/network, and no global
shortcut. `surface-preview` uses synthetic connection status. `--unsaved-attempt`
fails its first terminal save to check the result and history failure states. It starts in Min Mode without
reading/writing the personal preference. Fixture names and actions live in
[UI QA](ui-qa.md); previews do not prove installed or live-service behavior.

## Min Mode and Settings

Follow the shared [Min Mode policy](../../../DESIGN.md#min-mode). Both lookup surfaces share the local preference. The Standard metrics footer
and routine guidance stay out of Min Mode.

**Reveal history** sits in **Settings → Preferences**. See [surfaces](surfaces.md)
for the Settings sections, reading and editing journeys.

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

[`ThinkingDivider`](../Sources/EZ/ThinkingDivider.swift) uses yellow while waiting,
green after a reasoning-item event and a stationary light with Reduce Motion.
The light ends at first answer/refusal text or termination. Hidden panels remove it.
Keep one activity indicator.

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

Show **Searching…** only from observed search-tool activity. Generic image fields
place preview, Choose/Replace, Paste and Remove above instructions. Keep errors
beside the image and Run and API charges reachable. Make meme's square Sketch
canvas shows a resize handle for a selected image or an editor for selected text.
See [image and search actions](surfaces.md#image-and-search-actions) for the
journeys in both lookup surfaces.

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
