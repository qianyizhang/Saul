# GitHub checks

## Pull requests

Every PR runs the Linux pre-commit checks. PRs classified as documentation-only
also run formatting and link checks. All other PRs run `pnpm check:shared` and
`pnpm check:saul`, with additional jobs selected by scope.

| Change                                          | Additional jobs                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| Saul or JS workspace dependencies               | Chromium smoke                                                                      |
| EZ implementation, tooling or previews          | Native lint, state checks or a debug build, plus selected core and installer checks |
| Shared credentials                              | Chromium smoke and native credential checks, plus affected EZ checks                |
| Shared design, contracts, CI or uncertain scope | Chromium smoke and all fast native checks                                           |

- **Selection** — The [scope script](../scripts/ci-scope.mts) compares the PR merge tree against its base and defines the documentation-only paths. Changes to shared design and contract Markdown select both platforms. An unreadable diff also selects both platforms.
- **Verdict** — [PR workflow](../.github/workflows/pr.yml) reports selected checks and expected skips. Failure, cancellation or an unexpected skip fails the verdict.
- **Reproduce** — Run `pnpm check:shared` and `pnpm check:saul` at the root. For Chromium and native checks, use [Saul testing](../apps/saul/docs/testing.md#commands), [EZ Makefile](../apps/ez/Makefile). PR jobs use offline fixtures without live provider credentials.
- **Timing** — Aim for a two-minute routine verdict. Measure queue wait and execution separately.

## Main and manual runs

- **Deliverables** — Development ZIPs from full [browser](../.github/workflows/ci.yml) and [native](../.github/workflows/native.yml) workflows. Use the ZIP from the tested revision.
- **High-risk PRs** — Exercise the relevant full workflow before merging storage, credentials, signing or harness changes.
- **Distribution** — [EZ release requirements](../apps/ez/docs/releasing.md#distribution).
