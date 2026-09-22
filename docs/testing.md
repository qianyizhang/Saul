# Testing

Tests use a built extension snapshot, disposable Chromium profiles, and a loopback article/model server. They do not need an API key, native-host installation, or personal browser data.

## macOS browser execution

On this Mac, Chrome and Chrome for Testing can abort during LaunchServices/WindowServer registration when launched inside a restricted command sandbox, including headless mode.

For browser-launching commands, request approved execution outside that sandbox from the first launch. Scope approval to the specific command. Keep compilation and ordinary checks sandboxed, and keep the disposable profiles.

Playwright runs `tests/e2e/browser-preflight.ts` once before the suite. On startup failure it retains the first error under the selected `test-results` directory and stops before individual tests repeat the launch. Treat permission denials and immediate registration aborts as blocked verification, not application failures.

Do not retry an unchanged failed launch, use a personal profile, add Chrome's `--no-sandbox` flag, kill unrelated browsers, or hide crash notifications. If approved execution is unavailable, report the browser checks as blocked.

## Commands

```sh
# Repository gate
pnpm check

# Browser setup and full suite
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:e2e:headed

# Hands-on disposable browser
pnpm test:user
pnpm test:user --smoke
```

Focused checks can reuse an already-built `.output/chrome-mv3` snapshot:

```sh
pnpm exec playwright test tests/e2e/reading.spec.ts tests/e2e/annotations.spec.ts
pnpm exec playwright test tests/e2e/product.spec.ts
pnpm exec playwright test tests/e2e/notifications.spec.ts
pnpm exec playwright test tests/e2e/positioning.spec.ts tests/e2e/multiline.spec.ts
pnpm exec tsc -p tests/e2e/tsconfig.json
```

Optional evidence runs:

```sh
SAUL_LIVE_GITHUB=1 pnpm exec playwright test -g 'live GitHub'
pnpm benchmark
```

An existing-build run verifies that snapshot, not newer source edits. Do not rebuild a shared checkout while another task owns its bundle.
Concurrent suites must use separate `--output test-results-<scope>` directories; Playwright clears its output directory at startup.

## Test layers

| Layer          | Scope                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| Vitest         | Contracts, parser/provider streams, settings, runner, storage, tab operations, native framing/CLI/MCP/installer |
| Playwright     | Real extension contexts, SQLite-WASM/OPFS, page interaction, restart/loss, migrations, tabs, settings           |
| Manual sandbox | Layout, reading flow, keyboard behavior, and interaction quality in a disposable browser                        |

The browser harness is in `tests/e2e/support.ts` and `tests/e2e/fixtures.ts`. A sandbox snapshots the extension once and reuses the same profile across relaunches so restart tests prove persistence. Test-only database and marker fixtures are bundled only into disposable snapshots.

## Artifacts and debugging

Playwright writes `playwright-report/` and `test-results*/`; all are ignored. Failures retain traces, screenshots, and console logs.

```sh
pnpm exec playwright show-report
pnpm exec playwright show-trace test-results/<case>/browser/trace-1.zip
```

## Debug by symptom

| Symptom                                             | Check first                                                                                                                                                                  |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OPFS unavailable or memory fallback                 | SQLite must run in `src/storage/db-worker.ts`; persistence errors must reach callers.                                                                                        |
| Receiving end missing on cold start                 | `src/storage/client.ts` must lock the offscreen existence check and creation together.                                                                                       |
| Background save gets no response                    | Popup/content route through background; background targets offscreen directly.                                                                                               |
| Extension context invalidated after reload          | Page UI must check WXT context validity and dispose listeners/timers without calling a dead port.                                                                            |
| Saved settings need repair                          | Use the explicit Settings recovery action. The latest invalid record is retained in trusted local storage under `saul_user_settings_recovery_backup`; history is unaffected. |
| SPA result appears on the wrong route               | Use current main-frame `sender.tab.url`; reconnect the route subscription with the reset.                                                                                    |
| Marker never returns on changing content            | Keep bounded scheduled reattachment; ambiguous or truncated maps remain unresolved.                                                                                          |
| Raw term tags appear in history                     | Render with `AnnotatedTextView`; do not display `responseRaw` directly.                                                                                                      |
| `EPERM` on loopback, Unix socket, or browser launch | Treat as execution permission until the same check runs with required local access.                                                                                          |
| pnpm store mismatch                                 | Inspect `storeDir` in `node_modules/.modules.yaml`; reuse it or reinstall intentionally.                                                                                     |

## Hands-on checks

In `pnpm test:user`:

1. Select the fixture concept and choose **Explain**.
2. Confirm the page stays readable while the underline and queued/ready cues update.
3. Open the marker, inspect notes, close it, refresh, and reopen the restored result.
4. Check unread state, **Alt+Shift+L**, source navigation, keyboard/pin/follow-up/stop behavior, and tab previews when relevant.
5. Toggle **Mute error notifications** in Settings; verify another tab and a browser relaunch observe the setting, then turn it off.

A successful smoke run verifies setup only. Record the built source scope, passed checks, and untested live-provider behavior after hands-on review.

## Evidence limits

The default browser suite uses deterministic local fixtures. It does not verify live provider credentials/output, actual Chrome on-device model download/generation, personal native-host registration, or other browsers. Benchmark reproduction and scope are documented in [benchmarks](benchmarks/README.md).

Agent workflow: [saul-browser-testing skill](../.agents/skills/saul-browser-testing/SKILL.md).
