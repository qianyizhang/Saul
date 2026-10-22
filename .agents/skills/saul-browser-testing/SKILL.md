---
name: saul-browser-testing
description: Debug and regression-test Saul's Chrome extension, persistence, messaging, and reading UI with its isolated browser harness.
---

# Saul browser testing

Work from `apps/saul` in this monorepo. Read [the testing runbook](../../../apps/saul/docs/testing.md) and reuse `tests/e2e/`; do not create parallel browser launchers or fixture servers.

## Before launching a browser

Read `macos-browser-testing.md` in `$CODEX_HOME/practices`
(default `~/.codex/practices`) before launching Chrome on this Mac. Keep the
Playwright startup probe; the runbook explains its retained errors.

## Choose the smallest useful check

- Storage or messaging: use the built extension and real database worker; mocked SQLite alone does not establish persistence.
- Reading UI: use the local model fixture and page interactions; direct database seeding covers storage contracts only.
- Layout or usability: run `pnpm test:user`; its smoke mode verifies setup, not hands-on quality.
- Focused rerun: reuse a build only when it matches the intended source. Each sandbox snapshots the bundle once.

## Preserve invariants

- Keep one disposable profile and extension snapshot across relaunches when proving durability.
- Route popup/content through background; background calls offscreen directly.
- Keep offscreen creation under one lock and SQLite in its dedicated OPFS worker; never add a silent in-memory fallback.
- Exercise selection -> Explain -> saved history for reading changes.
- Keep credentials out of fixtures. Do not require native-host installation or personal Chrome data.

## Finish

Inspect the earliest failed assertion and retained trace/log before rerunning. Add coverage at the layer that exposed the bug, then run the focused gate once and expand only for remaining risk.

Record the tested source/bundle, passed checks, and untested live-provider behavior. Preserve unrelated product and native-bridge work.
