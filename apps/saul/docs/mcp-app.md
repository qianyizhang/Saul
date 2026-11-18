# Saul MCP App

- **Goal** — Arrange Chrome tabs alongside a Codex conversation, with explicit review before applying a proposal.
- **Runtime** — The local MCP server serves a self-contained Tab board through the MCP Apps bridge. The Chrome helper supplies inventory and edits. No remote assets or model calls from the board.

## Open and use

| Goal                   | Outcome                                                                                                                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open a connected board | [Register and verify Saul](native-messaging.md#register-with-codex). Ask **Open the Saul Tab board**. `saul_workspace_show` supplies the resource. A compatible desktop host can open the panel or thread entry point. |
| Find tabs              | Filter connected normal windows by title or hostname. Fold and reorder cards locally. [Shared window controls](product.md#window-and-tab-board)                                                                        |
| Summarize a selection  | Open the Chrome reader for the exact selection. The [Call runner](calls.md#runtime-owners) owns scheduling and persistence. Source text and credentials stay outside the board.                                        |
| Ask Codex for a plan   | **Ask Codex → Send** sends the draft. **Attach browser selection** is off by default and adds session, revision and selected tab IDs. Inventory and page text use separately scoped tools.                             |
| Approve or dismiss     | Review moves and duplicate counts, adjust names or duplicate removal, then **Apply** or **Discard**. Manual arrangement resumes after dismissal or application.                                                        |
| Use a limited host     | If widget sending is unavailable, use the chat composer. If app rendering is unavailable, inventory and proposals remain readable. Apply requires the compatible review surface.                                       |

### Manual controls

- **Drag and focus** — Floating feedback shows destination and insertion. Edge hover scrolls. Escape cancels. Use Move to and checkboxes by keyboard or touch. Alt+Arrow reorders a focused tab. Menus support arrows/Escape. Rename accepts Enter/Escape.
- **Refresh and Undo** — Preserve useful focus, scroll, card order and surviving selections. Wait during drags and input interactions. Refresh stale layouts before manual edits. Undo ignores page navigation and focus. [Shared manual rules](product.md#window-and-tab-board)
- **Window labels** — Extension session storage shares labels with Window and survives worker/MCP reconnects within a browser run. Restart clears labels so recycled IDs stay clean. Reviewed Apply imports and retires older helper-only `workspace-labels.json` labels.
- **macOS Chrome names** — Native names override saved labels on inventory reads. The AppleScript adapter checks connected PID, window ID, complete tab-ID set and expected name, then reads back a reviewed rename. External renames stale the proposal. Automation denial and timeout stay visible without automatic retry. Other platforms use Saul labels. [Chrome windows API](https://developer.chrome.com/docs/extensions/reference/api/windows), [Chromium scripting interface](https://chromium.googlesource.com/chromium/src.git/+/lkgr/chrome/browser/ui/cocoa/applescript/scripting.sdef)

## Troubleshooting the Codex panel

| Symptom                               | Evidence or recovery                                                                                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Couldn’t display Saul after upgrading | [Verify connection](native-messaging.md#connect-and-verify), then fully quit/reopen Codex. Try again can reuse the stale connection.                                                                         |
| Still fails after restart             | Inspect the resource read and the tool result separately. A tool result can carry `isError` after successful transport. Keep browser titles, URLs, tokens and account identifiers out of diagnostic reports. |

- **Recorded case · 2026-10-13** — Codex desktop 26.1007.30912 (20156) showed Saul while the existing chat returned `Unknown tool: saul_workspace_show` and resource error `-32601 Method not found`. A fresh server exposed all 15 tools and live inventory. A fresh bundled app-server fetched `ui://saul/workspace-v1.html`. Stale chat connection was the likely cause. Rendering after restart was unverified.

## Codex proposal scope

- Every unpinned, ungrouped tab must appear exactly once in the proposal, with an explicit order and destination.
- Destinations can be existing windows or new windows. An existing destination must retain an original tab (including a pin/group) so it cannot disappear midway through a move.
- Pins and groups retain their original windows, group metadata and internal order. Movable tabs are placed after them. Manual actions support grouping and group movement through their separate interaction boundary.
- **Duplicate matching** — Exact HTTP(S) URLs across the proposed workspace, including query and fragment. Removal is on by default. Pins and groups stay. Prefer an active copy, then the first proposed copy.
- **Duplicate closure** — Assign even redundant copies in the proposal. Close only after reviewed moves complete and a fresh URL and keeper check passes. Tab URLs stay intact. Chrome can close an emptied source window.
- Incognito and non-normal windows remain excluded. Page-reading access is unnecessary.

## Proposal and approval lifetime

| Boundary         | Outcome                                                                                                                                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Draft and expiry | Latest draft per session in MCP memory, capped at 32 sessions. Approval expires after five minutes. Edit or **Retry** to revalidate and issue a new token without changing Chrome. Server restart clears drafts and approvals.                              |
| Stale proposal   | Changed window labels, layout, URLs, pins or group metadata invalidate the draft. Focus, active tab and tab titles do not.                                                                                                                                  |
| Approval         | Model creates proposals. Apply is app-only. The server checks the single-use token returned in result `_meta` and consumes it before mutation. Other programs under the same OS user can access the enabled native bridge.                                  |
| Manual edits     | Edits, Undo and summary opening use a separate app-only interaction token consumed before the command. The MCP dispatcher rejects internal transport commands.                                                                                              |
| Plan and execute | Preview uses one fresh inventory. Native discovery batches IDs and modes and checks each scoped window identity. A longest ordered subsequence stays in place. Single-tab moves go directly to the reviewed index. Duplicate-only destinations are skipped. |
| Partial failure  | Check expected state before and after each move, close or rename. Report completed moves and refresh if possible. Create a fresh proposal after partial effects. No automatic retry or rollback.                                                            |
| Refresh          | Every ten seconds while visible. Pause during drag, menus or proposal/group input. Manual refresh revalidates the preview. A lost browser session clears its preview and approval. Refresh and chat sends leave Chrome unchanged.                           |
| Retention        | Inventories, URLs, plans and tokens stay in memory. The MCP host can retain tool results in conversation history.                                                                                                                                           |

## Implementation and verification

- **Shared editing** — [Direct interaction](../src/native/interaction.ts) owns manual mutations and affected-window Undo under the extension mutation lock.
- **Names** — [Extension label storage](../src/native/window-labels.ts) and [native adapter](../native/window-names.mts). [Label behavior](#manual-controls)
- **Wire names** — `saul_workspace_*` identifies the MCP interface. Window and History keep their product names.

| File                                                | Responsibility                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| [App protocol](../shared/protocol/app-protocol.mts) | Shared MCP-only schemas, visibility and resource metadata                 |
| [Workspace service](../native/workspace.mts)        | Validation, projection, expiring approvals and verified execution         |
| [MCP server](../native/mcp.mts)                     | Resource delivery and serialized tool dispatch                            |
| [Board session](../board/board-session.ts)          | Session identity, refresh, draft proposals, approval and incoming results |
| [UI](../board/workspace.ts)                         | Board rendering, focus, selection and gestures                            |
| [Host adapter](../board/host-adapter.ts)            | SDK lifecycle, capability checks, calls, messages and teardown            |
| [Board resource](../native/board-resource.mts)      | Process-frozen HTML and content-derived resource identity                 |
| [Native installer](../native/installation/cli.mts)  | Stages and activates a complete immutable helper generation               |

- **Delivery** — Native build bundles the pinned MCP Apps SDK. Each server freezes the hash-addressed resource. `saul_workspace_show` opens it. Proposal tools update it by notification.
- **Host lifecycle** — Register notifications before initialization, gate actions by host capability and end polls and local requests at teardown. The SDK owns request IDs. Keep drafts and report uncertain delivery without resend.
- **Acceptance** — [Read-only connection check](native-messaging.md#connect-and-verify), [isolated Chrome test host](testing.md#test-layers), [dated timing](testing.md#tab-board-timing--2026-10-19). Test host covers CSP, tools, timeout, teardown, keyboard group creation and real tab changes. Denied local storage produces a preference error. Verify installed panel rendering separately.
- **References** — [MCP App UI](https://developers.openai.com/plugins/build/chatgpt-ui), [conversation panels](https://developers.openai.com/plugins/build/extensions), [MCP Apps standard](https://modelcontextprotocol.io/extensions/apps/overview).

## Standalone board and shared diagnostics

| Goal                         | Outcome                                                                                                                                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open the board without Codex | Run `pnpm board` in `apps/saul` or launch `~/.saul/bridge/board-web.mjs` with the installed Node executable. Open the printed URL. Chrome operations still require the tab helper.                                                                                                          |
| Verify standalone access     | The loopback server accepts its own origin and per-process token from the URL fragment. Close the command to stop the server.                                                                                                                                                               |
| Edit or copy a draft         | **Copy message** preserves the draft without sending it. Direct edits and reviewed Apply use the same workspace service as MCP.                                                                                                                                                             |
| Inspect app or send state    | **App info (ⓘ)** shows content-addressed build URI, connection, log path and recording health. **Tools** reflects registration. Conversation fixtures are inert. **Inspect send** stays selected across inventory refresh. Host acceptance establishes neither message arrival nor a reply. |
| Inspect interaction evidence | Read frozen boundary requests, replies and errors. Inspection leaves browser actions and chat context unchanged. IDs distinguish untrusted app observations from server operations.                                                                                                         |

- **Owner and path** — Native board service is the sole writer. Default `${XDG_STATE_HOME:-~/.local/state}/mcp-apps/saul-tab-board/<instance>/`. `MCP_APP_LOG_ROOT` overrides the directory above the app name.
- **Depth and privacy** — `app.jsonl` and `server.jsonl` record metadata only. Bounded live payloads can be lost on restart. Known credentials and approval/interaction tokens are masked. Each payload is capped at 64 KiB.
- **Capture and retention** — **Save diagnostic capture** saves the selected masked interaction. Up to eight captures per session, 2 MiB each. Metadata rotates at 2 MiB per source with one previous file. Startup prunes recognized inactive sessions older than seven days or beyond the latest eight. Live processes, symlinks and unknown directories stay intact. Info reports policy and write errors.
- **Access** — Diagnostic read/write is app-only. Visibility and authentication are separate. Loopback calls also require origin and token checks. HTTP and MCP use the same validated operations.
