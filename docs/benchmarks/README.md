# Benchmark evidence

These files are retained measurement evidence, not product guarantees.

| File                          | Scope                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `reading-scale.json`          | SQLite-WASM/OPFS history, search, export, and query-plan samples at 50k/100k runs |
| `reading-rendering.json`      | Anchor restoration and unchanged-status refresh for 100/1,000 passages            |
| `rendering-capabilities.json` | CSS Custom Highlights, underline style, and hit-testing support                   |

Refresh all three with `pnpm benchmark`. The expanded command is:

```sh
pnpm build
pnpm exec playwright test --config tests/e2e/playwright.benchmark.config.ts
```

## Interpretation

- Runs use synthetic fixtures in one local Chrome/SQLite-WASM environment.
- Timings are warm local samples, not cold-start, end-to-end, supported-size, or latency commitments.
- `reading-scale.json` compares selected query indexes against a reduced query shape; it is not an old-release benchmark.
- Rendering measurements exclude React, messaging, cold layout, and paint time.
- Capability evidence applies only to the recorded browser build.
- `rendering-capabilities.json` predates timestamp capture; its browser build and Git history are its retained provenance.

The Playwright cases write these tracked files. Review the evidence diff and its source revision before committing a refresh.
