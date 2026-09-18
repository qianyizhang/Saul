---
name: saul-browser-testing
description: Debug and regression-test Saul's Chrome extension, persistence, messaging, and reading UI using its isolated browser fixtures. Use for Saul E2E setup, browser failures, or hands-on user testing.
---

# Saul browser testing

Work from the Saul checkout containing this skill. Read [docs/testing.md](../../../docs/testing.md) for commands, the harness entry points, and symptom-specific diagnostics. Reuse that harness instead of creating temporary servers or browser launch scripts.

## Choose the shortest useful check

- For storage or message failures, reproduce through the built extension and its real worker. A mocked SQLite test alone does not establish persistence.
- For reading UI behavior, use the local model fixture and mouse/keyboard actions through the content script; direct DB seeding covers only storage contracts.
- For layout or interaction review, run `pnpm test:user` and use available computer-use tools in that disposable browser. A successful smoke test is setup verification, not a hands-on review.
- Use the existing build for a focused rerun only when it represents the intended code. Coordinate build ownership in a shared checkout; each sandbox snapshots the bundle once.

## Preserve the meaningful invariants

- Keep one profile and extension snapshot across browser relaunches when proving durability. A popup refresh is insufficient.
- Route popup DB requests through background; background requests go directly to the offscreen document. Runtime messages do not return to their sender.
- Offscreen existence and creation share one lock; SQLite stays in its dedicated worker with persistent storage. Do not restore a silent memory fallback to make tests pass.
- Exercise selection → Explain → saved history and regeneration; synthetic record insertion misses UI and streaming failures.
- Keep API keys out of fixtures. The default sandbox uses a loopback provider and does not require native-host installation or access to personal Chrome data.

## Close the loop

Inspect the earliest failed assertion and its retained trace/logs before rerunning. Add a regression at the layer that exposed the bug. Run the relevant checks once after the fix, expanding only for unresolved risk or changed behavior.

Record the tested bundle/source scope, passed checks, and any untested live-provider behavior. Before updating an installed personal extension, preserve any still-live legacy in-memory records when relevant; do not infer their absence from an earlier session. Keep unrelated product edits and native-bridge work intact.
