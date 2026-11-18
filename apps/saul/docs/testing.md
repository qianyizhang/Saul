# Testing

- **Default evidence** — Built extension, disposable Chromium, isolated native storage and local article/model fixtures.
- **Live evidence** — Explicit opt-in. Record the installed revision, account eligibility, model discovery and inference separately.

## macOS browser execution

- Follow `$CODEX_HOME/practices/macos-browser-testing.md` before launching Chrome. Default location `~/.codex/practices`.
- Keep browser crash notifications and the startup probe enabled. The first launch failure stops relaunches.

## Commands

| Goal                                            | Command from `apps/saul`                                        |
| ----------------------------------------------- | --------------------------------------------------------------- |
| Browser app gate                                | `pnpm check`                                                    |
| Check or install pinned Chromium                | `pnpm test:e2e:check-browser`, `pnpm test:e2e:install`          |
| Rebuild and run browser checks                  | `pnpm test:e2e` or `pnpm test:e2e:headed`                       |
| Reproduce Chromium PR smoke                     | `pnpm test:e2e --grep @smoke`. [PR gate](../../../docs/ci.md)   |
| Run a fixture-only change against a known build | `pnpm test:e2e:reuse tests/e2e/<spec>`                          |
| Open an isolated browser for hands-on review    | `pnpm test:user`. Use `--smoke` for setup acceptance.           |
| Check fixture types                             | `pnpm exec tsc -p tests/e2e/tsconfig.json`                      |
| Run optional live GitHub fixture                | `SAUL_LIVE_GITHUB=1 pnpm exec playwright test -g 'live GitHub'` |
| Reproduce performance evidence                  | `pnpm benchmark`. [Benchmarks](benchmarks/README.md)            |

- **Build provenance** — Rebuild when built sources changed or the revision is uncertain. Both E2E paths accept Playwright filters and run the startup probe.
- **Browser cache** — Reuse Playwright’s default cache. If overridden, use the same absolute `PLAYWRIGHT_BROWSERS_PATH` for install, check and test.
- **Concurrent work** — Set distinct `SAUL_TEST_RUN` values using letters, digits, underscores or hyphens. Playwright clears each run’s prior results. Keep other tasks’ snapshots intact.

## PDF summaries

| Route                                                 | Outcomes                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [URL attachment](../tests/e2e/pdf-attachment.spec.ts) | Original URL survives restart/Retry. No browser download or fallback. Inspect metadata in narrow light/dark views. [Plan wire check](../tests/chatgpt-plan.test.mts)                                                                                                                                   |
| [Local PDF.js](../tests/e2e/pdf-summary.spec.ts)      | Packaged extraction, coverage, extensionless/query URLs and scanned/mixed pages. Fail safely on malformed, denied, locked, bounded or interrupted capture. Preserve frozen source for Retry. [Transport limits](../tests/pdf.test.ts)                                                                  |
| Supplied Herzlinger example                           | `pnpm exec playwright test tests/e2e/pdf-summary.spec.ts -g Herzlinger`. Use `SAUL_PDF_EXAMPLE` for the supplied file under `.artifacts/saul/pdf-capture/` or `SAUL_PDF_EXAMPLE_URL` for the public URL. Expect 49 pages and exact extracted input. Cookie-authenticated access is outside this check. |

## Test layers

| Layer          | Evidence                                                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vitest         | Contracts, provider streams, runner, settings, tab operations and native framing/CLI/MCP/installer. Process checks use real Node hosts and private sockets with synthetic extension replies. |
| Playwright     | Real extension contexts and isolated SQLite, browser behavior, restart, migrations, tabs and settings. [Harness](../tests/e2e/support.ts), [fixtures](../tests/e2e/fixtures.ts)              |
| Manual sandbox | Layout, reading flow, keyboard behavior and interaction quality                                                                                                                              |

- **Isolation** — Snapshot the build once and reuse one disposable profile across relaunch. Test-only adapters stay out of production bundles.
- **MCP pointer fidelity** — The host loads delivered HTML under CSP in an opaque frame. Use `matchWorkspaceWindow(host)` after creating tabs/windows to align native bounds with pointer coordinates.

## Artifacts and debugging

- **Location and retention** — [Artifact policy](../../../docs/artifacts.md#layout-and-retention).
- **Review captures** — `SAUL_CAPTURE_REVIEW=1` enables named screenshots. Assertions and failure diagnostics always run. Successful traces are discarded.

```sh
pnpm exec playwright show-report ../../.artifacts/saul/e2e/latest/report
pnpm exec playwright show-trace ../../.artifacts/saul/e2e/latest/results/<case>/browser/trace-1.zip
```

## Debug by symptom

| Symptom                                              | Check                                                                                                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shared history unavailable                           | [Native history](../native/storage/history.mts) and [helper installation](../../../docs/setup.md). Persistence errors reach the caller.                                              |
| ChatGPT connection unavailable                       | [Signed owner and client compatibility](../../../contracts/credentials.md#retirement-and-removal)                                                                                    |
| Cold start, missing save response or invalid context | [Runtime and trust boundaries](architecture.md#trust-boundaries), [offscreen creation lock](../src/platform/chrome/offscreen.ts). Invalidated contexts release listeners and timers. |
| Invalid settings                                     | [Explicit settings recovery](product.md#settings-and-models). The latest invalid record stays under `saul_user_settings_recovery_backup`. History stays intact.                      |
| SPA result or marker on wrong route                  | Current main-frame `sender.tab.url`, route subscription reset and [anchor policy](architecture.md#persistence-and-anchors)                                                           |
| Raw term tags in history                             | Use `AnnotatedTextView` instead of `responseRaw`.                                                                                                                                    |
| `EPERM` from socket or Chrome                        | Reproduce with required local execution permissions.                                                                                                                                 |
| pnpm store mismatch                                  | Inspect `storeDir` in `node_modules/.modules.yaml`. Reuse the intended store or reinstall.                                                                                           |

## Hands-on checks

| Journey                       | Outcome                                                                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Reading](product.md#reading) | Click and keyboard submission, quiet close, restored marker, note/pin/follow-up, Stop, unread and source navigation. Editing shortcuts stay usable.       |
| Appearance and notices        | Min Mode and notices persist across views and restart. Invalid provider settings leave errors, unsaved work and Details reachable.                        |
| Settings conflict             | Cancel keeps the draft. Review requires a choice. Apply updates the draft. Save uses the new revision. An already delivered write needs no second commit. |
| Tab edits or proposals        | [Apply, retry and expiry](mcp-app.md#proposal-and-approval-lifetime)                                                                                      |

- Record the built revision, completed journeys and gaps.

## Evidence limits

- **Offline only** — Browser fixtures cover plan handling and retired-route regressions. [Native credential checks](../../ez/docs/verification.md#repeatable-offline-gate) cover signed storage and protocol. Personal registration, real provider output and other browsers require separate acceptance.
- **Linux CI** — Skips “shared window labels load initially and duplicate removals stay editable until Apply” because native pointer delivery remains unverified there. Other board and summary journeys stay enabled.
- **Harness guidance** — [Browser-testing skill](../../../.agents/skills/saul-browser-testing/SKILL.md).

## Explicit live digest check

- **Prerequisites** — Verified installed Chrome client, signed owner and a saved plan preset. This check uses plan allowance.
- **Outcome** — Summarize public pages. Confirm terminal completion, saved reopen and English–Chinese HTML export.

## TypeScript and delivered helper checks

- **Compiler boundaries** — Extension, shared modules, Node helpers, board, JXA, tooling and tests have separate contexts. `pnpm typecheck` prepares the emitted runtime. [Source/output decision](../../../docs/architecture.md#typescript-maintenance)
- **Delivered checks** — `pnpm test` builds and exercises `.build/native/*.mjs`, adjacent assets, retained generations and emitted JXA. Pure unit checks import source.
- **Development entry points** — `pnpm saul`, `pnpm mcp`, `pnpm native:install`. Each builds before use.

## Browser annotation checks

- **Contract** — [Store and runner cases](../tests/browser-annotations.test.ts) cover revisions, scope, idempotency, retention, image requests and atomic reply completion.
- **Browser** — [Journeys](../tests/e2e/browser-annotations.spec.ts) cover all capture targets, pre-resize capture, navigation/zoom/scroll races, restart, conflicts, delete/restore, cancellation, scoped batch failure and exact request inspection.
- **UI** — Check keyboard picking/Escape/focus and narrow/wide light/dark editor states.

## Dated evidence

- **Scope** — Results apply only to the recorded baseline.

### Metadata review — 2026-10-20

- **Checked** — Value alignment, long labels, keyboard disclosure and 360/440/1000 px light/dark layouts across Settings, reading, board and errors.
- **Conditions** — Disposable fixtures and approved local sockets. Personal Chrome stayed loaded. [Original review](https://github.com/qianyizhang/Saul/blob/0fe5829ade6b6a6be6ae3629c6fb79ef1a45feb9/apps/saul/docs/testing.md#metadata-review--2026-10-20)

### Annotations — 2026-11-16

- **At `f601ca1`** — Side-panel capture, scoped agents, replies, restart, navigation races, atomic revisions and retention. Regressions covered conflicts, deletion, concurrent invocations, queued cancellation, failed batch admission and native image/PDF serialization.
- **Review** — Light/dark editor captures. Personal installation, installed Codex image delivery, live inference and Linux/Windows acceptance were outside verification.

### PDF URL attachment — 2026-10-29

- **Observed** — One live public Herzlinger PDF completed with GPT-6 Luna, medium effort and a document-specific bilingual summary. Saul sent the URL without PDF bytes.
- **Limits** — One eligible saved plan account. Page coverage and other models, URLs and accounts were outside verification.

### Direct OAuth route probe — 2026-10-21

| Route                                                                                                    | Observed outcome                       |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Models                                                                                                   | HTTP 200                               |
| Responses on GPT-6 Luna                                                                                  | Completed with `OK`                    |
| Speech (`gpt-4o-mini-tts` / coral), embeddings (`text-embedding-3-small`), chat completions (GPT-6 Luna) | HTTP 401 `no_matching_rule`            |
| 1024×1024 low-quality image (`gpt-image-2.5-flare`)                                                      | HTTP 401 `hardened_oauth_rule_missing` |

- **Conditions** — One refreshed, plan-enabled token across all routes. Realtime/private routes and live playback were outside verification. No audio or image resulted.
- **Removed speech UI** — Synthetic playback, rejection, input validation, cancellation, draft and layout checks. Personal Chrome/helper were outside verification.

### Tab board timing — 2026-10-19

- **Conditions** — Three dry runs over 175 live tabs in eight windows with native names.
- **Observed** — `6e43593` 2543/2545/2530 ms. Optimized 576/570/583 ms, 77% lower median. One single-tab move reported 29 changed indices before and one required move after.
- **Limits** — Dry run only. No mutation, draft replacement or host timing.
