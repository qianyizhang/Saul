# Saul MCP App

Saul's existing local MCP server also serves an interactive window-and-tab board. The same Chrome native helper provides the inventory and executes reviewed moves. The UI uses the standard MCP Apps bridge; it does not open a network listener, contact a model API or load remote scripts, icons or fonts.

## Open and use

1. Run the [setup wizard](setup.md), or upgrade an existing installation with `node scripts/setup.mjs --skip-build --extension-id ACTUAL_ID` after building the intended extension source.
2. After an upgrade, fully quit and reopen Codex so its MCP connections load the new tools. Ask **“Open the Saul workspace.”** Codex calls `saul_workspace_show`, which links the board resource. A compatible desktop host can expand it beside the conversation. A thread entrypoint is also declared; its availability depends on the host's local-server support.
3. The board opens directly to your windows. The browser-session picker appears only when a choice is needed; Current/Proposed appears once a proposal exists. Inspect window cards, group/pin badges and tab titles/domains. Use the filter to find tabs.
4. Drag unpinned, ungrouped tabs between rows, onto a window's footer, or onto **New window**. Each drop updates the preview immediately. Keep arranging in **Proposed**, then review before applying. Click a tab's grip for keyboard controls, or **Rename** to edit a window label.
5. For a Codex-generated layout, expand **Plan with Codex**, enter an organization request and click **Ask Codex for a plan**. This sends your request into the current chat and collapses the form. Codex reads the fresh inventory and stages a proposal; no Chrome mutation occurs.
6. Compare **Current** and **Proposed**. The review bar shows the affected-tab count; expand **Plan details** for the summary. Click **Apply changes to Chrome** to execute that exact proposal. The app refreshes and reports success or partial failure. Reviewed labels are saved after successful apply for both existing and newly created windows, and remain visible in **Current** after refresh or MCP reconnection.

### Manual controls

- **Drag feedback:** the floating card names the destination and the insertion gap marks the slot. Use the upper or lower half of a row to place before or after it. Hover at an edge to keep scrolling; Escape cancels.
- **Keyboard and touch:** click the grip for move controls; Escape closes them and restores focus. On touch screens, scroll using the row and drag using the grip. Rename uses Enter to save and Escape to cancel.
- **Continuous editing:** moves stay available while the host validates a preview. Apply waits for the latest validation. Unchanged cards stay attached, scroll positions persist, and reorder motion respects reduced-motion settings. Refresh results wait until a drag ends.
- **Complete previews:** filtering keeps hidden tabs in the plan. Returning both the layout and labels to their current state clears the proposal.

Chrome's [public windows API](https://developer.chrome.com/docs/extensions/reference/api/windows) exposes no native window-name field. Saul labels therefore do not synchronize with Chrome's **Name Window** menu. Labels are scoped to the connected browser session and window IDs; they survive an MCP server restart while that browser session remains connected, but do not follow restored windows after a browser/bridge restart. They are stored locally with owner-only permissions in `workspace-labels.json` under the bridge runtime directory. Disconnected sessions are pruned on the next label save.

If the host cannot send messages from a widget, use the chat composer instead. If it does not render MCP Apps, inventory/proposal tools remain readable, but this workflow cannot be applied without a compatible app host. Never replace the review button with automatic individual tool mutations.

## Troubleshooting the Codex panel

**“Couldn’t display Saul” after upgrading:** run `node scripts/setup.mjs --verify`. This starts a separate MCP process; success does not refresh a process already owned by a chat. Fully quit and reopen Codex, then reopen Saul. The panel's Try again button can reuse the same old connection. Chrome and the extension do not need reinstalling for this case.

On 2026-10-13, Codex desktop 26.1007.30912 (20156) displayed Saul in its menu while this existing chat still returned `Unknown tool: saul_workspace_show` and resource-read error `-32601 Method not found`. A fresh installed Saul process served all 15 tools and live inventory. An isolated fresh instance of Codex's bundled app-server also fetched `ui://saul/workspace-v1.html` successfully through `mcpServer/resource/read`. Together these identify a stale chat connection as the likely cause; they do not establish successful rendering after restart. The old Saul server lacks both the workspace tools and resource handler.

If Saul still fails after restart, inspect fresh desktop logs for the resource read and tool result separately. A completed tool transport can still contain an `isError` result. Do not infer successful UI delivery merely from tool discovery or “App tool call finished.” Keep browser titles, URLs, tokens and account identifiers out of diagnostic reports.

## First-version scope

- Every unpinned, ungrouped tab must appear exactly once in the proposal, with an explicit order and destination.
- Destinations can be existing windows or new windows. An existing destination must retain an original tab (including a pin/group) so it cannot disappear midway through a move.
- Pins and groups retain their original windows, group metadata and internal order. Movable tabs are placed after them. Group creation, ungrouping and moving whole groups are outside this app's first version; the separate browser tools still support their existing operations.
- No tab is closed or navigated. Chrome can automatically close an emptied source window.
- Incognito and non-normal windows remain excluded. Page-reading access is unnecessary.

## Proposal and approval lifetime

Plans live only in the MCP server's memory, one latest proposal per browser session, capped at 32 sessions. Approval expires after five minutes; the draft remains available for editing or **Renew preview**, which revalidates the layout and issues a new review token without changing Chrome. A server restart clears drafts and approvals. Changing the tab layout, URLs, pins or group metadata makes a pending or expired draft stale; focus, active-tab and tab-title changes alone do not.

The model can create proposals. The apply tool is declared with `ui.visibility: ["app"]`; the host should expose it only to the app. Its single-use token is delivered in result `_meta`, separate from model-visible results, and checked on the server. This is a review boundary within a cooperating MCP host, not protection from other programs running as the same OS user with access to the native bridge.

The server consumes approval before the first mutation. It validates the starting layout and checks the expected state before and after every move. Chrome does not offer an atomic multi-window transaction: user actions can race a move, and a failed call may already have changed Chrome. On failure, the UI reports completed moves and refreshes the inventory if possible. It never retries or rolls back automatically. Make a new proposal from the current state.

The board refreshes every ten seconds while visible, pausing during a drag or while move controls are in use. Manual refresh revalidates the preview. Refresh and rendering are read-only. Applying requires the review button; sending a request to Codex does not authorize application. Only reviewed window labels are stored on disk; tab inventories, URLs, plans and tokens remain in memory. The MCP host can retain tool results in conversation history.

## Implementation and verification

| File                                         | Responsibility                                                       |
| -------------------------------------------- | -------------------------------------------------------------------- |
| [App protocol](../native/app-protocol.mjs)   | Shared MCP-only schemas, visibility and resource metadata            |
| [Workspace service](../native/workspace.mjs) | Validation, projection, expiring approvals and verified execution    |
| [MCP server](../native/mcp.mjs)              | Resource delivery and serialized tool dispatch                       |
| [UI](../native/ui/workspace.js)              | Standard initialization, results, tool calls and user messages       |
| [Native installer](../native/install.mjs)    | Copies app code and self-contained UI into the existing installation |

`node scripts/setup.mjs --verify` checks the installed tool catalog, HTML resource and live tab inventory. Unit tests cover proposal validation, stale/expired/replaced approvals and partial failures. The disposable-browser test renders the real app in a test MCP host, exercises drag-and-drop, keyboard moves, filtering, pins/groups, stale previews and its message bridge, and applies a plan against real Chromium tabs. This does not by itself establish rendering in the installed Codex desktop host.

References: [OpenAI MCP App UI](https://developers.openai.com/plugins/build/chatgpt-ui), [conversation panels](https://developers.openai.com/plugins/build/extensions), [MCP Apps standard](https://modelcontextprotocol.io/extensions/apps/overview).
