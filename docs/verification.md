# Verification

## Repeatable offline gate

Run `make tools` once, then `make check`. This checks Swift formatting and correctness,
ShellCheck plus shell syntax, GitHub Actions with actionlint, and plist syntax.
Compilation rejects warnings and enables complete Swift concurrency checking in
the existing Swift 5 language mode. The gate also typechecks the icon and all
native preview entry points without opening windows. It compiles the app
and runs both offline executable suites. The selected Apple Command Line Tools
provide neither XCTest nor Swift Testing, so the harness keeps the checks runnable
locally and in CI without requiring the full Xcode app or third-party test frameworks.
The linters are development binaries; they add no app dependencies. See
[development setup](../CONTRIBUTING.md#development-setup-and-gates) for pinned tools,
commit/push hooks, and the hosted toolchain.

Core cases live by behavior in `Tests/EZChecks`; app-state cases live in
`Tests/EZStateChecks`. Both use the check-only `EZCheckSupport` module, named
cases, file/line diagnostics, expected error types, independent disposable storage,
and failure aggregation. HTTP sessions own their handlers and request logs;
AppModel fixtures are fresh and seeded before initialization. See
[the testing guide](../Tests/README.md) for filtering, listing, order checks, and
fixture ownership. `make test` runs both suites even when one reports failures.

Coverage includes templates, presets, configuration storage, immutable recipe
history, launcher validation, history snapshots/permissions/deletion/recovery,
failed writes, exclusive session ownership, PKCE/form encoding, callback validation,
signed OIDC verification and invalid claims, model capabilities, request-body
constraints, SSE parsing/completion/errors, fragmented Unicode through URLSession,
and credential restore/refresh. Refresh checks assert one request for overlapping
callers, persisted rotation, retained scopes, reload behavior, failure-state
preservation, and missing permission. RSA keys are generated in memory with system
OpenSSL; identity checks use a fixed clock. No private fixture is committed.
The suites do not use the network, Keychain, or a real ChatGPT account.

For restricted agent execution use `EZ_SWIFTPM_DISABLE_SANDBOX=1 make check`.
This keeps the outer sandbox active and places compiler caches in `.build/`.
macOS `iconutil` may need specifically approved execution outside that sandbox;
valid image dimensions alone do not prove icon packaging succeeded.

## Native acceptance checks

1. `make app`, open `dist/EZ.app`, inspect both window and settings.
2. Complete **Continue with ChatGPT** yourself. Verify the account and model picker.
3. Send a short Dictionary lookup with standard service. Confirm streamed text,
   terminal completion, and pending/completed JSONL snapshots with the same UUID.
4. Send a spelling query with Fast where supported. Verify the actual returned
   service tier separately from the selected toggle.
5. Restart the app. Confirm the saved account and history reload.
6. For related changes, check cancellation, search, copy, export, and keyboard
   shortcuts. Test live logout only when willing to end that app session.

Do not capture or commit credentials, authorization URLs, or personal query data.
Use synthetic inputs. A connected badge proves sign-in only; a model picker proves
catalog discovery only; completed inference proves that request succeeded.

## Quality gates — 2026-10-14

- `make format`, `make lint`, and the full pre-push gate passed with Apple Swift
  **6.3.3**, swift-format **6.3.0**, SwiftLint **0.65.1**, ShellCheck **0.11.0**,
  and actionlint **1.7.12** on Apple Silicon.
- **41/41 core checks** and **14/14 app-state checks** passed with compiler warnings
  treated as errors and complete concurrency checking. Icon generation and all
  three native preview entry points passed strict typechecking without launching.
- Commit hooks passed for tracked files and the newly added configurations/scripts.
  Both Git hooks were installed; repeated installation passed with pre-commit's
  generated runners and repository-local caches.
- Release compilation passed. Sandboxed `iconutil` reported `Invalid Iconset`;
  specifically approved `make app` outside the sandbox then packaged the bundle
  and passed `codesign --verify --strict` with local ad-hoc signing.
- Hosted CI remains unrun: no Git remote is configured. Native UI, live inference,
  Intel execution, Developer ID signing, and notarization were not exercised here.

## Initial local evidence — 2026-10-13

- Formatting, Swift debug build, and **15 offline checks passed**.
- Release bundle built; local ad-hoc signature verified.
- Native window and settings inspected through the macOS accessibility tree and screenshot.
- User completed real ChatGPT consent; live model/effort/Fast capabilities loaded.
- Dictionary query `Serendipity`: `gpt-6.1-sol`, `low`, returned tier `default`,
  **8.46 seconds**, completed response, **423 characters** saved to local JSONL.

- Spell Check: `gpt-6-luna`, `low`, requested `priority`, returned **`default`**,
  **4.36 seconds**, corrected text completed and saved. Priority serving is **not
  confirmed** for this account/route; the UI shows request and actual tier separately.

- Restart recovered the saved ChatGPT account and all three lookup records after
  the macOS Keychain access prompt was handled by the user.

These are local results, not hosted CI results. Remote CI, notarization,
distribution on another Mac, and live token expiry/remote revocation are not verified.

## Cleanup evidence — 2026-10-13

- Formatting, debug compilation, and all **15 offline contract checks passed**
  after splitting the views and polishing settings/preferences/warnings.
- Release bundle built and ad-hoc signature verified.
- Deliberately nonexistent signing identity caused packaging to fail as expected.
  SHA-256 comparisons of every previous bundle file confirmed it was unchanged.
  Both failed and successful packaging removed their temporary staging directories.
- Settings now scrolls so expanded Keychain guidance remains reachable in a bounded
  sheet. Its new layout and immediate preference saving have not been manually
  rechecked in the running app. This pass did not repeat live account/inference
  checks or approve any Keychain prompt; the earlier live evidence remains separate.

## Quick Lookup implementation — 2026-10-13

- `make format` and `EZ_SWIFTPM_DISABLE_SANDBOX=1 make check` passed: Swift lint,
  plist/shell checks, debug compilation, and all **15 existing offline contracts**.
  These protect the shared request/history flow; they do not exercise native panel
  focus or hotkey registration.
- Release compilation passed. Sandboxed packaging stopped at `iconutil` with
  `Invalid Iconset`; specifically approved `make app` outside the sandbox completed
  the bundle and verified its local ad-hoc signature.
- Native UI inspection was blocked by the computer-use service returning
  `timeoutReached` (-10005). No new panel screenshot, keyboard/focus acceptance,
  or live inference is claimed for this change.

Pending native acceptance using the newly built `dist/EZ.app`:

1. From another app, press Control–Option–Space. Confirm a focused panel on the
   pointer's display; type and explicitly paste synthetic text. Escape should
   return keyboard input to the previous app. Repeat with a full-screen app and
   multiple displays when available.
2. Reopen the panel and confirm the draft survives. Command–N clears it when idle.
   Repeated shortcut toggles and Command–W hide/reopen without losing the draft.
3. Open preset details; compare the preset, model, effort, and requested speed with the main window.
   Choices must remain shared, and unavailable presets must block sending. Account
   settings and history buttons must open the main window, including after closing it.
4. With an already authorized account, send a synthetic lookup with Command–Return.
   Confirm streaming, copy, actual service tier, and the same history entry in both
   surfaces. Escape should allow generation to continue; reopen to see its result.
   Repeat with Command–period to verify interruption and preserved partial text.
5. Check signed-out/unavailable-model, storage warning, and failed-request messages
   are readable and the relevant send action stays disabled. Check the smallest
   panel size with preset details open and with a long answer.
6. Where another app already holds Control–Option–Space, confirm the warning and
   menu-bar fallback. Quit EZ and verify it releases the shortcut; relaunch and
   verify registration and saved preferences/history recover normally.

## Raycast integration — 2026-10-13

- `make format` and `EZ_SWIFTPM_DISABLE_SANDBOX=1 make check` passed: Swift lint,
  shell/plist validation, debug compilation, and **16 offline checks**. The added
  check covers Unicode, literal plus, reserved characters, decode-once behavior,
  blank input, unknown/duplicate parameters, invalid routes, and UTF-8 size limits.
- Specifically approved `EZ_SWIFTPM_DISABLE_SANDBOX=1 make app` built and locally
  signed the final release bundle. Installed it in `~/Applications/EZ.app` after
  gracefully quitting idle EZ. `codesign --verify --strict` and recursive bundle
  comparison against `dist/EZ.app` passed; history and credentials were retained.
- Raycast's Script Commands settings now include this repository's
  `integrations/raycast` folder. Native settings inspection confirmed **EZ Lookup**
  has alias **ez**. Root search confirmed `ez Space` enters the query argument.
- Entered the synthetic query `Define serendipity in one sentence.` in Raycast and
  pressed Return. Cold launch opened the native compact panel and completed an
  answer, using `gpt-6-luna`, `low`, requested `priority`, served **`default`**.
  The installed process had `--ez-launcher`; no full window was shown on that launch.
- Warm submission of `Explain "你好" + "hello" & "hi" in one sentence.` preserved
  exact decoded text and completed an answer. Opening history from the cold-started
  panel worked and exposed the same saved response in the full window.
- Final-build cold submission of `Define equanimity in one sentence.` plus an
  immediate second submission displayed the refusal warning while the first
  lookup ran. The warning remained visible after completion, and the first query
  and answer were preserved. Targeted local history inspection confirmed **zero
  records** for the refused query.
- Native acceptance ran on **macOS 26.6.2** using the installed `.app`. macOS 14's
  fallback window presentation, other displays/full-screen Spaces, signed-out and
  storage-failure UI journeys, and fresh live expiry/revocation remain unverified.
  Existing offline authentication/storage contracts passed. No additional sign-in,
  logout, billing provider, or account change was performed. Fast service remains
  requested but actual priority serving is not established.

## Model presets and recipes — 2026-10-14

- `make format` and `EZ_SWIFTPM_DISABLE_SANDBOX=1 make check` passed, including
  **22 core contract checks** and **3 AppModel state-check groups**. Coverage includes
  ordered/deduplicated template inputs, literal insertion, missing/malformed fields,
  unsupported preset capabilities, local configuration persistence and permissions,
  corrupt-file preservation, failed-save recovery, backward-compatible history,
  compiled request payloads, deleted-recipe replay, temporary overrides, busy guards,
  and single- versus multi-field Raycast preparation. Existing identity, permission,
  refresh, interrupted-stream, and history-failure contracts also passed.
- `make configuration-preview` builds production SwiftUI views with disposable
  configuration, an explicitly labelled synthetic model catalog, and account/live
  inference actions blocked in `AppModel`. Native interaction verified editing and
  saving a two-field recipe, creating a custom recipe, removing a starter, refusing
  removal of a referenced preset, generated fields in both usage surfaces, preset
  overrides preserving inputs, and New lookup restoring the recipe default.
- The final preview was relaunched after the last code edits. Configuration and its
  generated-input preview were captured in light/dark appearance; the main window
  displayed the Lookup fields and dynamic recipe shortcuts. Screenshots remain
  outside Git and can be shown in Codex for annotation.
- Release compilation passed. Sandboxed `iconutil` reported `Invalid Iconset`;
  approved `EZ_SWIFTPM_DISABLE_SANDBOX=1 make app` then packaged and verified the
  local ad-hoc signature of `dist/EZ.app`.
- This pass did not replace the installed app, alter personal configuration/history,
  sign in, or repeat live inference. Account-catalog availability, live recipe
  responses, and the complete Raycast-to-network journey remain separate acceptance
  checks. The native offline preview establishes UI behavior, not live inference.

## Surface contract and compact panel — 2026-10-14

- Canonical responsibilities live in [surfaces](surfaces.md), with product terms in
  [the glossary](../GLOSSARY.md). Recipes/presets follow ADR 0002; this slice does
  not change authentication, inference, or persistence.
- `make format`, `EZ_SWIFTPM_DISABLE_SANDBOX=1 make check`, and approved `make app`
  passed. The gate includes **22 offline contracts** and AppModel state checks;
  the release bundle passed `codesign --verify --strict`.
- Built `make surface-preview` and inspected its production SwiftUI views and
  actual NSPanel using disposable storage and blocked account/inference actions.
  Checked light/dark answers, two-field inputs with Tab traversal, long-form
  scrolling, visible blocked/no-recipe recovery, preset override/reset, and
  draft preservation across Escape/reopen and main-window handoff. Request details
  expose recorded actual tier separately from next-request choices.
- Native review found excess top padding and lost focus after field replacement;
  both were corrected. The final fixture focuses its first generated input.
- Fixture answers are synthetic, not live inference. Minimum-size resizing,
  external-app focus return, global hotkey registration, full-screen/multi-display
  behavior, and live streaming/cancellation were not accepted in this pass.
  No installed personal app bundle was replaced. Screenshots remain outside Git.


## Review and simplification — 2026-10-14

- Unified both recipe input forms and focus handling; background windows no longer
  compete for focus. Native inspection confirmed recipe changes and New lookup
  focus the first field in the active surface.
- Raised the panel's minimum height with its content. At the 420-point minimum
  width, the answer scrolls while Send, Copy, and preset details remain visible.
- A regression check reproduced configuration saves discarding an unsent preset
  override. Fixed that path and verified saved recipe replay also survives edits;
  New lookup returns to a remaining live recipe when needed.
- Consolidated three native preview builders into `scripts/preview.sh`; all three
  targets built and passed signature verification. Multi-field launcher completion
  no longer appears as an error, and plan-access recovery opens Account settings.
- Rechecked the request contract against the official [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
  documentation. Account, billing, and HTTP endpoint contracts are preserved.
- Formatting and offline checks passed: **22 core contracts** and three AppModel
  state-check groups, including the new configuration-edit regression cases.
  A clean export of the staged tree also passed `make check`; the release bundle
  passed strict signature verification. Live inference and full-screen/multi-display
  acceptance remain separate.


## Post-upgrade credential restoration — 2026-10-14

- The installed process retained all **19** history entries, with byte-identical
  `history.jsonl`, and migrated the prior preferences into one preset and four
  starter recipes. Bundle identity and strict code-signature checks passed.
- Native inspection timed out. A one-second process sample placed the main thread
  in `ChatGPTAuth.load → KeychainStore.read → SecItemCopyMatching`, waiting on
  macOS Security. No credential contents were inspected or exported.
- Moved the Keychain read off the UI actor and made credential restoration async.
  A cancellation check prevents late reads from replacing account state. The
  stored schema, item query, access permissions, account selection, and write path
  remain unchanged.
- `make format` and `make check` passed: **23 core contracts** plus three AppModel
  state-check groups. A suspended-read test verifies UI-actor progress, atomic
  restoration, cancellation, and preservation on storage failure. Existing identity,
  permission, refresh, stream, and storage contracts still pass.

## Lookup deletion — 2026-10-14

- `make format` and `EZ_SWIFTPM_DISABLE_SANDBOX=1 make check` passed: Swift
  lint/build, shell/plist validation, **25 offline contracts and four AppModel
  state-check groups**. Deletion checks cover all snapshots for an ID, identifiable
  damaged snapshots, byte preservation for unrelated records/tails, owner-only
  replacement, reload, missing/empty stores, subsequent appends, temporary-file
  cleanup, storage failures, draft/selection handling, and busy/launcher guards.
- Built `EZ Surface Preview.app` and inspected production views with disposable
  offline fixtures. Verified the answer action and history-row context menu,
  destructive confirmation, Cancel preserving the answer, and deletion changing
  the history count from **1 to 0** while retaining the input draft. Persistence
  and failure behavior were tested by the offline suites; the preview's synthetic
  answer is generated in memory. No personal history was deleted.
- `make app` built `dist/EZ.app` and verified its local ad-hoc signature. The
  restricted packaging attempt stopped at `iconutil` (`Invalid Iconset`); approved
  execution outside that sandbox completed successfully. The installed app in
  `~/Applications` was not replaced.
- Live account/inference checks were not repeated; this change does not alter
  authentication or inference. Bulk deletion and automatic retention remain planned.

## Test cleanup evidence — 2026-10-14

- Preserved the previous 25 core contract groups and four AppModel groups while
  separating behavior files and independent scenarios. The suites now report
  **41 core/support cases and 14 app-state cases**; this is a case count, not a
  coverage percentage. No XCTest, Swift Testing, or runtime dependency was added.
- `make format` and `EZ_SWIFTPM_DISABLE_SANDBOX=1 make check` passed, including
  Swift/shell/plist lint, the app build, and all 55 offline cases. Both suites also
  passed in reverse order. Focused core/state filters and case listing passed.
  The staged source tree also passed `make check` from a clean temporary checkout.
- Runner checks cover continuation after a failure, temporary-directory cleanup,
  source/value diagnostics, filtering/listing/order, wrong-error rejection,
  simultaneous HTTP-fixture isolation, handler-error delivery, held-request
  cancellation, and early/cancelled fixture signals. The review also removed
  redundant files and unsafe fixture indexing, preserved errors across URLSession,
  and joined overlapping refresh tasks on failure.
- In a disposable source copy, removing refresh coalescing failed with two requests
  instead of one; removing credential persistence failed with zero writes instead
  of one; dropping retained scopes also failed. The copy was removed and the
  working authentication source was unchanged. These probes establish that the
  strengthened refresh check detects those specific regressions.
- Native UI, real Keychain access, and live inference were not repeated.
  This commit includes the approved lookup-deletion dependency and its coverage;
  unrelated design-review guidance remains outside the change.
- Review packaging: `EZ_SWIFTPM_DISABLE_SANDBOX=1 make app` completed through
  approved execution outside the restricted sandbox and verified the local ad-hoc
  signature of `dist/EZ.app`. The installed app was not replaced.

## Hover selectors and configurable shortcuts — 2026-10-15

- Added Settings → Shortcuts for New/Send/Stop, ordered Previous/Next recipe,
  recipe positions 1–8, and Last recipe. Bindings record, clear, restore, reject
  conflicts/reserved editing keys, and persist separately in owner-only
  `shortcuts.json`; failures preserve the last published bindings. Chrome
  navigation updates both arrow bindings atomically.
- Replaced dropdowns with native popup controls that fill a stable allocated
  width. Native wheel dispatch targets the hovered control; no app-wide wheel
  monitor remains. Compact preset choices now have a direct selector and an
  adjacent information button. Added the **Selector hitboxes** offline fixture.
- Native offline preview checks: scrolled the far-right area of a long recipe
  title to one-character **S**, then clicked the identical point to reopen its
  menu. The entire control stayed the same width. Scrolling the preset changed
  it to **S · Normal** while preserving the recipe; scrolling empty panel space
  changed neither. The popup menus, Configuration layout, and Shortcuts layout
  were inspected in the actual built preview app.
- Verified numbered recipe selection, Next and Previous while an input had focus,
  and New clearing a typed draft. Recorded **⌘T**, saw the updated New hint,
  rejected assigning the same binding to Stop with a visible conflict, and
  cancelled recording with Esc. The recorder uses the modal SwiftUI view lifetime;
  it does not assume the sheet itself is AppKit’s key window.
- Before commit isolation, `make format` and sandboxed `make check` passed in
  the shared checkout: **53 core/support cases and 19 app-state cases**, including storage permissions/corruption/failure,
  shortcut conflicts, navigation order/wrapping, history replay, missing recipes,
  and busy/launcher guards, plus lint and preview typechecking.
- Final `make app` passed with approved execution for native icon generation;
  release compilation and strict local signature verification succeeded. The
  rebuilt bundle is `dist/EZ.app`; the installed `~/Applications/EZ.app` was not
  replaced in this slice.
- Native checks used disposable offline storage. No account switch or live
  inference was attempted. Live streaming cancellation, personal-account wheel
  selection, trackpad hardware/inertia, and non-US keyboard layouts remain
  unverified.

### Final review and isolated commit candidate

- Kept the pre-existing response-metrics/activity work and review-document edits
  outside this slice. Exported HEAD plus the 22 owned paths/hunks and verified
  that the feature builds without those pending changes.
- Restored the compact preset’s **Override** indicator and retained Fast/Normal
  labels for saved presets. Simplified preset title formatting through one helper;
  no lookup, billing, or request behavior changed during cleanup.
- The exact candidate passed `make format`, `make check` (**44 core/support and
  18 app-state cases**), and all pre-commit checks. The hook runner used its
  existing cache with `UV_OFFLINE=1`; the ordinary online runner was blocked by
  the command sandbox’s network restrictions.
- Rebuilt the candidate’s native offline preview under a separate bundle identity.
  Repeated the long-title-to-**S** hover scroll and same-point menu-opening check,
  verified **S · Override · Normal** after preset scrolling, confirmed empty-space
  scrolling changes neither selector, and used **⌘3** to select Ask and restore
  its default preset. Earlier native recording/navigation checks remain applicable.
- Candidate `make app` passed with approved native icon generation, release
  compilation, and strict local signature verification. No installed bundle was
  replaced, and no live request was sent during final review.
