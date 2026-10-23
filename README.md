# Saul workspace

One repository for independently installed Chrome and macOS applications, with
shared design, vocabulary, behavior and interface contracts. Implementations,
credentials and local records remain app-owned. Mobile and two-way sync are future work.

| Application                 | Install independently                                       | Development                    |
| --------------------------- | ----------------------------------------------------------- | ------------------------------ |
| [Saul](apps/saul/README.md) | Chrome extension; optional ChatGPT and tab helpers          | TypeScript/React, Node helpers |
| [EZ](apps/ez/README.md)     | Native macOS app; no Saul, Node or Codex runtime dependency | SwiftUI/AppKit and Swift core  |

## Setup

Start with [selective installation](docs/setup.md). From the repository root:

```sh
node scripts/setup.mts --components extension --dry-run
node scripts/setup.mts --components extension --prepare
node scripts/setup.mts --components ez --dry-run
```

To install EZ on this Mac, quit it and run `make -C apps/ez install`; the existing
pinned identity is already retained. On another Mac, follow the signing setup guide.

No package is published to npm. The setup command is an optional coordinator;
each application's own build/install commands remain usable. Chrome loading is
explicit. Codex registration is an explicit `--codex` option, never a prerequisite.

## Develop

Use Node 24 and the pinned pnpm version, then `pnpm install --frozen-lockfile`.
Native development also needs Apple tools and `make -C apps/ez tools`.

```sh
pnpm check                 # Shared + browser + macOS checks
pnpm check:shared          # Shared tooling, contracts and browser design receipts
pnpm check:saul            # Browser app checks
pnpm check:ez              # All design receipts + native checks (macOS)
pnpm build:saul
pnpm build:ez
pnpm test:e2e              # Disposable browser tests; observe macOS launch policy
pnpm design:generate       # Regenerate CSS, TypeScript and Swift together (macOS)
```

Git hooks use the root `.pre-commit-config.yaml`; install through
`bash scripts/install-hooks.sh`. Native commands run from `apps/ez` or with
`make -C apps/ez`. Browser commands run from `apps/saul` or with `pnpm --dir apps/saul`.

- [Architecture and decisions](docs/architecture.md)
- [Shared behavior and interfaces](contracts/README.md)
- [Vocabulary](GLOSSARY.md)
- [Design](DESIGN.md) and [feature review](design/SKILL.md)
- [Migration verification](docs/migration.md)

Naming is provisional. A future rename must separate display names from installed
identities; the shared contracts use domain terms rather than product names.
