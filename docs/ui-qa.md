# Native UI regression journeys

Use the built **EZ Surface Preview.app** for repeatable manual UI checks. It compiles
production views against disposable offline storage, blocks account/inference
operations, and does not register the global shortcut. Playwright can test a web
review page, but cannot operate EZ's native SwiftUI/AppKit controls. Use native
Computer Use and its accessibility tree for the journeys below.

```sh
EZ_SWIFTPM_DISABLE_SANDBOX=1 make surface-preview
open 'dist/EZ Surface Preview.app'
```

Run at the initial 780 × 640 preview window, then in dark appearance. The preview
control strip is test-only; it is not part of the shipped UI. Use **Minimum panel**
for compact checks. Fixture selection resets draft, search, configuration, and
visible history. Quit the preview to remove this run's temporary directory.
Never substitute personal account/history data for these fixtures.

## Fixed journey

| Step | Fixture and actions | Regression expectation |
| --- | --- | --- |
| 1. First run | Signed out → Continue with ChatGPT → Account & history → expand Keychain explanation → Done | The sign-in route is clear; help is readable. Account mutations remain disabled in the offline preview. No automatic sign-in or inference. |
| 2. Compose | Empty → type a word → clear it; choose Two inputs → fill first field → Tab → fill second | One recipe selector. Completing the last required input changes the hint without moving the composer. Tab follows the field order. |
| 3. Long form | Many inputs → focus Input 1 → Tab seven times → type → Shift-Tab back | The focused field scrolls into view, including Input 8. Send remains outside the scrolling form. Repeat in Minimum panel. |
| 4. Surface handoff | Fill Two inputs → Show Quick Lookup → change preset → information button → dismiss popover → Open EZ & history → reopen panel → Esc | Inputs and override survive the handoff; details contain no second preset selector. Esc hides without clearing. New resets the override and draft. |
| 5. Read and reuse | Answer → Details → collapse → Edit draft → Hide draft → Use again | Answer and actions are readable without the composer dominating the window. Requested/served tier and clearly labeled token/timing metrics remain available. Edit draft preserves current inputs; Use again restores saved recipe, inputs, and preset without sending. Repeat reading/editing in Quick Lookup. |
| 6. Find and export | Answer → search for absent text → Clear search → More → Export → Cancel; More → Delete lookup → Cancel | Explicit no-results state; clearing search restores the row. Cancel leaves the lookup intact. Export opens the native save dialog. |
| 7. Configure | Settings → Configuration → edit preset name → select another preset → Keep editing → visit Account/Shortcuts → return → Done → Keep editing → Save preset | Unsaved text survives section changes. Switching items, Add, and closing cannot silently discard edits. Save becomes disabled after success. Repeat for a recipe, including invalid template and save failure checks when changing their handling. |
| 8. Shortcuts | Settings → Shortcuts → record New lookup → Esc | Escape cancels recording and returns to Settings; it must not execute lookup navigation. Existing bindings remain unchanged. |
| 9. Recovery | Blocked; then No recipes → Configure recipes | Saved/partial answer remains readable with storage/error notices. No recipes gives one clear configuration action rather than unusable model controls. |
| 10. Appearance and activity | Answer and Thinking in light/dark; Waiting/Streaming; Reduce motion; minimum/wide panel | Text/actions remain visible. Waiting and thinking are distinguishable; Stop stays reachable. No spinner duplication; reduced motion removes travel. Simulated fixture state is not live streaming evidence. |
| 11. Minimum Mode | Empty → toggle Minimum Mode off/on; Answer → Quick Lookup → actions → Minimum Mode; Settings → Minimum Mode | Both surfaces share the mode without losing draft, preset override, or selected answer. Minimum Mode hides routine hints and metric strips; Details retains metrics and exact request metadata. Blocked and Signed out retain their notices and recovery controls. |
| 12. Menu priority | Quick Lookup → actions menu → physical Esc → physical Esc | Verify that the first Escape closes the menu and keeps the panel visible; the second hides the panel. This remains a direct-keyboard acceptance check. |

For menu-priority checks, send keys without refocusing the window. Computer Use
can click to focus before sending Escape, which dismisses the menu first and
invalidates that sequence. The automated pass does not establish native menu-first
Escape behavior.

Capture the native window and accessibility state after the relevant action. Save
screenshots outside Git and record appearance, fixture, and window size. On a
capture error after a window closes/hides, rebind the visible main window; do not
assume the action failed or repeatedly capture a stale window. Use current element
indices from each fresh accessibility tree, never a checked-in list of AX indices.

## Installed selected-text journey

Use the installed `~/Applications/EZ.app`, after quitting any other EZ build.
In TextEdit, create an unsaved document containing synthetic Unicode/multiline
text. Select it and choose **TextEdit → Services → Look Up in EZ**. If hidden,
enable the service in System Settings → Keyboard → Keyboard Shortcuts → Services.

- With an empty EZ draft, verify Quick Lookup contains the exact selection in the
  recipe's first field and does not send. Check both single- and multi-field recipes.
- Verify the source selection and clipboard remain unchanged. Use only a synthetic
  clipboard sentinel for this manual journey. Escape should return focus to the source app.
- Invoke again with the populated draft, during generation, and while EZ Settings
  has an unsaved configuration edit. Each rejection must preserve that work.
- Repeat with EZ stopped to check cold delivery; the main window may also appear.
  Check signed-out delivery separately: the draft must never send after sign-in.
- Press Send explicitly on a synthetic selection, check terminal completion and
  saved metrics, then restart to check history/account restoration.

`make test-services` exercises the callback with disposable pasteboards; it does
not substitute for the installed cross-app journey above.

## Evidence

Dated results and remaining gaps live in [verification](verification.md). Keep
screenshots local and outside Git; identify each capture's fixture and appearance.

These are repeatable acceptance journeys, not an unattended GUI test suite. Run
`make check` for deterministic offline regression checks, then replay the affected
native journeys for layout, focus, and interaction changes.
