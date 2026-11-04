# Verification

## Installed baseline — 2026-11-04

The prior credential rollout installed the shared Saul owner in both apps and
verified live model discovery across two changed signed builds. Both clients
completed credential retirement. No live inference, image or speech request was
made; API-key continuity used synthetic Keychain items. This evidence applies to
that installed baseline, not later source changes.

The Personal Team development certificate expires 2027-11-04. This is not Developer
ID signing or notarization. Certificate, Team ID, ACL, OS or installation changes
require renewed acceptance. Keep recovery bundles and the previous signing pin
until normal use is confirmed; review by 2026-12-04.

The history rollout verified imports of 74 EZ entries (three images), 16 Saul
passages, 18 attempts and 17 summary batches. SQLite integrity and foreign keys
passed, and retired stores were removed after import. No provider request was sent.

## Repeatable offline gate

From `apps/ez`, run `make tools` once, then `make check`. This checks Swift formatting and correctness,
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
   terminal completion, and pending/completed SQLite entry states with the same UUID.
4. Send a spelling query with Fast where supported. Verify the actual returned
   service tier separately from the selected toggle.
5. Restart the app. Confirm the saved account and history reload.
6. For related changes, check cancellation, search, copy, export, and keyboard
   shortcuts. Test live logout only when willing to end that app session.
7. For Quick Lookup, check focus return after Esc, fresh shortcut/menu invocation,
   main-window handoff, minimum size, full-screen Spaces, and multiple displays.
   Check conflicts with the global shortcut and the menu-bar fallback.
8. Use `make surface-preview` for disposable native fixtures, including selector
   hitboxes, waiting/thinking/streaming, and narrow layouts. Preview fixtures cannot
   establish live account, inference, hardware scrolling, or system Reduce Motion behavior.

Follow the [fixed native UI journeys](ui-qa.md) for composition, reading, Settings,
long-form keyboard navigation, and recovery.
