# Testing Saul

Use Node 22.18+ and pnpm. Tests use a disposable Chromium profile, a snapshot of the production extension, and a loopback article/model server. No API key, personal profile, or native-host installation is needed.

## Commands

```sh
# First setup
pnpm install
pnpm exec playwright install chromium

# Verification
pnpm compile
pnpm format:check
pnpm test
pnpm test:e2e                # build + browser suite
pnpm test:e2e:headed         # same suite, visible browser

# Hands-on review
pnpm test:user               # build + isolated browser with local provider configured
pnpm test:user --smoke       # verify launcher/Explain/history, then clean up

# Focused rerun of an already-built extension
pnpm exec playwright test -g 'concurrent cold-start'
node tests/e2e/manual.ts --smoke  # reuse existing bundle
pnpm exec tsc -p tests/e2e/tsconfig.json  # harness-only typecheck
```

Do not rebuild a shared checkout while another task is producing its bundle. Each sandbox copies `.output/chrome-mv3` once; later rebuilds cannot change an active test. An existing-build run verifies that snapshot, not newer source edits. `pnpm test:user` prints its article, popup, and profile paths; close its browser or press Ctrl+C to remove the profile and stop the server.

## Harness and evidence

| File | Responsibility |
| --- | --- |
| `tests/e2e/support.ts` | Loopback server, streamed model fixture, extension snapshot, persistent profile, diagnostics, cleanup |
| `tests/e2e/fixtures.ts` | Playwright lifecycle and failure attachments |
| `tests/e2e/extension.spec.ts` | Reader/history flow and concurrent storage regressions |
| `tests/e2e/product.spec.ts` | Bookmarks, search/export, provider profiles, tab previews/undo, keyboard/follow-up/cancellation, navigation and draft protection |
| `tests/e2e/manual.ts` | Reusable hands-on sandbox and launcher smoke check |
| `tests/e2e/tsconfig.json` | Independent typecheck while unrelated product edits are in progress |
| `tests/storage.test.ts` | Fail visibly when persistence is unavailable; initialization retry |

Import `test` and `expect` from `./fixtures.ts` in a new browser spec. Request `sandbox` and `fixtureServer`; `await sandbox.launch()` returns `context`, `worker`, and `popup`. Calling `launch()` again closes the current browser and reopens the **same profile and bundle**, which proves restart durability. Teardown removes the owned profile even after failed assertions. Keep user-flow assertions in specs rather than hiding them in setup helpers. For cancellation tests, `createFixtureServer(response, { chunkDelayMs })` deliberately delays its final stream event; ordinary tests need no sleeps.

Results go to `playwright-report/index.html` and `test-results/` (both ignored). Failed tests retain per-launch traces, page screenshots, and console logs, attached to the report. Successful tests discard diagnostic traces but retain explicitly requested screenshots. Inspect a failure with:

```sh
pnpm exec playwright show-report
pnpm exec playwright show-trace test-results/<case>/browser/trace-1.zip
```

Coverage includes the reading/persistence lifecycle, concurrent writes and rollback, bookmarks across restart, readable search and pagination, 1,005-record export, profile credential separation, keyboard/pin/follow-up/stop behavior, and tab preview/apply/undo/staleness. See [product behavior](product.md) for the contracts. These checks do not establish live-provider authentication, model quality, Firefox behavior, real Chrome AI downloads/generation, or native-host registration.

## Debug by symptom

| Symptom | Check first |
| --- | --- |
| OPFS unavailable / memory fallback | SQLite must run in `src/storage/db-worker.ts`, owned by `entrypoints/offscreen/main.ts`. The SAH pool uses `/saul-opfs`; persistence failures must reach callers. |
| Receiving end missing on cold start | `src/storage/client.ts` must lock the existence check and creation together: `hasDocument()` can become true before listeners are ready. |
| Background save gets no response | Runtime messages exclude their sender. Popup → background → offscreen; background → offscreen directly. |
| Explain disappears or preferences are ignored | Ignore mouseup inside the extension's shadow UI; fetch context policy through background, since content scripts cannot read trusted settings. |
| Regenerate causes duplicate keys/cards | Reuse the selection, create a new run, and show its latest run once in history. |
| Raw term tags appear in history | Use the existing annotated-text renderer rather than displaying `responseRaw` directly. |
| `EPERM` for loopback/Unix sockets or browser launch | This is an execution-permission issue. Run the authorized test with the required local permissions; do not classify it as an app regression. |
| pnpm store mismatch | Inspect `storeDir` in `node_modules/.modules.yaml`; reuse that store or intentionally reinstall. Do not change global pnpm settings. |
| “Chromium” not found by computer-use tools | Playwright may launch **Google Chrome for Testing**. Discover the running app; if ambiguous, use its actual application path. |

Storage path: popup/content → background → offscreen document → dedicated SQLite worker. The worker serializes operations; its OPFS SAH pool avoids a production SharedArrayBuffer/COOP/COEP requirement. References: [SQLite persistence](https://sqlite.org/wasm/doc/tip/persistence.md), [Playwright extensions](https://playwright.dev/docs/chrome-extensions).

## Hands-on checklist

In `pnpm test:user`, select the article concept, click Explain, inspect layout and concept notes, regenerate, then open **Reading → Reading history** and verify the saved explanation. Check Settings/provider navigation, keyboard triggering, pin/follow-up/bookmark actions, and Tabs previews when those surfaces change. Automated smoke is not a substitute for observing these surfaces. Use the browser suite for restart/export/delete guarantees; do not exercise destructive tests in a personal profile.

## Verification record — 2026-09-18

The cleanup pass verified the production build, app and harness typechecks, formatting, 31 unit/transport tests, and nine browser scenarios. The browser suite uses isolated profiles and a local provider; it also checks unsaved-draft navigation and cancellation of mocked on-device preparation. Final library and settings screenshots were reviewed. These are dated results, not guarantees for later source edits.

Earlier harness validation covered the manual-launcher smoke, a deliberate failure with a readable trace/screenshots/console log, and profile cleanup. Hands-on review covered selection, explanation layout, concept notes, regeneration, Reading home, and readable history after popup refresh.

Agent workflow: [.agents/skills/saul-browser-testing/SKILL.md](../.agents/skills/saul-browser-testing/SKILL.md).
