# Working on Saul

Saul is a Chrome MV3 extension. Start with [architecture](docs/architecture.md)
and [product contracts](docs/product.md); use the existing modules and harness.

For feature UI, forms, metadata, actions, or disclosure changes, read the
[design contract](../../DESIGN.md) and follow the [feature UI review](../../design/SKILL.md#feature-ui-review)
before implementation and completion. Edit the contract, then regenerate with
`pnpm design:generate`; do not hand-edit generated tokens. Adapt layout density
to the surface while preserving the shared identity and motion guidance.

## Changes

- Reuse the native protocol registry and browser fixtures before adding helpers.
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
[Saul terms](GLOSSARY.md) for browser-specific meaning. Consequential decisions
belong in [architecture](docs/architecture.md); checks and diagnosis belong in
[testing](docs/testing.md). Shared design application and adoption use
[the root workflow](../../design/SKILL.md). Keep generic skills at user scope.
