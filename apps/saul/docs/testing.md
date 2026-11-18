# Testing

The ordinary suite uses a built extension, disposable Chromium and a loopback
article/model server. No real account or personal profile is required.
Explicit live probes are opt-in.

## macOS browser execution

Read `macos-browser-testing.md` in `$CODEX_HOME/practices`
(default `~/.codex/practices`) before launching Chrome on this Mac.

Playwright preflight records the first startup failure and stops relaunches.
Keep the probe and browser crash notifications enabled.

## Commands

Run commands from `apps/saul`. Root `pnpm check` runs the combined gate; see
[app scripts](../package.json), [hooks](../../../.pre-commit-config.yaml) and [GitHub checks](../../../docs/ci.md).

```sh
# Browser app gate
pnpm check

# Check pinned Chromium before starting a browser slice; install if missing
pnpm test:e2e:check-browser
pnpm test:e2e:install

# Rebuild and test
pnpm test:e2e
pnpm test:e2e:headed

# PR smoke tests
pnpm test:e2e --grep @smoke

# Hands-on disposable browser
pnpm test:user
pnpm test:user --smoke
```

Use Playwright's default shared browser cache across runs and checkouts. It
selects the Chromium revision from the installed Playwright version. If you set
`PLAYWRIGHT_BROWSERS_PATH`, use the same absolute path for install, check, and
test. Browser setup is separate from running tests. The browser cache contains
binaries; the harness still creates disposable profiles.

For fixture-only edits, run `pnpm test:e2e:reuse tests/e2e/<spec>` against the
existing extension and native helper build. Use `pnpm test:e2e` when the built
sources changed or you can't confirm which revision was built. Both accept
Playwright filters and run the startup probe.
Use `pnpm exec tsc -p tests/e2e/tsconfig.json` to check fixture types.

Optional evidence runs:

```sh
SAUL_LIVE_GITHUB=1 pnpm exec playwright test -g 'live GitHub'
pnpm benchmark
```

Do not rebuild another task's snapshot. Give concurrent suites distinct
`SAUL_TEST_RUN` names (letters, digits, underscore or hyphen): Playwright
clears each run's results at startup.

## PDF summaries

- [Attachment spec](../tests/e2e/pdf-attachment.spec.ts) covers no PDF download,
  unchanged URL on restart/Retry, metadata-only comparison, no fallback and
  narrow light/dark inspection. [Plan tests](../tests/chatgpt-plan.test.mts) verify
  `input_file.file_url` without a Files request.
- [Local spec](../tests/e2e/pdf-summary.spec.ts) runs packaged PDF.js through the
  viewer, extensionless/query URLs, scanned/mixed pages, coverage and malformed,
  denied, password, bounded, stopped, navigated or closed captures. It checks the
  real deadline, unresponsive worker cancellation and frozen-source restart Retry.
  [PDF unit tests](../tests/pdf.test.ts) cover network/stream limits.

From `apps/saul`, use `SAUL_PDF_EXAMPLE` with the supplied Herzlinger PDF stored
under root `.artifacts/saul/pdf-capture/`, or `SAUL_PDF_EXAMPLE_URL` for its public
URL. Run `pnpm exec playwright test tests/e2e/pdf-summary.spec.ts -g Herzlinger`.
Expect 49 pages and exact extracted input in the fixture; neither mode proves
live cookie-authenticated access.

## Test layers

| Layer          | Scope                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Vitest         | Contracts, parser/provider streams, settings, runner, storage, tab operations, native framing/CLI/MCP/installer                         |
| Playwright     | Real extension contexts, shared native SQLite via isolated helper transport, page interaction, restart/loss, migrations, tabs, settings |
| Manual sandbox | Layout, reading flow, keyboard behavior, and interaction quality in a disposable browser                                                |

[Harness support](../tests/e2e/support.ts) and [fixtures](../tests/e2e/fixtures.ts)
snapshot the build and reuse its disposable profile across relaunch.
Test-only database, marker and browser adapters stay out of production bundles.

The MCP fixture uses delivered HTML in an opaque frame under CSP. After creating
tabs/windows, call `matchWorkspaceWindow(host)`: Chrome can reset native bounds
while wide emulation makes screenshots look correct but pointer events miss.

## Artifacts and debugging

Results and HTML reports live in root `.artifacts/saul/e2e/<run>/`; benchmarks
use `.artifacts/saul/benchmark/<run>/`. Default run name: `latest`. Set
`SAUL_TEST_RUN` instead of overriding output paths. Review screenshots are
opt-in via `SAUL_CAPTURE_REVIEW=1`; normal assertions and failure traces,
screenshots and logs still run. Successful traces are discarded. See the
[artifact policy](../../../docs/artifacts.md) for retention.

From `apps/saul`:

```sh
pnpm exec playwright show-report ../../.artifacts/saul/e2e/latest/report
pnpm exec playwright show-trace ../../.artifacts/saul/e2e/latest/results/<case>/browser/trace-1.zip
```

## Debug by symptom

| Symptom                                             | Check first                                                                                                                                                                  |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared history unavailable                          | Check `native/storage/history.mts` and the history/configuration helper; persistence errors must reach callers without a separate local store.                               |
| ChatGPT connection unavailable                      | Verify the installed [signed owner and client compatibility](../../../contracts/credentials.md#retirement-and-removal). The history helper cannot sign in.                   |
| Receiving end missing on cold start                 | `src/platform/chrome/offscreen.ts` must lock the offscreen existence check and creation together.                                                                            |
| Background save gets no response                    | Popup/content route through background; background targets offscreen directly.                                                                                               |
| Extension context invalidated after reload          | Page UI must check WXT context validity and dispose listeners/timers without calling a dead port.                                                                            |
| Saved settings need repair                          | Use the explicit Settings recovery action. The latest invalid record is retained in trusted local storage under `saul_user_settings_recovery_backup`; history is unaffected. |
| SPA result appears on the wrong route               | Use current main-frame `sender.tab.url`; reconnect the route subscription with the reset.                                                                                    |
| Marker never returns on changing content            | Keep bounded scheduled reattachment; ambiguous or truncated maps remain unresolved.                                                                                          |
| Raw term tags appear in history                     | Render with `AnnotatedTextView`; do not display `responseRaw` directly.                                                                                                      |
| `EPERM` on loopback, Unix socket, or browser launch | Treat as execution permission until the same check runs with required local access.                                                                                          |
| pnpm store mismatch                                 | Inspect `storeDir` in `node_modules/.modules.yaml`; reuse it or reinstall intentionally.                                                                                     |

## Hands-on checks

Use `pnpm test:user` for affected journeys:

- Exercise [reading](product.md#reading) through click vs keyboard submission,
  close before completion, marker restore after refresh, note/pin/follow-up,
  Stop, unread state and source navigation. Check editing/native shortcuts.
- Toggle error notices and Min Mode across two views and restart. Verify
  presentation still changes with invalid provider settings, and errors,
  unsaved work and Details stay reachable.
- Make Settings conflicts in two surfaces. Cancel preserves the original draft;
  review requires conflict choices, Apply updates only the draft, and Save
  checks the new revision. Already delivered writes need no second commit.
- Check tab editing or [proposal approval](mcp-app.md#proposal-and-approval-lifetime)
  when affected.

Smoke verifies setup only. Record the built revision and unverified paths.

## Evidence limits

Linux CI skips the board journey “shared window labels load initially and duplicate removals stay editable until Apply”. Its native-pointer delivery remains unverified on that runner; the journey stays enabled on macOS. The other board and summary journeys remain enabled.

The default browser suite uses deterministic local fixtures. It does not verify live provider credentials/output, personal native-host registration, or other browsers. Benchmark reproduction and scope are documented in [benchmarks](benchmarks/README.md).

The retired on-device and standalone ChatGPT paths keep saved work readable
and block execution until the user chooses a supported route. Browser fixtures
exercise plan request handling; the
[native credential checks](../../ez/docs/verification.md#repeatable-offline-gate)
cover the signed owner's storage and protocol. Socket tests require local
binding. See the [browser skill](../../../.agents/skills/saul-browser-testing/SKILL.md).

## Explicit live digest check

For a deliberate live plan check, use a verified installed Chrome client and
signed owner. Sign in or select an existing shared registration in Connections,
bind a plan preset, and run **Summarize** on public pages. Verify completion,
reopen the saved result and check English–Chinese HTML export. This uses plan
allowance. Record sign-in, model discovery and inference separately; the
disposable automated suite does not establish this result.

## TypeScript and delivered helper checks

`pnpm typecheck` checks the extension, shared protocols and models, Node helpers,
browser board, JXA, tooling, unit tests and browser fixtures in their own compiler contexts. It prepares the
emitted runtime needed by delivery tests. `pnpm test` also builds that runtime.
Use `pnpm saul`, `pnpm mcp` and `pnpm native:install` for development entry points;
they build first. Installed launchers keep their existing paths and need only Node.
Direct tooling commands now use `.mts`, for example `node scripts/verify-connection.mts`.

Subprocess and installation tests exercise `.build/native/*.mjs`, complete adjacent
assets, retained generations and the emitted JXA script. Pure unit tests import
source. The source/output decision is recorded once in the
[root architecture](../../../docs/architecture.md#typescript-maintenance).

## Browser annotation checks

[Store and runner cases](../tests/browser-annotations.test.ts) cover revisions,
scope, idempotency, retention, image requests and atomic reply completion.
[Browser journeys](../tests/e2e/browser-annotations.spec.ts) use real extension
and SQLite boundaries with synthetic pages and models. Exercise all capture
targets, capture before panel resizing, navigation/zoom/scroll races, restart,
conflicts, delete/restore, cancellation, scoped batch failures and exact
request inspection. Check keyboard picking/Escape/focus and narrow/wide
light/dark editor states. The test-only service-worker bridge ships only in
disposable builds.

## Dated evidence

These records describe only the tested baseline, not the current build.

### Metadata review — 2026-10-20

The migration review checked value alignment, long labels, keyboard disclosure
and 360/440/1000 px light/dark layouts across Settings, reading, board and errors.
It used disposable fixtures and approved local sockets. Personal Chrome stayed
loaded. [Original review](https://github.com/qianyizhang/Saul/blob/0fe5829ade6b6a6be6ae3629c6fb79ef1a45feb9/apps/saul/docs/testing.md#metadata-review--2026-10-20)

### Annotations — 2026-11-16

At `f601ca1`, disposable journeys verified side-panel capture, scoped agents,
replies, restart, navigation races, atomic revisions and retention. Regressions
covered conflicts, deletion, concurrent invocations, queued cancellation, failed
batch admission and native image/PDF serialization. Light/dark editor captures
were reviewed. Personal installation, installed Codex image delivery, live
inference and Linux/Windows acceptance were outside this verification.

### PDF URL attachment — 2026-10-29

One live public Herzlinger PDF request on an eligible saved plan account,
GPT-6 Luna and medium effort, completed with a document-specific bilingual
summary. Saul sent the URL without PDF bytes. This did not measure page coverage
or validate other models, URLs or accounts.

### Direct OAuth route probe — 2026-10-21

One refreshed, plan-enabled token was used for every request. Models returned
HTTP 200 and Responses on GPT-6 Luna completed with `OK`. Speech
(`gpt-4o-mini-tts` / coral), embeddings (`text-embedding-3-small`) and chat
completions (GPT-6 Luna) each returned 401 `no_matching_rule`. A 1024×1024
low-quality image request (`gpt-image-2.5-flare`) returned 401
`hardened_oauth_rule_missing`. These are account/registration-specific results;
no audio or image was generated and Realtime/private routes were not tested.
The removed OAuth speech UI was exercised with synthetic bytes for playback
controls, rejection, input validation, cancellation, draft and layout behavior.
Personal Chrome/helper and live playback were not verified.

### Tab board timing — 2026-10-19

Three dry runs over 175 live tabs in eight windows with native names:
`6e43593` took 2543/2545/2530 ms, the optimized path 576/570/583 ms
(77% lower median). One single-tab move reported 29 changed indices before
and one required move after. No mutation, draft replacement or host timing.
