# GitHub checks

Use the [PR verdict](../.github/workflows/pr.yml) to review pull requests. The
workflow prints the selected checks and reports expected skips. A selected
check must pass; failure, cancellation and an unexpected skip fail the verdict.

| Change                                              | Pull request checks                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------ |
| Documentation only                                  | File checks, formatting and links; no browser or Xcode                         |
| Saul or JavaScript workspace dependencies           | Shared and Saul checks, plus the browser smoke tests in parallel               |
| EZ                                                  | Native lint and a debug build; the affected core, state or installation checks |
| Shared credentials                                  | Browser smoke and native credential checks                                     |
| Shared design, contracts, CI or unclassified inputs | Both platforms and all fast native checks                                      |

The [scope script](../scripts/ci-scope.mts) compares the checked-out PR merge
tree against its base. It selects both platforms if the diff cannot be read
reliably. PR jobs require no credentials or live providers.

From the root, run `pnpm check:shared`, `pnpm check:saul` and
`pnpm test:e2e --grep @smoke` to reproduce the browser PR checks. For native
commands, see the [EZ Makefile](../apps/ez/Makefile). The browser harness and
examples are in the [Saul test runbook](../apps/saul/docs/testing.md).

[Browser and shared checks](../.github/workflows/ci.yml) and
[Native checks and artifact](../.github/workflows/native.yml) run the full
suites and package the development ZIPs on `main`. Run either manually against
a PR branch before merging a high-risk change, such as a storage migration,
credential or signing change, or a change to the harness itself. Use the ZIP
from the exact revision you tested. For native release requirements, see the
[release guide](../apps/ez/docs/releasing.md).

Aim for a verdict in two minutes from a routine PR update. Measure runner wait
and execution separately. Native PRs may take longer on cold builds or when
GitHub queues macOS runners.
