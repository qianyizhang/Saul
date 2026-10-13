# Contributing

## A feature change

1. Describe the user-visible behavior and acceptance checks. For larger work,
   agree on scope before changing authentication, storage, or the app's interaction model.
2. Read `AGENTS.md` and `docs/architecture.md`; inspect the working tree.
3. Implement a bounded change. Keep UI state out of the networking and storage layers.
4. Add tests for meaningful behavior and failure modes. Prefer small synthetic
   values over captured user payloads. Never record OAuth URLs or live credentials.
5. Run `make format` and `make check`; package and inspect the native app when UI changes.
6. Update relevant docs and `CHANGELOG.md`. Describe checks and limitations in the PR.

## Repository conventions

- `main` is the integration branch. Use short feature branches for substantial work.
- Keep commits cohesive and reviewable; do not stage unrelated changes.
- Public core types use clear domain names. Avoid speculative generic provider frameworks.
- No implicit migrations: add versioned decoding and a preservation test before
  changing persisted history or Keychain schemas.
- Dependency additions need a specific reason, license review, pinned resolution,
  and an account of what ships inside the application.
- GitHub CI is configured but runs only once a remote exists and the repository is pushed.

## Review priorities

Check consent and account ownership, rotating refresh tokens, loss of user text,
cancellation, schema compatibility, accessibility labels, keyboard paths, and
visible error recovery. Verify completed inference separately from sign-in.
