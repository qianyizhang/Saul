# EZ development

## Scope and architecture

EZ is a native macOS language utility. Read `README.md` and `docs/architecture.md`
before changing behavior. Keep SwiftUI and app orchestration in `Sources/EZ`
and native lookup and storage logic in `Sources/EZCore`. For signed authentication,
catalog and provider operations, follow the
[credential contract](../../contracts/credentials.md).
Keep the installed EZ runtime native.

For feature UI, forms, metadata, actions, or disclosure changes, read `docs/design.md`
and follow its feature UI review before implementation and completion. Keep native semantic controls and backgrounds,
and use `AppStyle` roles from the [shared tokens](../../design/tokens.md).

## Working rules

- Prefer the smallest complete feature slice. Add abstractions for actual callers,
  not hypothetical providers. No generated protocol dumps or large JSON fixtures.
- Do not commit credentials, user history, browser profiles, builds, or local logs.
- Follow the root [ADR rule](../../AGENTS.md#architecture-decisions). Keep
  planned features in `docs/roadmap.md`.
- Never silently switch the account, model, billing path, or requested service tier.

## Required checks

Run `make format`, then `make check` after Swift changes. Run `make app` for bundle,
resource, signing, or release changes. See [development setup](CONTRIBUTING.md#development-setup-and-gates)
for the native toolchain. Checks run offline without a live account.
When the outer agent sandbox rejects nested SwiftPM `sandbox-exec`, set
`EZ_SWIFTPM_DISABLE_SANDBOX=1` for the command. Keep ordinary checks inside the
outer sandbox. This exception disables only SwiftPM's nested manifest sandbox.

Changes to OAuth, models, or Responses must follow current official OpenAI docs
and preserve the [runtime](docs/architecture.md) and [credential](../../contracts/credentials.md) contracts. Test invalid
identity, missing permission, failed refresh, interrupted streams, and storage
failures when those paths change. A successful build or model list does not prove
live inference. Report live verification separately.

## macOS UI and browser verification

Save disposable captures/review exports under root `.artifacts/ez/<run>/`; follow
the [artifact policy](../../docs/artifacts.md). Keep build bundles in `dist/`.

Native visual checks use the built `.app`. Read `macos-browser-testing.md` in
`$CODEX_HOME/practices` (default `~/.codex/practices`) before browser tests.
Normal user sign-in opens the system browser for the user to complete.

## Delivery

Do not publish, choose an open-source license, configure a remote, or claim
notarization without the user's direction and supporting evidence.

## Shared agent skills

Read [local mappings](docs/agent-skills.md) before using shared skills.
