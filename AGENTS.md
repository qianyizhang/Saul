# Working on Saul

Saul is a Chrome MV3 extension. Start with [architecture](docs/architecture.md)
and [product contracts](docs/product.md); use the existing modules and harness.

## Changes

- Preserve concurrent edits. Stage explicit paths and keep commits coherent.
- Keep request validation at extension boundaries and infer results from request types.
- Reuse the native protocol registry and browser fixtures before adding helpers.
- Remove obsolete code and docs with their callers/links. Keep benchmark evidence intact.
- Do not add compatibility layers or dependencies without a concrete consumer.

## Checks

Use Node 24 (`.node-version`) and the pinned pnpm version (`package.json`).

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:e2e
```

Use `pnpm format` for formatting. Pre-commit runs formatting, lint, types and local
documentation links; CI also runs unit/transport tests, production build and browser tests.
Choose tests that exercise behavior, failure recovery or persisted data; avoid source-text assertions.

## Browser execution

Read the [browser-testing skill](.agents/skills/saul-browser-testing/SKILL.md).
On this Mac, request approved execution outside the restricted command sandbox for
the first browser launch. Keep ordinary checks sandboxed. Use disposable profiles
and the existing startup guard; inspect the first error before retrying. A startup
permission failure blocks verification, not an application assertion. Do not use
personal profiles, kill unrelated browsers or disable sandboxing globally.
