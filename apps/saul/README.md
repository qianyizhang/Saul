# Saul

Saul is a local-first Chrome extension for reading explanations and safe tab organization. It is built with WXT, React, TypeScript, and SQLite-WASM/OPFS.

## Capabilities

- **Reading:** select text, queue an explanation, keep reading, and return through persistent underlines, notifications, or history.
- **Library:** search saved passages and explanations, bookmark them, revisit sources, inspect attempts, and export Markdown.
- **Models:** use your [ChatGPT plan](docs/chatgpt-plan.md), an OpenAI-compatible endpoint, or Chrome's on-device `LanguageModel` API.
- **Window and Tab board:** select, drag, group, move and summarize tabs with shared controls; Codex proposals retain review and Apply.
- **Codex access:** opt in to local CLI/MCP tools for tab organization and new windows. A separate switch enables page reading, clicks, text filling and navigation.
- **MCP App:** drag tabs between windows beside the conversation, use keyboard move controls, or ask Codex for a layout. Review the preview, then apply it with a button. Pinned tabs and existing groups stay intact. See the [workspace guide](docs/mcp-app.md).

## Install

Use the [selective installer](../../docs/setup.md) for the extension alone, optional
helpers, or both apps. EZ and Codex are not required for standalone Saul.

### Optional Codex connection

With Node 24, the pinned pnpm version, Chrome and Codex CLI available, run from this checkout:

```sh
node scripts/setup.mjs
```

The wizard builds Saul, installs its native helper, registers MCP and verifies a real tab inventory. It guides you through loading the extension and enabling access in Chrome. See [setup and agent instructions](docs/setup.md) for unattended use, upgrades and the helper lifecycle. Run `node scripts/setup.mjs --verify` to check an existing installation.

## Develop

Use the Node version in the root `.node-version` and the pnpm version declared in `package.json`.

```sh
corepack enable
pnpm install --frozen-lockfile
bash ../../scripts/install-hooks.sh
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

| Document                                     | Purpose                                                     |
| -------------------------------------------- | ----------------------------------------------------------- |
| [Setup](docs/setup.md)                       | One-command setup, agent instructions and helper lifecycle  |
| [Product](docs/product.md)                   | Shipped behavior and current limits                         |
| [Architecture](docs/architecture.md)         | Runtime boundaries, data flow, and invariants               |
| [Design contract](../../DESIGN.md)           | Portable visual identity, component and motion principles   |
| [Design application](docs/design-system.md)  | Generation, cross-project adoption, and visual verification |
| [Testing](docs/testing.md)                   | Quality gates, browser harness, and debugging               |
| [ChatGPT plan](docs/chatgpt-plan.md)         | OAuth setup, supported API surface and credential lifecycle |
| [Native messaging](docs/native-messaging.md) | CLI/MCP setup and tab-tool safety                           |
| [Benchmarks](docs/benchmarks/README.md)      | Reproduction commands and evidence limits                   |

The native bridge is optional. See [Codex tab access](docs/native-messaging.md) for installation and removal.
