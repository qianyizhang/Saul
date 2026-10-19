# Saul MCP App

Saul's existing local MCP server also serves an interactive window-and-tab board. The same Chrome native helper provides the inventory and executes reviewed moves. The UI uses the standard MCP Apps bridge; it does not open a network listener, contact a model API or load remote scripts, icons or fonts.

## Open and use

1. Run the [setup wizard](setup.md), or upgrade an existing installation with `node scripts/setup.mjs --skip-build --extension-id ACTUAL_ID` after building the intended extension source.
2. After an upgrade, fully quit and reopen Codex so its MCP connections load the new tools. Ask **“Open the Saul workspace.”** Codex calls `saul_workspace_show`, which links the board resource. A compatible desktop host can expand it beside the conversation. A thread entrypoint is also declared; its availability depends on the host's local-server support.
3. The board shows one editable layout. Window colors and numbers identify destinations; tab badges keep their original window and position (for example, **2.4**) until Apply. Filter by title or domain.
4. Drag tab rows to rearrange them, including onto folded window headers or **New window**. Click a tab number for keyboard/touch moves. Click a window number to fold it; drag its header to reorder cards locally. **Rename** stages a label change.
5. Expand **Ask Codex**, write a request and click **Send**. Right-click a tab or window for contextual moves and prompt actions. Prompt actions fill an editable draft; they do not send until you click Send.
6. Review the compact change bar: it counts required tab moves, excluding neighbours that merely shift index, and lists duplicate closures separately. **Details** lists removed copies and offers **Remove duplicate tabs**; clear it to keep copies. **Reset** restores the current Chrome layout. **Apply** executes the reviewed proposal and shows a one-line receipt. Failures retain their explanation. The host currently returns a final receipt, not incremental movement counts.

### Manual controls

- **Drag feedback:** the floating card names the destination and the insertion gap marks the slot. Use the upper or lower half of a row to place before or after it. Hover at an edge to keep scrolling; Escape cancels.
- **Keyboard and touch:** click a tab number for move controls; Escape restores focus. Rows scroll normally on touch screens. Window headers support Enter or Shift+F10 for actions, including board ordering. Menus support arrow keys and Escape. Rename uses Enter to save and Escape to cancel.
- **Continuous editing:** moves stay available while the host validates a preview. Apply waits for the latest validation. Unchanged cards stay attached, scroll positions persist, and row feedback respects reduced-motion settings. Refresh results wait until a drag ends.
- **Complete previews:** filtering keeps hidden tabs in the plan. Returning both the layout and labels to their current state clears the proposal.

Saul labels are shared by the extension Tabs window pickers and the Codex board. On macOS Chrome the initial inventory imports native window names; elsewhere it includes saved Saul labels; applying a proposed name updates both surfaces. Labels live in trusted extension session storage, surviving service-worker and MCP reconnects within the current browser run. They are cleared with the browser session so recycled window IDs cannot inherit old names. Older helper-only labels in `workspace-labels.json` remain visible and are imported into extension state on the next reviewed Apply, then retired from that file.

On macOS Google Chrome, Saul reads and writes Chrome's native **Name Window** names through its AppleScript `given name` property. The helper targets the connected Chrome process by PID and checks each normal window's ID and complete tab-ID set before using it. Native names override cached Saul labels on inventory reads; import synchronizes extension metadata without renaming Chrome. Apply checks the expected native name, writes the reviewed name, then reads it back before reporting success. External native renames make previews stale. This path requires macOS Automation permission for the calling app; denied access and timeouts are visible and are never retried automatically. Other platforms retain shared Saul labels.

Chrome's [extension windows API](https://developer.chrome.com/docs/extensions/reference/api/windows) still exposes no native name field; the macOS bridge uses [Chromium's AppleScript interface](https://chromium.googlesource.com/chromium/src.git/+/lkgr/chrome/browser/ui/cocoa/applescript/scripting.sdef).

If the host cannot send messages from a widget, use the chat composer instead. If it does not render MCP Apps, inventory/proposal tools remain readable, but this workflow cannot be applied without a compatible app host. Never replace the review button with automatic individual tool mutations.

## Troubleshooting the Codex panel

**“Couldn’t display Saul” after upgrading:** run `node scripts/setup.mjs --verify`. This starts a separate MCP process; success does not refresh a process already owned by a chat. Fully quit and reopen Codex, then reopen Saul. The panel's Try again button can reuse the same old connection. Chrome and the extension do not need reinstalling for this case.

On 2026-10-13, Codex desktop 26.1007.30912 (20156) displayed Saul in its menu while this existing chat still returned `Unknown tool: saul_workspace_show` and resource-read error `-32601 Method not found`. A fresh installed Saul process served all 15 tools and live inventory. An isolated fresh instance of Codex's bundled app-server also fetched `ui://saul/workspace-v1.html` successfully through `mcpServer/resource/read`. Together these identify a stale chat connection as the likely cause; they do not establish successful rendering after restart. The old Saul server lacks both the workspace tools and resource handler.

If Saul still fails after restart, inspect fresh desktop logs for the resource read and tool result separately. A completed tool transport can still contain an `isError` result. Do not infer successful UI delivery merely from tool discovery or “App tool call finished.” Keep browser titles, URLs, tokens and account identifiers out of diagnostic reports.

## First-version scope

- Every unpinned, ungrouped tab must appear exactly once in the proposal, with an explicit order and destination.
- Destinations can be existing windows or new windows. An existing destination must retain an original tab (including a pin/group) so it cannot disappear midway through a move.
- Pins and groups retain their original windows, group metadata and internal order. Movable tabs are placed after them. Group creation, ungrouping and moving whole groups are outside this app's first version; the separate browser tools still support their existing operations.
- Reorganization removes exact HTTP(S) URL duplicates by default across the proposed workspace. Pins and grouped tabs always stay; otherwise an active copy is preferred, then the first proposed copy. Query strings and fragments are significant; other URL schemes are excluded. Every original movable tab is still assigned once in proposal inputs, including copies that the preview removes. Duplicates close only after reviewed moves complete, with a fresh URL and keeper check before each close. No tab is navigated. Chrome can automatically close an emptied source window.
- Incognito and non-normal windows remain excluded. Page-reading access is unnecessary.

## Proposal and approval lifetime

Plans live only in the MCP server's memory, one latest proposal per browser session, capped at 32 sessions. Approval expires after five minutes; the draft remains available for editing or **Retry**, which revalidates the layout and issues a new review token without changing Chrome. A server restart clears drafts and approvals. Changing window labels, the tab layout, URLs, pins or group metadata makes a pending or expired draft stale; focus, active-tab and tab-title changes alone do not.

The model can create proposals. The apply tool is declared with `ui.visibility: ["app"]`; the host should expose it only to the app. Its single-use token is delivered in result `_meta`, separate from model-visible results, and checked on the server. This is a review boundary within a cooperating MCP host, not protection from other programs running as the same OS user with access to the native bridge.

Preview validation reads one fresh inventory; it does not repeat that read to assemble the response. Native window discovery batches IDs and modes; names are read once per scoped normal window with identity checks. The movement plan keeps a longest ordered subsequence in each window and moves only the remaining tabs; duplicate-only destinations are never created. Single-tab moves go directly to their reviewed insertion index.

The server consumes approval before the first mutation. It validates the starting layout and checks the expected state before and after every move, duplicate closure and label update. Chrome does not offer an atomic multi-window transaction: user actions can race a move, and a failed call may already have changed Chrome. On failure, the UI reports completed moves and refreshes the inventory if possible. It never retries or rolls back automatically. Make a new proposal from the current state.

The board refreshes every ten seconds while visible, pausing during a drag or while move controls are in use. Manual refresh revalidates the preview. Refresh and rendering are read-only. Applying requires the review button; sending a request to Codex does not authorize application. Reviewed window labels are kept in extension session storage; tab inventories, URLs, plans and tokens remain in memory. The MCP host can retain tool results in conversation history.

## Implementation and verification

| File                                         | Responsibility                                                       |
| -------------------------------------------- | -------------------------------------------------------------------- |
| [App protocol](../native/app-protocol.mjs)   | Shared MCP-only schemas, visibility and resource metadata            |
| [Workspace service](../native/workspace.mjs) | Validation, projection, expiring approvals and verified execution    |
| [MCP server](../native/mcp.mjs)              | Resource delivery and serialized tool dispatch                       |
| [UI](../native/ui/workspace.js)              | Standard initialization, results, tool calls and user messages       |
| [Native installer](../native/install.mjs)    | Copies app code and self-contained UI into the existing installation |

`node scripts/setup.mjs --verify` checks the installed tool catalog, HTML resource and live tab inventory. Unit tests cover proposal validation, stale/expired/replaced approvals and partial failures. The disposable-browser test renders the real app in a test MCP host, exercises drag-and-drop, keyboard moves, filtering, pins/groups, stale previews and its message bridge, and applies a plan against real Chromium tabs. This does not by itself establish rendering in the installed Codex desktop host.

Validation timing on 2026-10-19: three isolated dry-run samples per version against
175 live tabs in eight windows, with native names available in every sample.
Commit `6e43593` took 2543/2545/2530 ms; the optimized path took 576/570/583 ms
(77% lower median). The same single-tab move reported 29 index changes before and
one required move after. These measurements exclude Codex UI transport time and
never applied a layout or replaced the live app's draft.

References: [OpenAI MCP App UI](https://developers.openai.com/plugins/build/chatgpt-ui), [conversation panels](https://developers.openai.com/plugins/build/extensions), [MCP Apps standard](https://modelcontextprotocol.io/extensions/apps/overview).
