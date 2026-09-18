# Saul

A local-first Chrome reading assistant built with WXT, React and TypeScript.

- **Reading:** explain a selection, ask for a simpler answer or example, and revisit automatically saved history with bookmarks and full-library export.
- **Tabs:** preview sorting, grouping, and moving; undo an unchanged last sort.
- **Settings:** separate provider profiles, response language, context choices, and connection/generation checks.

Use **Open full workspace** for the full reading library and tab organizer. See [features and behavior](docs/product.md).

```sh
pnpm install
pnpm dev
pnpm build
```

## Codex tab access

List open tabs and organize them through a native messaging bridge, CLI or MCP server. Supports previews, sorting, grouping, ungrouping and moving tabs, with pinned tabs and existing groups preserved during sorting.

See [setup and usage](docs/native-messaging.md) to install the native host and connect Codex. The bridge is opt-in and targets Chrome on macOS/Linux.

```sh
pnpm compile
pnpm format:check
pnpm test
```
