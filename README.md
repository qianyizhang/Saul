# Saul

Saul is a local-first Chrome extension for reading explanations and safe tab organization. It is built with WXT, React, TypeScript, and SQLite-WASM/OPFS.

## Capabilities

- **Reading:** select text, queue an explanation, keep reading, and return through persistent underlines, notifications, or history.
- **Library:** search saved passages and explanations, bookmark them, revisit sources, inspect attempts, and export Markdown.
- **Models:** use an OpenAI-compatible endpoint or Chrome's on-device `LanguageModel` API.
- **Tabs:** preview and apply sorting, grouping, ungrouping, and moving without disturbing pinned tabs or existing groups.
- **Codex access:** opt in to a local native-messaging bridge that exposes the tab operations as CLI and MCP tools.

## Develop

Use the Node version in `.node-version` and the pnpm version declared in `package.json`.

```sh
corepack enable
pnpm install --frozen-lockfile
uvx --from pre-commit==4.6.2 pre-commit install
pnpm dev
```

Build and verify:

The hook command uses [uv](https://docs.astral.sh/uv/). It installs this repository's
format, lint, type, and documentation-link checks for future commits.

```sh
pnpm check
pnpm build
pnpm test:e2e
pnpm zip
```

Browser tests use disposable profiles and a local model fixture. On macOS, read the browser-launch approval guidance in the [testing runbook](docs/testing.md) before running them from a restricted agent sandbox.

## Documentation

| Document                                     | Purpose                                       |
| -------------------------------------------- | --------------------------------------------- |
| [Product](docs/product.md)                   | Shipped behavior and current limits           |
| [Architecture](docs/architecture.md)         | Runtime boundaries, data flow, and invariants |
| [Testing](docs/testing.md)                   | Quality gates, browser harness, and debugging |
| [Native messaging](docs/native-messaging.md) | CLI/MCP setup and tab-tool safety             |
| [Benchmarks](docs/benchmarks/README.md)      | Reproduction commands and evidence limits     |

The native bridge is optional. See [Codex tab access](docs/native-messaging.md) for installation and removal.
