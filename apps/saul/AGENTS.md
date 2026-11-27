# Working on Saul

Saul is a Chrome MV3 extension. Start with [architecture](docs/architecture.md)
and [product contracts](docs/product.md); use the existing modules and harness.

For feature UI, forms, metadata, actions, or disclosure changes, read the
[design contract](../../DESIGN.md) and follow the [feature UI review](../../design/SKILL.md#feature-ui-review)
before implementation and completion. Adapt layout density to the surface
while preserving the shared identity and motion guidance.

## Changes

- For tab or page tools, extend the [operation registry](shared/protocol/protocol.mts)
  rather than defining a separate CLI or MCP schema. Preserve existing callers’
  inputs and results unless the task changes that contract.
- Extend the [existing browser fixtures](tests/e2e/fixtures.ts) for changed
  journeys. Add a case when the current checks would miss a specific regression.
- Remove obsolete code and docs with their callers/links. Keep benchmark evidence intact.
- Do not add compatibility layers or dependencies without a concrete consumer.

## Checks

Use Node 24 (root `.node-version`) and the pinned pnpm version (`package.json`).

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:e2e
```

Use `pnpm format` for formatting. Pre-commit runs formatting, lint, types and local
documentation links; CI also runs unit/transport tests, production build and browser tests.

## Browser execution

Use the root [artifact policy](../../docs/artifacts.md) for test outputs and cleanup.

Read the [browser-testing skill](../../.agents/skills/saul-browser-testing/SKILL.md).

## Document owners

Shared skills use the root [glossary](../../GLOSSARY.md), with
[Saul terms](GLOSSARY.md) for browser-specific meaning. Follow the root
[ADR rule](../../AGENTS.md#architecture-decisions). Checks and diagnosis belong
in [testing](docs/testing.md). Shared design application and adoption use
[the root workflow](../../design/SKILL.md). Keep generic skills at user scope.
