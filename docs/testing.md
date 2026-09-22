# Testing Saul

Use Node 22.18+ and pnpm. Tests use a disposable Chromium profile, a snapshot of the production extension, and a loopback article/model server. No API key, personal profile, or native-host installation is needed.

## Commands

### macOS execution and startup failures

On this Mac, restricted agent commands have caused Chrome and Chrome for Testing
to abort during LaunchServices/WindowServer registration, even in headless mode.
Run browser-launching commands through approved execution outside the command
sandbox from the outset (in Codex, request `sandbox_permissions: require_escalated`
for the specific command). Keep compilation and ordinary unit checks sandboxed.
This does not require disabling the sandbox globally or changing personal Chrome.

The Playwright config runs `tests/e2e/browser-preflight.ts` once before all tests,
including focused runs, using the same isolated extension launcher and headed
setting. It closes its disposable probe and aborts the suite on failure without
retrying. Failure diagnostics are retained under `test-results/browser-preflight`
(or the selected output directory). This limits startup crash cascades; it cannot
prevent a later browser failure after a successful probe. The manual launcher
already makes only one launch attempt.

Inspect the first startup error before another attempt. Permission denials or an
immediate registration abort are blocked verification, not failed app assertions.
Do not repeat unchanged launches, switch to a personal profile, add `--no-sandbox`
as a workaround for the outer command sandbox, or hide macOS crash notifications.
If approved execution is unavailable, report the browser checks as blocked.

### Available commands

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
pnpm exec playwright test tests/e2e/reading.spec.ts tests/e2e/annotations.spec.ts
pnpm exec playwright test tests/e2e/positioning.spec.ts # popup motion and selection tracking
pnpm exec playwright test tests/e2e/multiline.spec.ts # multiline capture and placement
pnpm exec playwright test tests/e2e/notifications.spec.ts # error mute, live tabs, restart, unavailable storage
SAUL_LIVE_GITHUB=1 pnpm exec playwright test -g 'live GitHub' # optional real-page layout, local model
SAUL_SCALE=1 pnpm exec playwright test tests/e2e/database.spec.ts # OPFS and annotation measurements
node tests/e2e/manual.ts --smoke  # reuse existing bundle
pnpm exec tsc -p tests/e2e/tsconfig.json  # harness-only typecheck
```

Do not rebuild a shared checkout while another task is producing its bundle. Each sandbox copies `.output/chrome-mv3` once; later rebuilds cannot change an active test. An existing-build run verifies that snapshot, not newer source edits. `pnpm test:user` prints its article, popup, and profile paths; close its browser or press Ctrl+C to remove the profile and stop the server.

## Harness and evidence

| File                                                 | Responsibility                                                                                                                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/e2e/support.ts`                               | Loopback server, streamed model fixture, extension snapshot, persistent profile, diagnostics, cleanup                                                                       |
| `tests/e2e/fixtures.ts`                              | Playwright lifecycle and failure attachments                                                                                                                                |
| `tests/e2e/extension.spec.ts`                        | Library search, export, source navigation and deletion                                                                                                                      |
| `tests/e2e/reading.spec.ts`                          | Durable jobs, queues, restart/loss, SPA identity/subscriptions, partial results, sender boundaries and idempotency                                                          |
| `tests/e2e/annotations.spec.ts`                      | Native highlight feasibility, repeated/overlapping text, restoration, clipping, continuous mutations and quiet layout                                                       |
| `tests/e2e/database.spec.ts`                         | Real WASM migration rollback/future-version rejection, bounded anchors and opt-in scale measurements                                                                        |
| `tests/e2e/database-fixture.ts`, `marker-fixture.ts` | Test-only modules bundled solely into disposable extension snapshots                                                                                                        |
| `tests/e2e/product.spec.ts`                          | Bookmarks, search/export, provider profiles, tab previews/undo, keyboard/follow-up/cancellation, navigation and draft protection                                            |
| `tests/e2e/positioning.spec.ts`                      | Instant Explain appearance, scroll/layout tracking, and captured selection stability                                                                                        |
| `tests/e2e/multiline.spec.ts`                        | Forward/backward paragraph-to-list drags, line-aware placement with scrolling/viewport flips, preserved line breaks in capture/history, and opt-in live GitHub reproduction |
| `tests/e2e/manual.ts`                                | Reusable hands-on sandbox and launcher smoke check                                                                                                                          |
| `tests/e2e/tsconfig.json`                            | Independent typecheck while unrelated product edits are in progress                                                                                                         |
| `tests/storage.test.ts`                              | Fail visibly when persistence is unavailable; initialization retry                                                                                                          |

Import `test` and `expect` from `./fixtures.ts` in a new browser spec. Request `sandbox` and `fixtureServer`; `await sandbox.launch()` returns `context`, `worker`, and `popup`. Calling `launch()` again closes the current browser and reopens the **same profile and bundle**, which proves restart durability. Teardown removes the owned profile even after failed assertions. Keep user-flow assertions in specs rather than hiding them in setup helpers. For lifecycle tests, `createFixtureServer(response, { chunkDelayMs, ending })` delays the final event or ends with EOF/length cutoff and records provider request counts. Ordinary tests need no sleeps. `seedHistory` uses typed job operations through the trusted background; there is no production seeding endpoint.

Results go to `playwright-report/index.html` and `test-results/` (and named `test-results-*/` runs; all ignored). Failed tests retain per-launch traces, page screenshots, and console logs, attached to the report. Successful tests discard diagnostic traces but retain explicitly requested screenshots. Inspect a failure with:

```sh
pnpm exec playwright show-report
pnpm exec playwright show-trace test-results/<case>/browser/trace-1.zip
```

Coverage includes the reading/persistence lifecycle, concurrent writes and rollback, bookmarks across restart, readable search and pagination, 1,005-record export, profile credential separation, keyboard/pin/follow-up/stop behavior, and tab preview/apply/undo/staleness. See [product behavior](product.md) for the contracts. These checks do not establish live-provider authentication, model quality, Firefox behavior, real Chrome AI downloads/generation, or native-host registration.

## Debug by symptom

| Symptom                                             | Check first                                                                                                                                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OPFS unavailable / memory fallback                  | SQLite must run in `src/storage/db-worker.ts`, owned by `entrypoints/offscreen/main.ts`. The SAH pool uses `/saul-opfs`; persistence failures must reach callers.                                                   |
| Receiving end missing on cold start                 | `src/storage/client.ts` must lock the existence check and creation together: `hasDocument()` can become true before listeners are ready.                                                                            |
| Background save gets no response                    | Runtime messages exclude their sender. Popup → background → offscreen; background → offscreen directly.                                                                                                             |
| Explain disappears or preferences are ignored       | Ignore mouseup inside the extension's shadow UI; fetch context policy through background, since content scripts cannot read trusted settings.                                                                       |
| Regenerate causes duplicate keys/cards              | Reuse the passage; generate a fresh submission ID only for an explicit new attempt. Preserve the last completed answer separately from the latest attempt.                                                          |
| SPA results appear on the wrong route               | Chrome retains the original `sender.url` after pushState. Main-frame `sender.tab.url` supplies the current route; route reset and subscription reconnection must happen together, including across in-flight reads. |
| A mark never returns on a changing page             | Keep the scheduled reattachment pass instead of resetting its timer for every mutation. Truncated/ambiguous maps must remain unresolved.                                                                            |
| Retry stalls after a persistence error              | Reconcile the failed terminal write before reusing the passage; an acknowledgement loss must not overwrite an already-completed run.                                                                                |
| Raw term tags appear in history                     | Use the existing annotated-text renderer rather than displaying `responseRaw` directly.                                                                                                                             |
| A concept note disappears when clicked              | Capture `e.currentTarget` before a functional state updater; React's event target is no longer available when a deferred updater runs. Test click/pin as well as focus.                                             |
| `EPERM` for loopback/Unix sockets or browser launch | This is an execution-permission issue. Run the authorized test with the required local permissions; do not classify it as an app regression.                                                                        |
| pnpm store mismatch                                 | Inspect `storeDir` in `node_modules/.modules.yaml`; reuse that store or intentionally reinstall. Do not change global pnpm settings.                                                                                |
| “Chromium” not found by computer-use tools          | Playwright may launch **Google Chrome for Testing**. Discover the running app; if ambiguous, use its actual application path.                                                                                       |

Storage path: popup/content → background → offscreen document → dedicated SQLite worker. The worker serializes operations; its OPFS SAH pool avoids a production SharedArrayBuffer/COOP/COEP requirement. References: [SQLite persistence](https://sqlite.org/wasm/doc/tip/persistence.md), [Playwright extensions](https://playwright.dev/docs/chrome-extensions).

## Hands-on checklist

In `pnpm test:user`, select the article concept and click Explain. Verify that the page stays readable without an open card, with a quiet underline and queued/ready cue. Click the underline, inspect the saved answer and concept notes, close the card, refresh, and reopen from the restored mark. Check unread counts, the page list (**Alt+Shift+L**) and library source navigation. When relevant, check Settings/save locks and provider Stop, keyboard/pin/follow-ups/bookmarks, and Tabs previews. Automated smoke is setup verification; observe actual layout and interactions too. Use isolated browser tests for restart/export/delete guarantees.

### Error notification mute

In Settings → Notifications, toggle **Mute error notifications** and reload the workspace to check persistence. It saves immediately, independently of provider drafts. On a page with an error toast, **Mute** applies the same device-wide preference. Check another open tab, restart the same sandbox, and turn it off again in Settings. Success notifications and inline explanation errors remain visible.

The notification regression covers missing API credentials, an invalid unsaved endpoint draft, cross-tab updates, restart persistence, and an offscreen no-response failure. Muting must work without the reading database. The 2026-09-21 change passed both notification scenarios, the 10 existing product scenarios, 52 unit/transport checks, production build, app/harness typechecks, and changed-file formatting. Hands-on review verified the rebuilt toggle, persistence after reload, and unmuting in the disposable browser. The personal installed extension and live provider authentication were not exercised.

## Scale evidence — 2026-09-21

The [SQL report](benchmarks/reading-scale.json) used Chrome 153.0.8010.12 and SQLite-WASM 3.53.0 in the real OPFS worker, with 10,000 passages on 100 pages and 50,000 / 100,000 completed runs. Responses repeat a 336-character fixture. Times below are milliseconds. History/page use five samples, search three, export one. Raw samples and query plans are retained.

| Operation                                                            | 50,000 runs | 100,000 runs |
| -------------------------------------------------------------------- | ----------: | -----------: |
| History, first 50 (median)                                           |         0.8 |          0.8 |
| History, offset 9,000 (median)                                       |        12.0 |         12.2 |
| Page with 100 passages (median)                                      |         1.6 |          1.5 |
| Explanation search (median)                                          |         1.4 |          0.8 |
| Export all passages/attempts (single sample)                         |       741.5 |      1,034.5 |
| Previous-query shape with new lookup indexes (median, three samples) |         0.2 |          0.1 |
| Same query after removing four new lookup indexes (single sample)    |    19,602.1 |     38,841.7 |

The query comparison uses the same populated new schema: `run_latest`, `run_success`, `selection_recent` and `selection_page` are removed for the second measurement; other indexes remain. It isolates these indexes, not a complete old-release benchmark. The current history query also returns latest-success/unread data and is not identical to the smaller baseline query. This is a single local runtime with warm repeated queries and synthetic text, not a general latency guarantee or a cold-start benchmark.

The [native rendering report](benchmarks/reading-rendering.json) measures the production anchor/marker modules in a browser DOM. All 100 and 1,000 passages attach. Median full restoration is 0.7 / 23.2 ms; unchanged-anchor status refresh is 0.1 / 0.3 ms (five samples each). Pages contain 5,290 / 53,890 normalized characters. This measures synchronous mapping/registration work, not React, messaging, cold layout or time to paint. Native scrolling/clipping, dark-page zoom, multiline capture, overlaps and continuously changing DOM have separate interaction regressions. The [capability record](benchmarks/rendering-capabilities.json) establishes native highlight underline/hit-testing support only in the tested Chrome build.

## Verification record — 2026-09-21

The accepted [persistent reading workflow](reading-workflow-plan.md) implements the four structural proposals and revised reading behavior. Independent read-only review found lifecycle, save-retry, source-navigation, route-subscription and anchoring edge cases; they were fixed and covered by regressions. Its final targeted pass reported no additional actionable findings. Obsolete runtime bridges and legacy on-device API handling were removed; no compatibility shims were added.

Validation covers 52 unit/transport checks and 36 local browser scenarios, plus the separately enabled SQL and populated-page measurements. The live GitHub scenario remains opt-in and was not run in this pass. Production build, app/harness types, formatting and whitespace checks complete the gates. Browser scenarios use a loopback provider and disposable profiles, including real browser relaunch, service-worker shutdown, offscreen loss, migration rollback and unchanged source HTML/layout. Save/test edit boundaries and repeated/overlapping selections have explicit browser checks.

Hands-on inspection used the built extension in a disposable Chrome for Testing profile. Selection → Explain left the page unobstructed with a quiet underline and queued cue; clicking it opened the saved answer and updated unread state. Concept-note clicks worked. Closing, refreshing and reopening restored the answer and underline. The completed-card footer was then shortened to remove an irrelevant Stop hint and covered by the focused rebuilt annotation suite. Personal browser data and the installed personal extension were not changed. External provider authentication/output quality, actual on-device generation/download, native-host registration and Firefox remain untested.

## Verification record — 2026-09-20

The [review and cleanup](review-2026-09-20.md) passed the production build, app/harness typechecks, formatting, 42 unit/transport tests and 18 local browser scenarios; the opt-in live GitHub case was skipped. New regressions cover settings read failures, SSE framing/errors/cancellation, empty explanations, stale undo availability and clicked concept notes. Hands-on review found the tooltip click bug, reproduced it in a failing browser assertion, and verified the fixed tooltip and readable saved history in a rebuilt disposable browser. Live providers and the personal installed extension were not exercised.

## Verification record — 2026-09-19

Selection and popup fixes passed the production build, app/harness typechecks, formatting, 31 unit/transport tests, and 16 local browser scenarios. The opt-in live GitHub scenario also passed with the local model fixture. Coverage includes both drag directions, scroll/layout tracking, viewport flips, explanation-card alignment, preserved line breaks, and captured selection stability. Live-provider generation was not tested.

## Verification record — 2026-09-18

The cleanup pass verified the production build, app and harness typechecks, formatting, 31 unit/transport tests, and nine browser scenarios. The browser suite uses isolated profiles and a local provider; it also checks unsaved-draft navigation and cancellation of mocked on-device preparation. Final library and settings screenshots were reviewed. These are dated results, not guarantees for later source edits.

Earlier harness validation covered the manual-launcher smoke, a deliberate failure with a readable trace/screenshots/console log, and profile cleanup. Hands-on review covered selection, explanation layout, concept notes, regeneration, Reading home, and readable history after popup refresh.

Agent workflow: [.agents/skills/saul-browser-testing/SKILL.md](../.agents/skills/saul-browser-testing/SKILL.md).
