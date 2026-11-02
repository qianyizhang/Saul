# Browser CI performance — 2026-11-02

Routine review screenshots are now opt-in with `SAUL_CAPTURE_REVIEW=1`. All
behavioral/layout assertions and failure diagnostics remain enabled. Bulk OPFS
fixture seeding and redundant PDF setup/tab cleanup are retained. No cases were
deleted, retries remain zero, and the production worker default remains one.
Two-worker adoption still needs hosted evidence; total CI under six minutes is
not established by these local measurements.

## Conditions and measurement limits

- macOS 26.6.2, Node 24.21.0, pnpm 11.0.3, 18 available CPUs, 64 GiB RAM.
- Disposable Chrome profiles and extension snapshots; approved execution outside
  the restricted sandbox. No live model quota or personal browser data.
- Within each comparison, runs were sequential on the same build without another
  build or heavy check started by this trial. Other activity on the Mac was not
  controlled. Files retained their default sequential execution.
- `scripts/profile-e2e.mts` wraps Playwright with `/usr/bin/time -p` and samples
  aggregate descendant RSS once per second. CPU is user plus system time.
  Shared memory can be counted repeatedly, short peaks can be missed, and
  reparented processes can escape the sample. RSS is not unique physical memory.
- Wall time includes test setup, cases, teardown and reporting. It excludes
  dependency installation, production build, other gates, ZIP and upload.
- Each successful full run below had **106 passed, 6 skipped, 0 failed, 0 retries**.
  The same skips cover disabled Chrome AI (two cases), live installed-helper
  inference, native Chrome window naming, live GitHub, and the optional example
  PDF. Their parallel safety is unverified.

## Worker comparison

Source: `58656c6bed920d3e23e8743c8183ebe4e3bfc802` plus the initial test-only
fixture/diagnostics patch in this change. Production sources/build were unchanged.

| Run   | Workers | Wall seconds | CPU seconds | Peak aggregate RSS |
| ----- | ------: | -----------: | ----------: | -----------------: |
| one   |       1 |       230.73 |      314.83 |           6.97 GiB |
| two-a |       2 |       121.90 |      330.73 |           8.57 GiB |
| two-b |       2 |       124.41 |      340.89 |           8.62 GiB |

Two workers reduced wall time by 46.6% on average, with a 2.51-second repeat
spread (2.1% of the faster run). Both repeats passed without retry; this is not a
long-term reliability estimate. The real clipboard case passed in every run.

The 1,005-record export fixture seeded in 275/272/316 ms and exported through the
public route in 107/104/127 ms. Whole-case times were 999/1,023/1,139 ms. Initial
handoff measurements reported 18.87–19.37 seconds for the old 5,025-message seeding
and 56–70 ms for export, but those came from another checkout and are not a matched
old/new benchmark.

The subsequent PDF-only cleanup removed eight redundant browser launches per
default run and closed finished scenario tabs. Its full two-worker follow-up
passed in 119.04 seconds, using 321.94 CPU seconds and 8.47 GiB peak aggregate RSS.
This was one changed-candidate run, not another repeat of the original comparison.

## Review capture comparison

Source: `23456240561c47235017493604be0e3a718a65eb` plus this test-harness change.
That main commit's product/native changes were preserved. The same rebuilt
candidate was used for both successful runs below.

| Review capture | Wall seconds | CPU seconds | Peak aggregate RSS |            Named PNGs |
| -------------- | -----------: | ----------: | -----------------: | --------------------: |
| On             |       124.52 |      342.82 |           8.51 GiB | 138 (7,087,858 bytes) |
| Off            |       120.54 |      335.32 |           8.21 GiB |                     0 |

This single pair measured 3.2% less wall time, 2.2% less CPU and 3.5% lower sampled
peak RSS. It supports a modest reduction in routine work, not a large or established
memory saving. Trace recording, including its images, stays enabled.

An initial run found one stale selector inherited from main: Settings had renamed
“Summarize current page” to “Call Saul”. Before correcting the selector, the same
known failure was exercised with review capture off. It retained three failure
screenshots, console output and a trace, without routine PNGs. The initial failed
run is excluded from performance comparisons. The corrected case and both full
runs passed. No deadline or assertion was weakened to resolve it.

Reproduce from `apps/saul` after building, with distinct run names:

```sh
SAUL_CAPTURE_REVIEW=1 SAUL_TEST_RUN=review-on node scripts/profile-e2e.mts --workers=2
SAUL_CAPTURE_REVIEW=0 SAUL_TEST_RUN=review-off node scripts/profile-e2e.mts --workers=2
```

Explicit live-helper and supplied-example PDF runs retain their promised captures
under their existing opt-ins. Board capture-only resizing/scrolling and native
side-panel captures obey the new flag; test actions and assertions do not.

## Review and verification

- Bulk seeding uses the existing test-only SQLite/OPFS worker in one transaction.
  It prepares synthetic persisted rows and readable FTS data, not submission or
  anchor-identity evidence. The original lifecycle helper remains available to
  the history deletion test; reading lifecycle tests are unchanged.
- The fixture closes the production offscreen owner, terminates its own worker
  after seeding and restores normal routes. Search/bookmark/restart and export
  assertions pass against the real database. No product schema/route changed.
- Board service and child MCP diagnostics use each sandbox's own disposable root,
  with containment checked. They no longer use shared user-state pruning.
- PDF failure cases prove no generation and no pending download before closing
  tabs, so fixture cleanup cannot hide unfinished work. Real restart and the real
  30-second deadline remain covered.
- The original candidate passed shared gates (27 tests) and Saul gates (310 tests).
  Later PDF-only edits passed their focused suite and static checks. Final capture
  policy passed both full browser modes; final delivery gates are recorded in Git
  hooks and CI for the delivered revision.
- The profiler preserved nonzero CLI exit/reporting. Its signal and sampling-error
  paths have not been independently exercised.

## Hosted follow-up and retention

The original handoff cited [a hosted run](https://github.com/qianyizhang/Saul/actions/runs/41401284231)
at 8m45s overall, with 5m59s E2E, 1m36s lint/types/unit and 7s later build/ZIP.
Those historical timings were not re-fetched for this local comparison. Setup and
all required gates count toward the six-minute goal.

Before changing the production worker default, measure two-worker full runs on
the existing Ubuntu runner, preserve every gate and inspect total workflow time,
resource use and repeat reliability. Do not extrapolate a hosted guarantee from
this Mac. Review PNG opt-in and fixture improvements do not require that separate
worker-default decision.

This document is the retained benchmark result and source/conditions record.
Temporary profiles, PNGs, HTML reports and raw diagnostics may be deleted after
review. Preserve this comparison while it supports the worker-default decision;
no indefinite retention of routine captures is needed.
