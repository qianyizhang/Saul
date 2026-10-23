# Disposable artifacts

Root `.artifacts/` is the only home for disposable test diagnostics, screenshots,
traces, logs and local review exports. Its contents may be deleted after the run
has stopped and any useful evidence has been retained elsewhere. Do not store
source, credentials, user data, signing state or the only copy of a durable record
there. The directory is ignored by Git and formatting.

## Layout and retention

| Output                             | Location relative to repository root                | Retention                                    |
| ---------------------------------- | --------------------------------------------------- | -------------------------------------------- |
| Browser tests                      | `.artifacts/saul/e2e/<run>/{results,report}/`       | Disposable after review                      |
| Browser benchmarks                 | `.artifacts/saul/benchmark/<run>/{results,report}/` | Promote accepted measurements before cleanup |
| Native captures and review exports | `.artifacts/ez/<run>/`                              | Disposable after review                      |
| Cross-app diagnostics              | `.artifacts/shared/<run>/`                          | Disposable after review                      |
| Durable benchmark evidence         | `apps/saul/docs/benchmarks/`                        | Tracked records; excluded from cleanup       |

Browser runs default to `latest`, replacing earlier results for that suite. Set
`SAUL_TEST_RUN=<scope>` for concurrent or named runs; this isolates both results
and reports. Do not write new `test-results-*` or `playwright-report` directories
at the root or inside an app. See the [browser runbook](../apps/saul/docs/testing.md).

Before clearing a result needed for a regression or decision, promote its minimal
evidence into the relevant tracked app documentation with source revision,
command, conditions and limitations. A temporary screenshot path is not a durable
receipt. Scrub account identifiers and private content before retaining or sharing.
CI retains failure diagnostics for seven days and installable bundles for fourteen.

## Periodic cleanup

At the end of a task or during periodic housekeeping, stop all test, benchmark and
capture runs in this checkout and close reports you still need. Cleanup does not
detect active writers. From the repository root:

```sh
pnpm artifacts:clean         # Preview directories, file count and bytes
pnpm artifacts:clean --apply # Delete all contents of .artifacts
```

The command has no arbitrary target argument. It refuses a symlink at `.artifacts`
or any tracked file inside it, and never follows nested symlinks. It leaves the
empty root directory in place; tools recreate their subdirectories as needed.
There is no automatic background deletion or age-based retention.

## Outside this cleanup boundary

Toolchain builds and caches stay in their conventional locations:
`apps/saul/.output`, `apps/saul/.wxt`, `apps/ez/.build`, `apps/ez/dist`,
`node_modules` and `.cache`. Rebuild or clear them only through their owning
workflow; an installed app may depend on a particular bundle path. Empty cache
directories alone are not evidence that the cache is obsolete.

`apps/saul/.build/native/` is the ignored, generated helper runtime tree.
`pnpm --dir apps/saul build:native` compiles the helpers and bundles the board with its pinned MCP Apps SDK;
the native installer stages that complete asset with the board HTML and styles.
The source MCP server and installed server deliver the same document format.

The root `.output/chrome-mv3` is still the loaded extension path and must remain
until an explicit identity/data-preserving upgrade. Never include it, native
`apps/ez/.local/signing-identity`, Keychain state, installed helper directories or
the original EZ checkout in artifact cleanup. See [migration](migration.md).
