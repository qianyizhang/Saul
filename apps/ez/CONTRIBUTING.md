# Contributing

## Development setup and gates

| Goal                               | Requirement or command                                                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core checks                        | Swift 6.3 and Apple Command Line Tools. `make test-core` from `apps/ez`.                                                                           |
| App build, preview and full checks | Xcode toolchain with SwiftUI compiler plug-ins. `make tools`, then `make check` from `apps/ez`.                                                    |
| Commit and push hooks              | Install uv and run `bash scripts/install-hooks.sh` from the root. Hook dependencies stay out of EZ.app.                                            |
| Run hooks on the worktree          | `bash scripts/pre-commit.sh run --all-files`. Add `--hook-stage pre-push` for the native push gate. Installed commit hooks inspect staged changes. |
| Restore cleared tools              | `make tools` after `make clean`. Shared hook cache stays under root `.cache/`.                                                                     |

- **Gate owners** — [Makefile](Makefile), [hook configuration](../../.pre-commit-config.yaml), [GitHub checks](../../docs/ci.md).
- **Tool pins** — [Native versions and release hashes](scripts/bootstrap-tools.sh), [hook runner and Python](../../scripts/pre-commit.sh), [CI runner and Xcode](../../.github/workflows/native.yml). Verify release hashes when changing pins.
- **Acceptance** — [Offline and installed evidence](docs/verification.md). [Signing and distribution](docs/releasing.md) owns release checks.

## A feature change

| Goal                     | Outcome                                                                                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bound the change         | User-visible behavior, failure cases and acceptance checks. Agree on material authentication, storage or interaction changes first.                                                                      |
| Preserve architecture    | [EZ rules](AGENTS.md) and [runtime boundaries](docs/architecture.md). Keep UI state out of networking and storage.                                                                                       |
| Preserve data and access | Versioned decoding and preservation tests for schema changes. Use synthetic inputs. Exclude credentials and OAuth URLs from evidence.                                                                    |
| Verify behavior          | Run `make format` then `make check` after Swift changes. Inspect a packaged app for UI changes. Check consent, cancellation, data loss, accessibility, keyboard use and visible recovery where affected. |
| Deliver                  | Update the owning docs and [changelog](CHANGELOG.md). Report checks and gaps. Keep commits scoped to owned work.                                                                                         |

## Repository conventions

- **Dependencies** — Specific need, license review, pinned resolution and an account of shipped code.
- **Core types** — Use domain names and interfaces with concrete callers.
- **Branches** — `main` integrates work. Use short feature branches for substantial changes.
