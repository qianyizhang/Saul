# Working in this monorepo

Saul (Chrome) and EZ (macOS) are independently installed applications. Read the
[architecture](docs/architecture.md) before changing ownership or installation.
Follow the app-local instructions in `apps/saul/AGENTS.md` or `apps/ez/AGENTS.md`.

For cross-app features, read the [shared contracts](contracts/README.md). Share
behavior and interfaces; keep implementations native to their runtimes. Data,
credentials and execution remain app-owned. Add shared runtime code only for
concrete consumers; opt-in replacement requirements live in the architecture.

For UI changes, read [DESIGN.md](DESIGN.md) and complete the
[feature UI review](design/SKILL.md#feature-ui-review). Generate tokens with
`pnpm design:generate`; `pnpm design:check` verifies all surfaces on macOS.

Use Node 24 and the packageManager pinned in package.json for JavaScript tooling.
`pnpm check` runs shared, browser and native gates on macOS. CI separates Linux
browser checks from native checks. For browser launches on this Mac, use approved
execution outside the command sandbox, disposable profiles, and the existing
startup guard; see [browser testing](apps/saul/docs/testing.md).

Preserve concurrent edits and stage explicit owned paths. Installed extension
identity, bundle/signing identity and credential-store IDs are migration contracts,
not branding strings. See [setup](docs/setup.md) before changing installed paths.
