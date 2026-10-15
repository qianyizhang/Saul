# Contributing

## Development setup and gates

Install Apple Command Line Tools with Swift 6.3+ and
[uv](https://docs.astral.sh/uv/getting-started/installation/) (`brew install uv`),
then run `make hooks`. This downloads checksum-verified macOS linters and installs
both Git hooks. `make tools` alone is enough for `make check`; uv/Python are needed
only for the development hook runner. Nothing is added to EZ.app.

| Python analogy | EZ gate |
| --- | --- |
| Ruff formatting | Apple's [swift-format](https://github.com/swiftlang/swift-format), using `.swift-format` |
| Ruff linting | [SwiftLint](https://github.com/realm/SwiftLint) 0.65.1, explicit correctness rules using SwiftSyntax |
| mypy | Swift compiler type checking, warnings as errors, [complete concurrency checking](https://www.swift.org/migration/documentation/swift-6-concurrency-migration-guide/enabledataracesafety/) |
| pytest | `make test`, the existing offline core and app-state executables |

Commit hooks check whitespace, merge markers, YAML/JSON, private keys, files over
512 KiB, Swift, shell scripts, workflows, and plists. They do not rewrite Swift;
use `make format` to fix formatting. Push hooks run `make check`, including both
offline suites. Run `make pre-commit` or `make pre-push` to reproduce each gate.
Git commit hooks check staged changes; manual gates check the current working tree.

Native linters live in ignored `.build/tools/`. Their versions and release archive
SHA-256 hashes are pinned in `scripts/bootstrap-tools.sh` for Apple Silicon and Intel.
Run `make tools` again after `make clean`.
Hook environments use ignored `.cache/`, which survives `make clean` so installed
hooks retain their Python interpreter. `scripts/pre-commit.sh` pins
pre-commit 4.7.0 and Python 3.12; hook revisions and CI actions use full commit hashes.
Installed hooks use pre-commit's generated runner with the same repository cache.
Update pins deliberately, verify release hashes, and run both gates before delivery.
Dependabot proposes weekly GitHub Actions updates; native tools and hook revisions
are updated manually.

CI uses macOS 26 with Xcode 26.6, runs both hook gates and `make app`
with ad-hoc signature verification. It needs no account, secrets, or live inference.
Workflow permissions are read-only; checkout credentials are not persisted.
Packaging validates a local development bundle. Publishing, Developer ID signing,
and notarization remain explicit release work in [the release guide](docs/releasing.md).

## A feature change

1. Describe the user-visible behavior and acceptance checks. For larger work,
   agree on scope before changing authentication, storage, or the app's interaction model.
2. Read `AGENTS.md` and `docs/architecture.md`; inspect the working tree.
3. Implement a bounded change. Keep UI state out of the networking and storage layers.
4. Add tests for meaningful behavior and failure modes. Prefer small synthetic
   values over captured user payloads. Never record OAuth URLs or live credentials.
5. Run `make format`, `make pre-commit`, and `make check`; package and inspect the native app when UI changes.
6. Update relevant docs and `CHANGELOG.md`. Describe checks and limitations in the PR.

## Repository conventions

- `main` is the integration branch. Use short feature branches for substantial work.
- Keep commits cohesive and reviewable; do not stage unrelated changes.
- Public core types use clear domain names. Avoid speculative generic provider frameworks.
- No implicit migrations: add versioned decoding and a preservation test before
  changing persisted history or Keychain schemas.
- Dependency additions need a specific reason, license review, pinned resolution,
  and an account of what ships inside the application.
- GitHub Actions runs the macOS checks on pushes and pull requests; see
  [verification](docs/verification.md) for dated results and remaining acceptance gaps.

## Review priorities

Check consent and account ownership, rotating refresh tokens, loss of user text,
cancellation, schema compatibility, accessibility labels, keyboard paths, and
visible error recovery. Verify completed inference separately from sign-in.
