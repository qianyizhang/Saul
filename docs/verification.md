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
After `make clean`, run `make tools` again to restore the development linters.
If Swift reports duplicate modules under differently capitalized checkout paths,
clear generated build state with `make clean` before rebuilding.

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
7. For Quick Lookup, check focus return after Esc, draft preservation after hiding,
   main-window handoff, minimum size, full-screen Spaces, and multiple displays.
   Check conflicts with the global shortcut and the menu-bar fallback.
8. Use `make surface-preview` for disposable native fixtures, including selector
   hitboxes, waiting/thinking/streaming, and narrow layouts. Preview fixtures cannot
   establish live account, inference, hardware scrolling, or system Reduce Motion behavior.
   Follow the [fixed native UI journeys](ui-qa.md) for composition, reading, Settings,
   long-form keyboard navigation, and recovery.

Do not capture or commit credentials, authorization URLs, or personal query data.
Use synthetic inputs. A connected badge proves sign-in only; a model picker proves
catalog discovery only; completed inference proves that request succeeded.

## Current evidence — 2026-10-18

Each row identifies the tested boundary. Earlier native and live observations are
retained here as dated evidence; they were not repeated by the integration review.

| Boundary | Result | Limits |
| --- | --- | --- |
| Shared design and Minimum Mode, Oct 18 | Final formatting and full check passed: **53 core** and **24 state** cases, installer fixtures, and preview-script compilation. Signed local app and offline surface preview built. Native fixtures covered new lookup, saved-answer reading/editing, Quick Lookup, Settings, errors, and light/dark appearance. Shared CSS/TypeScript/Swift receipts match Saul's authored contract. | Fixture rendering does not establish live sign-in, inference, installed upgrade, or native mobile. Final label-only polish was compiled. Native menu-first Escape still needs a direct keyboard check; automation refocused the window and dismissed the menu before delivering Escape. No speculative menu workaround was retained. |
| Finish-work review, Oct 16 | `make format`, sandboxed `make check` (**53 core/support + 24 app-state cases**), and `UV_OFFLINE=1 make pre-commit` passed. The corrupt-configuration Services regression failed before the fix and passed afterward, retaining the workspace and original file bytes. Approved `make test-services` passed **3/3**; approved `make app` passed configured signing and strict verification, and the packaged plist matches source. Release executable SHA-256: `432af5ecce9a01951b0100c6ef8de6602a8714cf5353bcb3c7895714aa9d1418`. | The initial hook dependency lookup was network-blocked; the cached offline runner passed. This reviewed bundle was not installed or launched. Earlier installed/native/live observations below apply to their original builds; cold Services delivery, focus return, and installed multi-field/rejection journeys remain unverified. No fresh hosted CI. |
| Working-tree offline gate, Oct 16 | `make format` and sandboxed `make check` passed: **53 core/support and 24 app-state cases**, install/build failure fixtures, lint, strict compilation, and preview typechecking. Selected-text checks cover exact Unicode, single/multi-field drafts, no queued submission, byte limits, active-work guards, missing recipes, and preservation on rejection. | No network, Keychain, or native interaction in offline checks. All-file pre-commit and hosted CI were not rerun for this slice. |
| Release bundle and installation, Oct 16 | Approved `make app` and `make install` passed release compilation, icon packaging, configured certificate signing, strict signature verification, and verification against the previous installed identity. Packaged plist matches the source Services declaration. Installed at `~/Applications/EZ.app`; previous bundle retained at `~/Applications/.ez-upgrade.fLflta/previous.app`. | The first installation attempt refused a running EZ without replacement; a later native inspection established idle/empty state, then normal Quit allowed installation. Packaging does not establish Keychain continuity. |
| Installed baseline, Oct 16 | Installed executable SHA-256 `c77ce6d5f6724d02d971d6a770615951920ae383e388ace6052e62d5e1ab6ecd` matched the pre-change `dist` executable. Approved `codesign --verify --deep --strict` passed. | Computer Use failed to bind the installed window with ScreenCaptureKit **-3811**. Fresh Raycast submission, live metrics, focus return, restart/credential restoration, and the installed daily-use journey were **blocked**, not verified. The baseline remained running during the build. |
| Selected-text callback, Oct 16 | Approved `make test-services`: **3/3 passed** for plist/Objective-C selector agreement, private pasteboard delivery to an offline draft, unchanged source pasteboard and general clipboard change counts, repeated-invocation rejection, and missing-text errors. | The restricted sandbox could not write the private pasteboard; approved execution passed. No clipboard contents were read. Direct callback checks do not establish cross-app menu discovery, cold launch, focus behavior, or live inference. |
| Installed selected-text journey, Oct 16 | Native TextEdit Services menu exposed **Look Up in EZ**. Invoking it on a known synthetic file opened Quick Lookup with the exact Unicode selection, an enabled Send, and no request started. Explicit Send completed on `gpt-6-luna`: **98 input / 0 reasoning / 56 output tokens**, **3.43 s TTFT**, **69.6 response tok/s**. Pending and completed JSONL snapshots shared UUID `2BFF4FC7-9EB1-4BEF-BF20-560675914196`; requested `priority`, served `default`, metrics persisted. The result and metrics also appeared in main-window history. | Capture/binding intermittently failed with -3811; rebinding the current window restored accessibility inspection. A confirmed fresh process restored the account/catalog and synthetic history entry automatically on the same build. Cross-app cold launch, Esc focus return, and installed multi-field/rejection cases remain unverified. Reasoning activity and actual priority serving were not established by this request. |
| Keychain upgrade diagnosis, Oct 16 | User reported a credential-access prompt after upgrade. Old and new designated requirements are identical: bundle `local.ez.app`, certificate `D150C96E0EB1BD9CEEDE02EB689F19A5670DF3C1`. Read-only metadata inspection found the credential item's partition fixed to current `cdhash:c23d362be4d6a138bee3f8dd943beb3cdc9d4ef9`; previous executable hash was `ebaf8fb84b2bad0c55a69654ded833f6893e0c1a`. Both report no TeamIdentifier. Account/catalog and inference subsequently worked. | **Self-signing did not establish prompt-free upgrades.** Inspection requested only the single item's reference/ACL metadata, disabled helper authentication dialogs, and read no token data or clipboard contents. No ACL changes were made. Apple-issued developer signing with a stable Team ID remains a separate unverified path. |
| Hosted macOS checks | Pre-integration inspection confirmed [success on `713eb0f`](https://github.com/qianyizhang/ez/actions/runs/38583329883). See [main workflow runs](https://github.com/qianyizhang/ez/actions/workflows/check.yml?query=branch%3Amain) for subsequent pushes. | Results apply to the run's recorded commit; local checks do not establish hosted success. |
| Native UI refinement, Oct 15 | Disposable surface preview verified first-run Account routing/help, stable empty/filled composer, two-field handoff, visible eight-field Tab navigation in both windows, answer reading/draft reveal/reuse, search recovery, export/deletion cancellation, preset dirty guards/save/section retention, new-recipe close guard/save, shortcut recorder cancellation, blocked layout, and light/dark answer/thinking views. | Fixed journeys are in [UI QA](ui-qa.md). Preview account/inference actions are blocked. Final export write, destructive UI deletion, recipe-specific discard/save-failure branches, global focus/hotkey behavior, VoiceOver, measured contrast, and the full appearance/display matrix remain unverified. |
| Native selectors and shortcuts, Oct 15 | Offline preview verified full-width hover/click targets after long-to-short label changes, preset overrides, input-focused recipe navigation, New, recording, conflicts, and Esc cancellation. | Personal-account wheel selection, trackpad hardware/inertia, and non-US layouts remain unverified. |
| Metrics and activity, Oct 15 | Offline parser/state regressions cover usage, missing versus zero, refusal text, TTFT, throughput after TTFT, interruption, and permanent light shutdown after visible text. Native previews covered light/dark surfaces, compact footer/actions, yellow waiting, green thinking, and motion suppression. | Fresh live metrics/reasoning and actual system Reduce Motion remain unverified. ScreenCaptureKit intermittently blocked capture (-3811/-3812); successful later captures apply only to the states recorded. |
| Signing and installation, Oct 15 | A real disposable upgrade with different code hashes satisfied the previous build's certificate requirement. The installed app was switched to persistent certificate signing; previous bundles were retained. | Self-signing is local identity continuity, not Developer ID or notarization. Prompt-free credential restoration after the certificate switch was not established. |
| Recipes and deletion, Oct 14 | Native offline previews verified recipe authoring/generated inputs, preset overrides, destructive confirmation, Cancel, and deletion retaining the draft. Offline checks cover atomic persistence, corrupt data, and failed writes. | Preview fixtures do not prove live inference; no personal lookup was deleted during these checks. |
| Credential restore, Oct 14–15 | Suspended-read checks verify UI-actor progress, cancellation, and preservation on failure. A pre-certificate-switch installed build restored the account and catalog. | Oct 16 same-build restoration succeeded, but a changed-build upgrade prompted; see the partition diagnosis above. Fresh live expiry/revocation remain unverified. |
| Initial live inference, Oct 13 | Dictionary: `gpt-6.1-sol`, low, returned `default`, 8.46 s, 423 characters saved. Spell Check: `gpt-6-luna`, low, requested `priority`, returned `default`, 4.36 s. | These are historical requests; actual priority serving is not established. |
| Raycast, Oct 13 | Installed app completed cold/warm synthetic submissions, preserved Unicode/reserved characters, opened shared history, and refused a concurrent query without recording it. | macOS 14 fallback presentation, full-screen/multiple displays, and fresh signed-out/storage-failure UI journeys remain unverified. |

Intel execution, another-Mac Gatekeeper acceptance, distribution, and notarization
remain unverified. A connected badge or model catalog is not completed inference.

## Evidence provenance

This page consolidates the former per-iteration log, including checks superseded
by later fixes. The complete original records, commands, counts, limitations,
and local rollback paths remain in the
[pinned verification log at `a9da577`](https://github.com/qianyizhang/ez/blob/a9da577e529d7bee08ebbf115a905cca35b78b46/docs/verification.md).
They are also available locally with:

```sh
git show a9da577:docs/verification.md
```

Update the applicable boundary above after verification; avoid appending another
implementation diary. Preserve the distinction between offline, native, live-service,
packaging, and hosted-CI evidence.
