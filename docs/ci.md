# GitHub checks

## Pull requests

| Change                                          | Selected checks                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------- |
| Documentation only                              | File checks, formatting and links                                     |
| Saul or JS workspace dependencies               | Shared and Saul gates plus Chromium smoke                             |
| EZ                                              | Native lint, debug build and affected core, state or installer checks |
| Shared credentials                              | Chromium smoke, credential checks and affected EZ checks              |
| Shared design, contracts, CI or uncertain scope | Both platforms and all fast native checks                             |

- **Selection** — [Scope script](../scripts/ci-scope.mts) compares the PR merge tree against its base. An unreadable diff selects both platforms.
- **Verdict** — [PR workflow](../.github/workflows/pr.yml) reports selected checks and expected skips. Failure, cancellation or an unexpected skip fails the verdict.
- **Reproduce** — Run `pnpm check:shared` and `pnpm check:saul` at the root. For Chromium and native checks, use [Saul testing](../apps/saul/docs/testing.md#commands), [EZ Makefile](../apps/ez/Makefile). PR jobs use offline fixtures without live provider credentials.
- **Timing** — Aim for a two-minute routine verdict. Measure queue wait and execution separately.

## Main and manual runs

- **Deliverables** — Development ZIPs from full [browser](../.github/workflows/ci.yml) and [native](../.github/workflows/native.yml) workflows. Use the ZIP from the tested revision.
- **High-risk PRs** — Exercise the relevant full workflow before merging storage, credentials, signing or harness changes.
- **Distribution** — [EZ release requirements](../apps/ez/docs/releasing.md#distribution).
