# Verification

## Repeatable offline gate

Run `make check`. This lints Swift, checks shell/plist syntax, compiles the app,
and runs `EZChecks`, a dependency-free executable contract suite. Apple Command
Line Tools on this Mac do not include XCTest; the executable harness keeps the
same checks runnable locally and in CI without requiring the full Xcode app.

The 15 named checks cover history snapshots/permissions, damaged tails, failed
writes, exclusive session ownership, PKCE/form encoding, callback validation,
signed OIDC verification and invalid claims, model capabilities, request-body
constraints, SSE parsing/completion/errors, real URLSession streaming against an
in-process stub, and refresh rotation/error handling. RSA test keys are generated
in memory with system OpenSSL; no private fixture is committed. The suite does
not use the network, Keychain, or a real ChatGPT account.

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
