# Working on Saul

Saul is a Chrome MV3 extension. Start with [architecture](docs/architecture.md)
and [product contracts](docs/product.md); use the existing modules and harness.

For feature UI, forms, metadata, actions, or disclosure changes, read the
[design contract](../../DESIGN.md) and follow the [feature UI review](../../design/SKILL.md#feature-ui-review)
before implementation and completion. Edit the contract, then regenerate with
`pnpm design:generate`; do not hand-edit generated tokens. Adapt layout density
to the surface while preserving the shared identity and motion guidance.

## Changes

- Preserve concurrent edits. Stage explicit paths and keep commits coherent.
- Keep request validation at extension boundaries and infer results from request types.
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
Choose tests that exercise behavior, failure recovery or persisted data; avoid source-text assertions.

## Browser execution

Use the root [artifact policy](../../docs/artifacts.md) for test outputs and cleanup.

Read the [browser-testing skill](../../.agents/skills/saul-browser-testing/SKILL.md).
On this Mac, request approved execution outside the restricted command sandbox for
the first browser launch. Keep ordinary checks sandboxed. Use disposable profiles
and the existing startup guard; inspect the first error before retrying. A startup
permission failure blocks verification, not an application assertion. Do not use
personal profiles, kill unrelated browsers or disable sandboxing globally.

## Shared agent skills

The generic suite is installed once for the user account from repo-kit.
Read [local mappings](docs/agent-skills.md) before using it.
Keep project-specific skills and rules here. Accepted decisions remain settled;
continue already-authorized work without repeated confirmation unless a material
ambiguity remains. Retro and architecture surveys require explicit invocation.
