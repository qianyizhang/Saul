# Native tab access

Saul exposes its tab organizer through a local CLI and stdio MCP server. The optional bridge uses Chrome native messaging and a private Unix socket; it has no network listener, daemon, extra dependency, or API key.

## Install on macOS or Linux

Use the repository Node version and Google Chrome on macOS or Linux. Chromium, Edge, and Brave installer paths are available but not verified live. Windows and Firefox are unsupported.

1. Run `pnpm check` and `pnpm build` in the Saul checkout.
2. In `chrome://extensions`, enable Developer mode and load the `.output/chrome-mv3` folder as an unpacked extension. If Saul is already loaded from that folder, reload it. Chrome may ask you to accept the added tab/native-messaging permissions.
3. Copy Saul's extension ID from that page (also shown under **Tabs → Connect Codex · setup and troubleshooting**).
4. Install the host, using that actual ID:

   ```sh
   node native/install.mjs --extension-id YOUR_32_LETTER_EXTENSION_ID
   ```

   The installer copies the runtime into `~/.saul/bridge`, creates `~/.saul/bin/saul` and `~/.saul/bin/saul-native-host`, and registers the host under Chrome's per-user `NativeMessagingHosts` directory. The launcher records the absolute path of the current Node executable, so GUI Chrome does not depend on your shell's PATH. Re-run the installer after updating the bridge or moving/removing that Node installation. Reinstalling preserves previously registered extension IDs for this installation.

   `--dry-run` prints the installation plan without writing. `--browser chrome|chromium|edge|brave` selects the registration location. Other Chromium browsers are supported by installer paths but have not been verified live. `--manifest-dir` supports a custom browser user-data directory; `--install-dir` changes where the runtime is copied.

5. Open Saul's **Tabs** view and enable **Codex tab access**. It should say **Connected to native host**. If the host was installed after enabling access, choose **Reconnect** or wait for the one-minute retry.
6. Verify the connection:

   ```sh
   ~/.saul/bin/saul sessions
   ~/.saul/bin/saul list
   ```

## Register with Codex

Run the `codex mcp add saul-tabs -- ...` command printed by the installer. It uses absolute paths to Node and the installed `mcp.mjs`. The equivalent development configuration is:

```sh
codex mcp add saul-tabs -- /absolute/path/to/node /absolute/path/to/Saul/native/mcp.mjs
```

Check registration with `codex mcp get saul-tabs`. Start a new Codex task or reload MCP connections if the running task has already loaded its tools.

Example requests:

- “Use Saul to list my open tabs.”
- “Preview sorting window 123 by domain, keeping existing groups intact.”
- “Group these five tabs as Research, blue, and apply the change.”

Tab titles, URLs and group titles are untrusted browser data, not instructions. Tools return metadata only; there is no page-content extraction, script execution, navigation, or tab-closing command.

## CLI and tools

Run `~/.saul/bin/saul help` for the current command list. Commands accept one JSON object and print JSON. Errors go to stderr and exit nonzero. `tools` prints the authoritative shared schemas and MCP names.

```sh
~/.saul/bin/saul list
~/.saul/bin/saul list '{"windowId":123}'
~/.saul/bin/saul sort '{"windowId":123,"by":"domain"}'
~/.saul/bin/saul sort '{"windowId":123,"by":"domain","dryRun":false}'
~/.saul/bin/saul group '{"tabIds":[12,34],"title":"Research","color":"blue","dryRun":false}'
~/.saul/bin/saul group '{"tabIds":[56],"groupId":7,"dryRun":false}'
~/.saul/bin/saul groups-update '{"groupId":7,"collapsed":true,"dryRun":false}'
~/.saul/bin/saul ungroup '{"tabIds":[12,34],"dryRun":false}'
~/.saul/bin/saul move '{"tabIds":[12,34],"windowId":123,"index":-1,"dryRun":false}'
```

Use IDs from a fresh `list`, not the example IDs above. All mutations default to `dryRun: true`, returning a plan without changing the browser. Apply with `dryRun: false`. A preview is not a transaction or reservation: tabs can change before or during application. Mutations are serialized within the extension but browser/user actions can still race. On an error or timeout, some changes may have completed: list again and inspect before retrying. Calls are never automatically replayed.

The commands cover session discovery, listing, sorting, grouping, ungrouping, moving, and group updates. Sorting keeps pinned tabs fixed and existing groups intact. Moving refuses positions inside a group; `index: -1` appends.

Each connected Chrome profile/extension instance has its own randomly named socket in `~/.saul/run`. If more than one is connected, pass a `session` from `sessions` to every browser command. Session IDs change on reconnection; do not save them as permanent profile identities. Inspect `list` for a selected session to identify its windows. Stale sockets are ignored. `SAUL_RUNTIME_DIR` can override the runtime directory, but must be the same for host and client and short enough for Unix socket paths.

## Access and troubleshooting

The native bridge is off by default. Turning it off disconnects the host and cancels queued work; a browser operation already running may finish. The native host only registers exact extension origins, and the runtime directory/socket permissions are `0700`/`0600`. Programs running as your own OS user can use the bridge while enabled. Incognito and non-normal windows are excluded. Metadata is returned to the calling CLI/MCP client on request, so Codex can receive tab titles and URLs when using these tools. The bridge does not store tab metadata on disk.

- **No browser connected:** open Chrome, load/reload the built extension, install its exact ID, enable access.
- **Host not found/forbidden:** inspect `com.saul.tabs.json` in Chrome's `NativeMessagingHosts`; confirm the absolute launcher path and `allowed_origins` match the popup's extension ID.
- **Host exited:** confirm the installed Node executable still exists and the launcher is executable. Re-run the installer after changing Node versions.
- **Multiple sessions:** use `sessions`, then pass `session` explicitly.
- **Tabs cannot be edited right now:** Chrome may be dragging tabs or changing windows. Finish that interaction, list again, then retry deliberately.
- **Sandbox permission error:** Unix socket access may need approval in a sandboxed CLI environment. The MCP server runs as a separate registered local process. Do not expose the socket over TCP to work around this.
- **Oversized list:** query a single `windowId`; messages are bounded to 1 MiB.

To disable access, turn off **Codex tab access** in Tabs. To remove Codex registration, run `codex mcp remove saul-tabs`. To uninstall the host, remove only `com.saul.tabs.json` from the browser directory printed by the installer, then remove the installed `bridge`, `bin/saul`, and `bin/saul-native-host` files under the chosen installation directory. This does not remove Saul's reading history.

## Verification and protocol references

`pnpm test` covers tab validation, previews, preserving groups/pins, UTF-8 and fragmented native frames, private socket permissions, concurrent clients, profile ambiguity, disconnect cleanup, CLI execution, MCP initialization/discovery/calls, and installer paths containing spaces/quotes. The process tests run actual Node hosts with simulated extension responses; browser API tests use mocks. These tests need local Unix-socket binding permission.

- [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Chrome tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Chrome tab groups API](https://developer.chrome.com/docs/extensions/reference/api/tabGroups)
- [MCP stdio transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)

The MCP server implements JSON-RPC initialization, ping, tool discovery and tool calls, with newline-delimited stdio transport. It advertises only tools; no resources, prompts or subscriptions.
