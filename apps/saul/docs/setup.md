# Browser connection and helper lifecycle

Install selected components with the [root setup command](../../../docs/setup.md).
The extension and helpers do not require EZ. Codex is needed only for an explicitly
selected MCP connection. Node 24 remains the helper runtime.

## Connect and verify

After installing the tab helper for the actual Chrome extension ID, enable
**Saul → Settings → Codex connection → Codex tab access**, then choose **Reconnect**.
Enable **Page reading and actions** only when wanted. Chrome starts the native
helper; installing its files alone does not start it.

From `apps/saul`, run the read-only connection check:

```sh
pnpm verify:connection
pnpm verify:connection --extension-id YOUR_EXTENSION_ID
```

It uses the existing `saul-tabs` registration, preserving its command, environment
and working directory. It checks MCP initialization, expected tools, the MCP App
resource, browser sessions and tab/window counts. It does not install, register,
mutate browser tabs or print titles, URLs or page text. Missing/disabled/non-local
registrations fail explicitly. Exit **0** means connected, **2** means waiting for
a matching browser, and **1** means an error.

After upgrading helper files, reconnect in Saul. Fully quit and reopen Codex before
opening the Tab board to replace old MCP processes; do not interrupt active chats
automatically. Verification launches a fresh process and does not establish that
an already-running panel has refreshed, nor does it test page actions or inference.

For agents, read the [root setup guide](../../../docs/setup.md), preserve the
existing extension identity/load path, and use the actual ID from Chrome. Leave
page access off unless authorized. Report missing UI steps instead of modifying
profile files. Real browser mutations are not a setup test; automated browser tests
use the [disposable-profile harness](testing.md).

## Native helper lifecycle

The helper is a local Node process launched by **Chrome**. The MCP server is another Node process launched by **Codex**. Neither requires you to leave a terminal open.

| Event                                                         | Helper behavior                                                                                                                                                      |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run the installer                                             | Files and Chrome registration are written. No helper is started.                                                                                                     |
| Enable Codex tab access                                       | Saul's background worker calls `chrome.runtime.connectNative('com.saul.tabs')`. Chrome reads the registered host path and starts the helper.                         |
| Start/reload Saul with access already enabled                 | The worker reads the saved switch and calls `connectNative` automatically.                                                                                           |
| Helper starts                                                 | It creates a private socket, announces readiness, and waits for local requests.                                                                                      |
| Close the Saul popup                                          | Nothing stops: the background connection owns the helper, not the popup.                                                                                             |
| Open/close a Codex chat                                       | Codex manages its own MCP process. That process connects to the helper's socket; it does not start the helper. The helper can remain running without Codex.          |
| Click Reconnect                                               | Saul closes its old native port and opens a new one. Chrome starts a fresh helper; its session ID changes.                                                           |
| Helper crashes or is missing                                  | Saul reports disconnected and retries on a one-minute Chrome alarm while access stays enabled. Alarm timing can be delayed; Reconnect requests an immediate attempt. |
| Disable access, unload the extension, or quit Chrome entirely | The native connection closes. The helper exits and ordinarily removes its socket. An abrupt kill can leave a stale socket; discovery ignores it.                     |
| Restart Chrome later                                          | When Saul's worker starts, it reconnects if access is still enabled. No macOS login item or daemon is involved.                                                      |

The **Page reading and actions** switch controls capabilities; it does not start a second helper. Turning page access off leaves tab access available. Turning the master **Codex tab access** switch off disconnects the helper.

Closing all visible Chrome windows may leave Chrome running in the background; quitting the Chrome application closes the native connection.

Implementation: [extension lifecycle](../src/native/bridge.ts), [host startup/shutdown](../native/host.mjs), [installer](../native/install.mjs), [MCP server](../native/mcp.mjs). Chrome's [native-messaging documentation](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) describes the process and port lifetime.
