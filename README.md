# Saul workspace

One repository for independently installed Chrome and macOS applications, with
shared design, vocabulary, behavior and interface contracts. Saved history and
model presets share local stores; drafts and active requests remain app-owned.
Managed credentials use an explicit shared owner. See
[data ownership](docs/architecture.md#data-ownership) for boundaries and opt-in rules.

| Application                 | Install independently                                                                 | Development                    |
| --------------------------- | ------------------------------------------------------------------------------------- | ------------------------------ |
| [Saul](apps/saul/README.md) | Chrome extension with required history helper; optional tab/action helpers            | TypeScript/React, Node helpers |
| [EZ](apps/ez/README.md)     | Native macOS app with signed credential owner; no Chrome UI, Node or Codex dependency | SwiftUI/AppKit and Swift core  |

## Setup

Follow [selective installation](docs/setup.md) for component requirements,
Chrome loading, native signing, upgrades and recovery. Preview a selection from
the repository root:

```sh
node scripts/setup.mts --components extension --dry-run
```

## Develop

Use Node 24 and the pinned pnpm version, then `pnpm install --frozen-lockfile`.
For native tool setup, see [EZ contributing](apps/ez/CONTRIBUTING.md#development-setup-and-gates).

```sh
pnpm check                 # Shared + browser + macOS checks
pnpm build:saul
pnpm build:ez
pnpm test:e2e              # Disposable browser tests; observe macOS launch policy
pnpm design:generate       # Regenerate CSS, TypeScript and Swift together (macOS)
```

Gate membership lives in [package.json](package.json), the app package/Makefile,
and [.pre-commit-config.yaml](.pre-commit-config.yaml). Use the
[Saul runbook](apps/saul/docs/testing.md) or [EZ verification guide](apps/ez/docs/verification.md)
for focused checks and diagnosis. Install Git hooks through
`bash scripts/install-hooks.sh`. Native commands run from `apps/ez` or with
`make -C apps/ez`. Browser commands run from `apps/saul` or with `pnpm --dir apps/saul`.

- [Architecture and decisions](docs/architecture.md)
- [Shared behavior and interfaces](contracts/README.md)
- [Vocabulary](GLOSSARY.md)
- [Design](DESIGN.md) and [feature review](design/SKILL.md)
- [Migration verification](docs/migration.md)

Naming and installed identities follow the [architecture decision](docs/architecture.md#naming-reminder).
