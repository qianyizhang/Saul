# Working in this monorepo

Use `$CODEX_HOME/AGENTS.md` (default `~/.codex/AGENTS.md`) and its practice guides
when present; local contracts and checks below still apply.

Saul (Chrome) and EZ (macOS) are independently installed applications. Read the
[architecture](docs/architecture.md) before changing ownership or installation.
Follow the app-local instructions in `apps/saul/AGENTS.md` or `apps/ez/AGENTS.md`.
For lifecycle design, refactoring or review, apply
[lifecycle ownership](docs/architecture.md#lifecycle-ownership).

For cross-app features, read the [shared contracts](contracts/README.md). Share
interfaces and keep implementations native to their runtimes. Follow
[data ownership](docs/architecture.md#data-ownership) and the rules for
[opt-in replacements](docs/architecture.md#optional-shared-capabilities).

For UI changes, read [DESIGN.md](DESIGN.md) and complete the
[feature UI review](design/SKILL.md#feature-ui-review). Edit
[design/tokens.md](design/tokens.md) for token values; regenerate with
`pnpm design:generate`. Run `pnpm design:check` to verify outputs.

Author maintained JavaScript-family logic in strict TypeScript, including helpers,
the board, tooling and tests. Keep JavaScript only for small tool-required config
files or generated output; do not maintain declaration twins or parallel JS sources.
Compiler boundaries and emission rationale live in the
[TypeScript decision](docs/architecture.md#typescript-maintenance).

Use Node 24 and the packageManager pinned in package.json for JavaScript tooling.
`pnpm check` runs shared, browser and native gates on macOS. CI separates Linux
browser checks from native checks. For browser tests, read the
[testing runbook](apps/saul/docs/testing.md).

Write disposable diagnostics, screenshots and review exports under root `.artifacts/`.
Follow the [artifact policy](docs/artifacts.md) for retention and cleanup; never put
source, credentials or durable evidence there.

Installed extension identity, bundle/signing identity and credential-store IDs are migration contracts,
not branding strings. See [setup](docs/setup.md) before changing installed paths.

## Architecture decisions

Read linked architecture decision records (ADRs) before changing an established
boundary. Record an accepted choice in an ADR when it is costly to reverse,
surprising without context, and resolves a real trade-off. Write the context,
choice and reason; the living contract owns current behavior.

Use `docs/adr/NNNN-slug.md` at the root for shared decisions or under the owning
app for app-only decisions. Link from the living owner to the ADR. When replacing
a decision, retain the old record and link it to its successor.
