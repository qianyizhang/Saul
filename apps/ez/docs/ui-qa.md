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
| Signed out → Settings → Providers                                                                            | Clear connection route and readable blockers; offline account mutations disabled.                                                                                                             |
| Empty → type/clear; Two inputs → fill using Tab                                                              | One action selector; stable hint space; ordered field focus.                                                                                                                                  |
| Many inputs → Tab through all eight, then Shift-Tab                                                          | Focused input scrolls into view; Run remains outside the scrolling form.                                                                                                                      |
| Two inputs → Show Quick Lookup → change preset → Details → main window → reopen → Esc                        | Draft/override survive; Details adds no duplicate selector. New resets draft/override.                                                                                                        |
| Answer → Details → Edit → Hide → More → Reuse                                                                | Reading has space; metadata/metrics remain available. Edit preserves current draft; Reuse restores saved action/inputs/preset without sending. Repeat in panel.                               |
| Answer → absent search → clear → Export/Cancel → Delete/Cancel                                               | Explicit no-results; clear restores rows; native save dialog; Cancel preserves history.                                                                                                       |
| Settings → Presets → edit → switch item/Add → Keep → Actions/Providers/Shortcuts → return → Done/Keep → Save | Section changes preserve drafts; item changes/dismissal cannot discard silently. Save disables on success. Repeat for Actions; check invalid template/save failure when changing those paths. |
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

## Draw, search and source images

Use Draw / Draw result / Draw waiting / Draw error. Run, inspect PNG and animated GIF output in both
surfaces, Download/Cancel and Stop; late output must not replace another run.
Providers owns credentials; Presets owns model/image options; Actions owns type,
template and default preset. Draw launcher drafts always wait for Run.

Research / Research result / Research waiting / Research error cover search status,
inline citations and failures. Meme / Meme result / Meme invalid cover required
image input, invalid replacement preserving the source, result and Reuse.
Check both surfaces, modes, appearances and minimum size. All requests are synthetic;
installed Keychain, model access, billing and launcher delivery need separate acceptance.

## Row click targets

Run `make test-ui`, then check both modes and appearances:

- Click blank trailing space, padding and corners of Settings action/preset rows
  and sidebar sections. Selected/unselected hit areas must match; gaps do nothing.
- Check main Settings/Connect, History and New whitespace, plus Overview routes.
- Click disclosure chevron, label and far edge: one toggle. Expanded content must
  remain interactive without collapsing the header.
- Check dropdown far edges, disabled controls and keyboard focus/activation.

## Unsaved answer recovery

Quit the preview, then run:

```sh
open 'dist/EZ Surface Preview.app' --args --unsaved-attempt
```

The first synthetic terminal save fails; Save again succeeds. Check text and Draw:

1. Answer and History say Unsaved; Save error and Inspect do not claim persistence.
2. Both surfaces expose Save, Copy/Export (Download for images where applicable),
   including Minimum panel and both modes/appearances.
3. New → type another draft → select Unsaved: result/recovery survive, draft unchanged.
4. Save again clears Unsaved only after storage succeeds, preserving result/draft.
   Cancelled export leaves the attempt intact; no generation is repeated.

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
