# Artifacts and retained references

## Layout and retention

| Output                       | Location from repository root                             | Retention                                                            |
| ---------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| Browser test reports         | `.artifacts/saul/e2e/<run>/{results,report}/`             | After review, remove spent runs                                      |
| Browser benchmark candidates | `.artifacts/saul/benchmark/<run>/{results,report}/`       | Promote accepted measurements before cleanup                         |
| Native captures and reviews  | `.artifacts/ez/<run>/`                                    | After review, remove spent runs                                      |
| Cross-app diagnostics        | `.artifacts/shared/<run>/`                                | After review, remove spent runs                                      |
| Durable measurements         | [Saul benchmarks](../apps/saul/docs/benchmarks/README.md) | Tracked evidence                                                     |
| Hosted CI                    | [Workflows](ci.md)                                        | Failure diagnostics for seven days, installable bundles for fourteen |

- **Disposable outputs** — Root `.artifacts/` only. Git and formatting ignore it. Keep source, credentials, user data, signing state and sole durable copies outside it.
- **Major outcomes** — One bundle per outcome under `practices/artifacts.md`. Its README owns source revision, final checks, limits and retention. Routine passing checks need no saved logs or checksum receipts.
- **Durable evidence** — Promote the minimum result, command, conditions, source and limitations into the owning tracked doc. Scrub private content and identifiers.
- **Browser runs** — `latest` is replaced on rerun. Set `SAUL_TEST_RUN=<scope>` to isolate results and reports. [Test commands](../apps/saul/docs/testing.md#commands)
- **Review at 30 days** — Keep older bundles only for a named use and next review date. Check readers and preserve evidence supporting live claims before removing spent material.

## Historical references

| Reference                                                                                                                                                   | Evidence                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [Behavior Atlas](../design/behavior-atlas/README.md)                                                                                                        | Point-in-time maps and accepted comparisons                                                                                                  |
| [Archived runtime explainer](https://github.com/qianyizhang/Saul/blob/57a4558bd1d0427754ca0b93fef054561f5a8e05/docs/explainers/runtime-lifecycle/README.md) | Provenance and checks at `57a4558bd1d0427754ca0b93fef054561f5a8e05`. Open `docs/explainers/runtime-lifecycle/index.html` from that revision. |

- **Keep** — Unique evidence, original baseline, checks and limits. Compact routine records in their owning doc.
- **Freeze** — Preserve old diagrams, anchors, examples, comparisons and technical details. Label historical bundles in the README and direct entry page. Use the [living owners](architecture.md#documentation-ownership) for current behavior.
- **Reproduce or reconstruct** — A regenerated view still describes the old baseline. A new review requires a new source baseline. Disposable captures use the same retention rules.

## Periodic cleanup

| Goal                                      | Root command                   |
| ----------------------------------------- | ------------------------------ |
| Preview directories, count and bytes      | `pnpm artifacts:clean`         |
| Clear all disposable outputs after review | `pnpm artifacts:clean --apply` |

- **Before clearing** — Stop writers and close reports. The command cannot detect active writers.
- **Scope guards** — Fixed `.artifacts/` target. Refuses a symlink root or tracked contents. Skips nested symlink targets. Retains the empty root. Cleanup is manual.

## Outside this cleanup boundary

- **Toolchain outputs** — Leave `apps/saul/.output`, `apps/saul/.wxt`, `apps/saul/.build/native`, `apps/ez/.build`, `apps/ez/dist`, `node_modules` and `.cache` to their build workflows. Installed apps may depend on a built path. [Helper delivery](architecture.md#typescript-maintenance)
- **Installed and recovery state** — Keep the loaded root `.output/chrome-mv3`, signing pin, Keychain, installed helper directories and original EZ checkout outside cleanup. [Installation and migration](migration.md#installed-identities-and-artifacts)
