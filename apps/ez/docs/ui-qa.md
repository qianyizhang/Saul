# Native UI regression journeys

Use production views in **EZ Surface Preview.app**, with disposable history,
synthetic providers and no accounts, Keychain, network or global shortcut:

```sh
# From apps/ez; set EZ_SWIFTPM_DISABLE_SANDBOX=1 only if nested sandboxing fails.
make surface-preview
open 'dist/EZ Surface Preview.app'
```

Start at 780 × 640, then repeat affected states in dark, Min/Standard and
**Minimum panel**. Fixture changes reset draft, search, configuration and history;
quitting removes temporary storage. Never use personal data. The control strip is
test-only. Use native Computer Use/accessibility; Playwright cannot operate these
SwiftUI/AppKit controls.

## Fixed journey

| Fixture / action                                                                                             | Expected result                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signed out → Settings → Connections                                                                            | Clear connection route and readable blockers; offline account mutations disabled.                                                                                                             |
| Empty → type/clear; Two inputs → fill using Tab                                                              | Equal Action/Preset buttons above the full-width fields; stable labels and ordered field focus.                                                                                                                                  |
| Many inputs → Tab through all eight, then Shift-Tab                                                          | Focused input scrolls into view; Run remains outside the scrolling form.                                                                                                                      |
| Two inputs → Show Quick Lookup → change preset → Details → main window → reopen → Esc                        | Draft/override survive; Details adds no duplicate selector. New resets draft/override.                                                                                                        |
| Answer → Details → Inspect; Retained draft → Edit → Hide → Reuse | Details contains the record. Answer alone offers no Edit. Edit opens the separate draft; Reuse restores the saved request without sending. Repeat in the panel; Reuse remains in its menu. |
| Answer → absent search → clear → Export/Cancel → Delete/Cancel                                               | Explicit no-results; clear restores rows; native save dialog; Cancel preserves history.                                                                                                       |
| Settings → Presets → edit → switch item/Add → Keep → Actions/Connections/Shortcuts → return → Done/Keep → Save | Section changes preserve drafts; item changes/dismissal cannot discard silently. Save disables on success. Repeat for Actions; check invalid template/save failure when changing those paths. |
| Settings → Shortcuts → record New → Esc                                                                      | Recording cancels; no lookup action or binding change.                                                                                                                                        |
| Blocked; No actions → configuration                                                                          | Answer remains readable beside errors; one useful route from empty configuration.                                                                                                             |
| Waiting/Thinking/Streaming → Stop; light/dark, Reduce Motion, narrow/wide                                    | Distinct waiting/thinking, reachable Stop, no duplicate spinner; stationary reduced-motion light. Fixtures do not prove live streaming/system motion settings.                                |
| Empty/Answer → toggle Min Mode in Settings and panel                                                         | Shared mode preserves draft/override/selection; routine hints/metrics hide, Details and blockers remain.                                                                                      |
| Answer → Invoke Quick Lookup; repeat after typing/hiding and during Streaming                                | Idle invocation clears inputs/selection, focuses first field and retains action/history. Streaming preserves work. Show Quick Lookup is the preserving fixture action.                        |
| Long metadata / Legacy answer                                                                                | Wrapped IDs; missing metrics/tier explicit; no fabricated historical values.                                                                                                                  |
| Prose corrections                                                                                            | Aligned paragraphs at wide width; Corrected-first disclosure at narrow width; literal response remains inspectable.                                                                           |

**Menu priority:** with the panel actions menu open, press physical Esc twice
without refocusing. First closes the menu; second hides the panel. A tool that
clicks to focus before sending Esc invalidates this check.

Capture the native window and fresh accessibility tree after relevant actions.
Record fixture, appearance and size under root `.artifacts/ez/`. Rebind the visible
main window after a hide/close capture error; never reuse stale AX indices.

## Bound connection status

Use isolated account and endpoint fixtures when checking authenticated states.
Assign different connections to two Write presets and switch between them
while a status or catalog request is pending. Main and Quick Lookup must show
the selected preset's connection; Presets must keep a last good list visible
with its refresh error. In Connections, start Check while a passive refresh is
pending. Check remains available until the explicit request starts. Verify
that it never sends a lookup. Confirm sign-out and verify that a remote
revocation warning stays on that row after its status refresh.

## Draw, search and source images

Use Draw / Draw result / Draw waiting / Draw error. Run, inspect PNG and animated GIF output in both
surfaces, Download/Cancel and Stop; late output must not replace another run.
Connections owns credentials; Presets owns model/image options; Actions owns type,
template and default preset. Draw launcher drafts always wait for Run.

Research / Research result / Research waiting / Research error cover search status,
inline citations and failures. Use Meme blank to draw and undo back to a blocked
Run; use Meme to move/resize the image, add or edit text, then undo and redo.
Paste and drop prepare a draft. In Quick Lookup, Edit sketch opens the same draft.
Run with instructions containing `[fail]` and reopen Edit draft: objects and undo
remain. Meme result → Reuse opens one image. Meme invalid covers inline import errors.
Check both surfaces, modes, appearances and minimum size. In **Selector hitboxes**,
open Settings → Presets → Speech preview and verify the voice and preview field.
With `--actions`, use `[slow]` or `[fail]` in a Write or Draw prompt to drive
Stop and Retry through the real attempt lifecycle. All requests are synthetic;
installed Keychain, model access, billing and launcher delivery need separate acceptance.

## Row click targets

Run `make test-ui`, then check both modes and appearances:

- Click blank trailing space, padding and corners of Settings action/preset rows
  and sidebar sections. Selected/unselected hit areas must match; gaps do nothing.
- Check main Settings/Connect, History and New whitespace, plus Overview routes.
- Click disclosure chevron, label and far edge: one toggle. Expanded content must
  remain interactive without collapsing the header.
- Use **Selector hitboxes** in both windows, including **Minimum panel** (420 pt).
  Click each choice's far edge, search for a long name and for no results, inspect
  the retired preset and Speak preview, and select a supported preset. Check the
  current mark and the full name/reason on hover and through accessibility.
- Reopen with keyboard focus, type, use Up/Down and Return, and check that Escape
  closes the chooser first and returns focus. Outside click dismisses. Wheel over
  a closed choice to step; skip unavailable rows and stop at the ends. Wheel over
  the open list to scroll it and over inputs to scroll the form.
- Check unaffected dropdowns, disabled controls and keyboard focus/activation.

## Draft keyboard

In both windows, check [draft editing](../../../design/keyboard.md#editing-a-draft)
at the caret and over selected text. Use **Two inputs** (Tab between fields) and
**Answer** (follow-up). Then send with the configured shortcut and check that
single-line search and Settings fields still behave normally.

## Terminal history save failure

Quit the preview, then run:

```sh
open 'dist/EZ Surface Preview.app' --args --unsaved-attempt
```

The first synthetic terminal save fails. Check text and Draw:

1. Answer and History show Unsaved and the result explains the storage error.
   Inspect does not claim saved output.
2. Copy/Export or Download still works while the output is visible. Both
   surfaces keep the error visible in Min and Standard, light and dark.
3. Choose New and Run an explicit request. It gets a new history entry. On
   refresh, the earlier history shows only what was stored.

## Installed selected-text journey

Quit other EZ builds; use `~/Applications/EZ.app` and synthetic multiline/Unicode
text in TextEdit. Run these separate entry-point checks:

| Entry                               | Acceptance                                                                                                                                                                                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ⌃⌥Space with Accessibility access   | Exact selection fills first input, without sending. Repeat without permission/selection, with unsupported apps (empty draft), and while typing/hiding during capture (no late overwrite/reappearance). Preview never requests access or reads other apps. |
| TextEdit → Services → Look Up in EZ | Exact selection fills single-/multi-field actions without sending. If hidden, enable under System Settings → Keyboard → Keyboard Shortcuts → Services. Clipboard sentinel and source selection remain unchanged; Esc returns focus.                       |

Service rejection must preserve populated drafts, active generation and unsaved
Settings. Check cold launch (main window may appear) and signed-out delivery
(no send after sign-in). Send one synthetic draft explicitly, confirm terminal
completion/metrics, then restart for account/history restoration.
`make test-services` uses disposable pasteboards; it does not prove cross-app delivery.

[Verification](verification.md) owns dated results and remaining acceptance gaps.
Run `make check` for offline regression, then only affected native journeys for
layout/focus/interaction changes. These journeys are manual, not an unattended suite.
