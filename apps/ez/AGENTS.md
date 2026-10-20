# EZ development

## Scope and architecture

EZ is a native macOS language utility. Read `README.md` and `docs/architecture.md`
before changing behavior. Keep SwiftUI in `Sources/EZ` and reusable authentication,
networking, protocol, and storage code in `Sources/EZCore`. Do not add a Codex,
Node, Python, Electron, or webview runtime dependency to the app.

For feature UI, forms, metadata, actions, or disclosure changes, read `docs/design.md`
and follow its feature UI review before implementation and completion. The shared
authoring contract currently lives at `../Saul/DESIGN.md`; `DesignTokens.swift` is
generated from it. Keep native semantic controls and backgrounds, and use `AppStyle` roles for shared identity.

## Working rules

- Inspect existing changes and preserve concurrent work. Stage exact owned paths.
- Prefer the smallest complete feature slice. Add abstractions for actual callers,
  not hypothetical providers. No generated protocol dumps or large JSON fixtures.
- Do not commit credentials, user history, browser profiles, builds, or local logs.
- Keep feature behavior, error states, docs, and relevant verification together.
- Record decisions that affect future features in `docs/architecture.md`. Keep
  planned features in `docs/roadmap.md`; distinguish plans from shipped behavior.
- Never silently switch the account, model, billing path, or requested service tier.

## Required checks

Run `make format`, then `make check` after Swift changes. Run `make app` for bundle,
resource, signing, or release changes. `EZChecks` is an offline executable test
suite so Apple Command Line Tools suffice; no live account is needed for CI.
When the outer agent sandbox rejects nested SwiftPM `sandbox-exec`, set
`EZ_SWIFTPM_DISABLE_SANDBOX=1` for the command. Keep ordinary checks inside the
outer sandbox. This exception disables only SwiftPM's nested manifest sandbox.

Changes to OAuth, models, or Responses must follow current official OpenAI docs
and preserve the contracts documented in `docs/architecture.md`. Test invalid
identity, missing permission, failed refresh, interrupted streams, and storage
failures when those paths change. A successful build or model list does not prove
live inference. Report live verification separately.

## macOS UI and browser verification

Native visual checks use the built `.app`. Do not call a browser screenshot a
native UI test. For browser-launching tests on this Mac, request execution outside
the restricted command sandbox from the first launch, with the specific command
using `sandbox_permissions: require_escalated`. Use disposable profiles and the
repository's harness. Stop unchanged relaunches after a LaunchServices,
WindowServer, or permission abort. Report the check as blocked, not failed app
behavior. Do not use a personal browser profile for automation or kill unrelated
browsers. Normal user sign-in opens the system browser for the user to complete.

## Delivery

Explain what changed, which checks passed, and what remains unverified. Do not
publish, choose an open-source license, configure a remote, or claim notarization
without the user's direction and supporting evidence.

## Shared agent skills

The generic suite is installed once for the user account from repo-kit.
Read [local mappings](docs/agent-skills.md) before using it.
Keep project-specific skills and rules here. Accepted decisions remain settled;
continue already-authorized work without repeated confirmation unless a material
ambiguity remains. Retro and architecture surveys require explicit invocation.
