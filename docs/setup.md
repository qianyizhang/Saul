# Set up Saul on another computer

The checkout includes the extension, native helper, MCP server, installer and verification code. Clone or pull the latest source before installing. macOS and Linux are supported by the installer; Google Chrome on macOS is the live-verified target. Windows is unsupported.

## One-command wizard

Prerequisites: Node **24**, pnpm **11.0.3** (the `packageManager` in `package.json`), Google Chrome, and the Codex CLI available as `codex`. Run from the Saul checkout:

```sh
node scripts/setup.mjs
```

The wizard:

1. Checks prerequisites and refuses to replace an unrelated `saul-tabs` registration.
2. Installs locked dependencies and builds the extension.
3. Prints the exact extension folder. Load it at `chrome://extensions` using **Developer mode → Load unpacked**, or reload the existing Saul extension. Paste its displayed ID into the terminal prompt.
4. Installs the native helper and registers MCP with Codex using absolute paths. Existing matching Codex registration settings are preserved.
5. Prompts you to enable **Saul → Tabs → Codex tab access**, choose **Reconnect**, and optionally enable **Page reading and actions**.
6. Verifies MCP initialization, the expected tools, browser sessions and an actual tab inventory. It prints counts/timing, never tab titles, URLs or page text.

Start a fresh Codex chat to load the registered tools. The verification proves tab connectivity; it does not exercise page actions or establish that every web page allows access.

Only the extension load/reload, extension-ID entry and access switches require Chrome interaction. The wizard does not edit personal Chrome profiles, install system prerequisites, enable access silently, use sudo, or add a login/startup service. Chrome must be running for the final connection check. Installing files is not the same as starting the helper.

If you already know the extension ID:

```sh
node scripts/setup.mjs --extension-id YOUR_EXTENSION_ID
```

In a terminal, this still waits for you to finish the Chrome steps before verification. For unattended agent execution, redirect stdin from `/dev/null`; the command then verifies immediately and returns exit 2 if Chrome still needs attention.

For a read-only check later:

```sh
node scripts/setup.mjs --verify
```

`--dry-run` prints the plan without launching commands or writing files. `--prepare` installs dependencies and builds only. `--skip-build` reuses the existing bundle; use it only after preparing the intended source. Advanced `--install-dir` and `--manifest-dir` options are forwarded to the native installer. `--verify --extension-id ID` limits the inventory check to that extension's sessions.

Exit **0** means the requested operation completed (ready, prepared, or dry-run); **2** means Chrome/user action remains; **1** means an error. A valid MCP handshake with no connected browser is reported as waiting, never ready. After a partial failure, the installer/registration may already exist; rerunning preserves matching registration and is supported. A rebuilt extension must still be reloaded in Chrome, and a running helper must reconnect to load updated files.

## Agent installation instructions

Give an agent this request:

> Set up Saul from this checkout by following docs/setup.md, including its agent instructions. Install/register the local tab bridge and verify tab connectivity. Use the actual extension ID. Leave page access off unless I request it.

For an agent with shell and Chrome UI access:

1. Read the checkout's `AGENTS.md`. Inspect dirty paths and preserve other work. Confirm Node 24, pinned pnpm, Codex CLI and supported OS. Honor the user's existing installation/access authorization; explain any missing prerequisites rather than silently installing system software.
2. Run `node scripts/setup.mjs --prepare`. This does not launch Chrome. If preparation fails, inspect the first error before proceeding.
3. In the user's intended Chrome profile, open `chrome://extensions`. Reload Saul if its source folder matches the printed build folder; otherwise load that folder unpacked. Read the extension's actual ID from the UI. Do not guess an ID or modify Chrome's profile files to install/enable an extension.
4. Run `node scripts/setup.mjs --skip-build --extension-id ACTUAL_ID`. This installs the helper and registers MCP. Exit 2 is expected if access is not yet enabled. Request scoped filesystem/configuration execution approval if required by the environment.
5. Open **Saul → Tabs**. Enable **Codex tab access** within the authorized scope, then click **Reconnect**. Enable **Page reading and actions** only when the user has authorized that broader access. Verify that the UI says **Connected to native host**.
6. Run `node scripts/setup.mjs --verify --extension-id ACTUAL_ID`. Socket access may require scoped execution approval. Report tool count, tab/window counts, and any unresolved failure. Do not use real-tab mutations as a setup test.
7. Tell the user to start a fresh Codex chat. Report completion only after the live inventory succeeds. If browser UI control is unavailable, give the exact remaining load/toggle steps and report setup as pending.

Browser-launching tests still require the repository's [disposable-profile testing workflow](testing.md). Setup verification uses the explicitly authorized installed bridge; it does not launch an automation browser or reuse a personal profile as a test fixture.

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
