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

## Current evidence — 2026-10-15

Each row identifies the tested boundary. Earlier native and live observations are
retained here as dated evidence; they were not repeated by the integration review.

| Boundary | Result | Limits |
| --- | --- | --- |
| Final branch offline gate | `make format`, sandboxed `make check`, all-file pre-commit checks, and local Markdown target checks passed: **53 core/support and 19 app-state cases**, install/build failure fixtures, lint, strict compilation, and preview typechecking. | Apple Swift 6.3.3 on Apple Silicon. A generated-cache collision between `ez`/`EZ` paths was resolved by cleaning and rebuilding; no code workaround. No network, Keychain, or native interaction in offline checks. |
| Final release bundle | Approved `make app` passed release compilation, icon packaging, configured certificate signing, and strict signature verification. | Built `dist/EZ.app`; packaging alone does not establish installation, credential restoration, or live inference. |
| Hosted macOS checks | Pre-integration inspection confirmed [success on `713eb0f`](https://github.com/qianyizhang/ez/actions/runs/38583329883). See [main workflow runs](https://github.com/qianyizhang/ez/actions/workflows/check.yml?query=branch%3Amain) for subsequent pushes. | Results apply to the run's recorded commit; local checks do not establish hosted success. |
| Native UI refinement, Oct 15 | Disposable surface preview verified first-run Account routing/help, stable empty/filled composer, two-field handoff, visible eight-field Tab navigation in both windows, answer reading/draft reveal/reuse, search recovery, export/deletion cancellation, preset dirty guards/save/section retention, new-recipe close guard/save, shortcut recorder cancellation, blocked layout, and light/dark answer/thinking views. | Fixed journeys are in [UI QA](ui-qa.md). Preview account/inference actions are blocked. Final export write, destructive UI deletion, recipe-specific discard/save-failure branches, global focus/hotkey behavior, VoiceOver, measured contrast, and the full appearance/display matrix remain unverified. |
| Native selectors and shortcuts, Oct 15 | Offline preview verified full-width hover/click targets after long-to-short label changes, preset overrides, input-focused recipe navigation, New, recording, conflicts, and Esc cancellation. | Personal-account wheel selection, trackpad hardware/inertia, and non-US layouts remain unverified. |
| Metrics and activity, Oct 15 | Offline parser/state regressions cover usage, missing versus zero, refusal text, TTFT, throughput after TTFT, interruption, and permanent light shutdown after visible text. Native previews covered light/dark surfaces, compact footer/actions, yellow waiting, green thinking, and motion suppression. | Fresh live metrics/reasoning and actual system Reduce Motion remain unverified. ScreenCaptureKit intermittently blocked capture (-3811/-3812); successful later captures apply only to the states recorded. |
| Signing and installation, Oct 15 | A real disposable upgrade with different code hashes satisfied the previous build's certificate requirement. The installed app was switched to persistent certificate signing; previous bundles were retained. | Self-signing is local identity continuity, not Developer ID or notarization. Prompt-free credential restoration after the certificate switch was not established. |
| Recipes and deletion, Oct 14 | Native offline previews verified recipe authoring/generated inputs, preset overrides, destructive confirmation, Cancel, and deletion retaining the draft. Offline checks cover atomic persistence, corrupt data, and failed writes. | Preview fixtures do not prove live inference; no personal lookup was deleted during these checks. |
| Credential restore, Oct 14–15 | Suspended-read checks verify UI-actor progress, cancellation, and preservation on failure. A pre-certificate-switch installed build restored the account and catalog. | Post-switch prompt-free access and fresh live expiry/revocation remain unverified. |
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
