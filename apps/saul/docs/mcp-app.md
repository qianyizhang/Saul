# Saul MCP App

Saul's existing local MCP server also serves an interactive Tab board. The same Chrome native helper provides inventory and executes manual edits or approved proposals. The UI uses the standard MCP Apps bridge; it does not open a network listener, contact a model API or load remote scripts, icons or fonts.

## Open and use

1. Use the [root selective installer](../../../docs/setup.md) with the `tabs` component and actual extension ID. Add `--codex` only for a new Codex registration. Existing registrations are preserved by omitting that flag.
2. After an upgrade, fully quit and reopen Codex so its MCP connections load the new tools. Ask **“Open the Saul Tab board.”** Codex calls `saul_workspace_show`, which links the board resource. A compatible desktop host can expand it beside the conversation. A thread entrypoint is also declared; its availability depends on the host's local-server support.
3. **Tab board** shows all normal Chrome windows. Filter by title or hostname. Window cards fold and reorder locally.
4. Select tabs with checkboxes, Shift for a range, or Select all in a window. The action bar offers **Group**, **Move to**, and **Summarize**. Pins remain selectable for summaries, without implicit unpinning.
5. Manual drags and Group/Move act immediately and never deduplicate. Drag a group heading to move it intact; an individual tab can leave or join a group. Grouping across windows asks for an existing or new destination. **Undo** appears when the affected arrangement can still be restored.
6. **Summarize** opens a live reader in Chrome for the exact selection. It uses the shared two-worker summary runner and local SQLite persistence. Saved results live under History → Summaries. Source text and account credentials never pass through the board.
7. **Ask Codex → Send** sends the typed message directly. **Attach browser selection** optionally includes the session, revision and selected tab IDs; it starts unchecked. Tab inventory and page text use the existing scoped tools only when needed. If Codex proposes a reorganization, review its move and duplicate counts, adjust names or the duplicate-removal preference, then **Apply**. **Discard** dismisses it. Manual arrangement resumes after Apply or Discard.

### Manual controls

- **Drag feedback:** the floating card names the destination and marks insertion. Edge hover scrolls continuously; Escape cancels. A drop into a group changes membership; a drop at the window end detaches individual tabs.
- **Keyboard and touch:** checkboxes and Move to accompany dragging. Alt+Arrow reorders a focused tab. Group headings can be selected by keyboard for intact moves. Window menus support arrow keys and Escape; rename uses Enter to save and Escape to cancel.
- **Stable refresh:** surviving selections, card order, scroll positions and useful focus remain in place. Refresh waits for active drags and input interactions. Manual commands reject stale layouts and never retry uncertain failures.
- **Undo limits:** Undo checks affected window organization, ignoring page navigation and focus. Moving a source window's last tab may close it; that operation has no Undo because the original window identity cannot be restored.

Saul labels are shared by the extension Window view and the Codex board. On macOS Chrome the initial inventory imports native window names; elsewhere it includes saved Saul labels; applying a proposed name updates both surfaces. Labels live in trusted extension session storage, surviving service-worker and MCP reconnects within the current browser run. They are cleared with the browser session so recycled window IDs cannot inherit old names. Older helper-only labels in `workspace-labels.json` remain visible and are imported into extension state on the next reviewed Apply, then retired from that file.

On macOS Google Chrome, Saul reads and writes Chrome's native **Name Window** names through its AppleScript `given name` property. The helper targets the connected Chrome process by PID and checks each normal window's ID and complete tab-ID set before using it. Native names override cached Saul labels on inventory reads; import synchronizes extension metadata without renaming Chrome. Apply checks the expected native name, writes the reviewed name, then reads it back before reporting success. External native renames make previews stale. This path requires macOS Automation permission for the calling app; denied access and timeouts are visible and are never retried automatically. Other platforms retain shared Saul labels.

Chrome's [extension windows API](https://developer.chrome.com/docs/extensions/reference/api/windows) still exposes no native name field; the macOS bridge uses [Chromium's AppleScript interface](https://chromium.googlesource.com/chromium/src.git/+/lkgr/chrome/browser/ui/cocoa/applescript/scripting.sdef).

If the host cannot send messages from a widget, use the chat composer instead. If it does not render MCP Apps, inventory/proposal tools remain readable, but this workflow cannot be applied without a compatible app host. Never replace the review button with automatic individual tool mutations.

## Troubleshooting the Codex panel

**“Couldn’t display Saul” after upgrading:** run `pnpm verify:connection`. This starts a separate MCP process; success does not refresh a process already owned by a chat. Fully quit and reopen Codex, then reopen Saul. The panel's Try again button can reuse the same old connection. Chrome and the extension do not need reinstalling for this case.

On 2026-10-13, Codex desktop 26.1007.30912 (20156) displayed Saul in its menu while this existing chat still returned `Unknown tool: saul_workspace_show` and resource-read error `-32601 Method not found`. A fresh installed Saul process served all 15 tools and live inventory. An isolated fresh instance of Codex's bundled app-server also fetched `ui://saul/workspace-v1.html` successfully through `mcpServer/resource/read`. Together these identify a stale chat connection as the likely cause; they do not establish successful rendering after restart. The old Saul server lacks both the workspace tools and resource handler.

If Saul still fails after restart, inspect fresh desktop logs for the resource read and tool result separately. A completed tool transport can still contain an `isError` result. Do not infer successful UI delivery merely from tool discovery or “App tool call finished.” Keep browser titles, URLs, tokens and account identifiers out of diagnostic reports.

Keep a compact review bar with the duplicate count. Normal rows do not show
position numbers; show them for reviewed changes. Window cards fold and reorder
locally; keep success to one line. Route connection management to Settings.

## Codex proposal scope

- Every unpinned, ungrouped tab must appear exactly once in the proposal, with an explicit order and destination.
- Destinations can be existing windows or new windows. An existing destination must retain an original tab (including a pin/group) so it cannot disappear midway through a move.
- Pins and groups retain their original windows, group metadata and internal order. Movable tabs are placed after them. Manual actions support grouping and group movement through their separate interaction boundary.
- Reorganization removes exact HTTP(S) URL duplicates by default across the proposed workspace. Pins and grouped tabs always stay; otherwise an active copy is preferred, then the first proposed copy. Query strings and fragments are significant; other URL schemes are excluded. Every original movable tab is still assigned once in proposal inputs, including copies that the preview removes. Duplicates close only after reviewed moves complete, with a fresh URL and keeper check before each close. No tab is navigated. Chrome can automatically close an emptied source window.
- Incognito and non-normal windows remain excluded. Page-reading access is unnecessary.

## Proposal and approval lifetime

Plans live only in the MCP server's memory, one latest proposal per browser session, capped at 32 sessions. Approval expires after five minutes; the draft remains available for editing or **Retry**, which revalidates the layout and issues a new review token without changing Chrome. A server restart clears drafts and approvals. Changing window labels, the tab layout, URLs, pins or group metadata makes a pending or expired draft stale; focus, active-tab and tab-title changes alone do not.

Manual edits, Undo and opening summaries use a separate app-only interaction token, also returned only in result metadata and consumed before a command. Internal transport commands are excluded from MCP discovery and rejected by its dispatcher.

The model can create proposals. The apply tool is declared with `ui.visibility: ["app"]`; the host should expose it only to the app. Its single-use token is delivered in result `_meta`, separate from model-visible results, and checked on the server. This is a review boundary within a cooperating MCP host, not protection from other programs running as the same OS user with access to the native bridge.

Preview validation reads one fresh inventory; it does not repeat that read to assemble the response. Native window discovery batches IDs and modes; names are read once per scoped normal window with identity checks. The movement plan keeps a longest ordered subsequence in each window and moves only the remaining tabs; duplicate-only destinations are never created. Single-tab moves go directly to their reviewed insertion index.

The server consumes approval before the first mutation. It validates the starting layout and checks the expected state before and after every move, duplicate closure and label update. Chrome does not offer an atomic multi-window transaction: user actions can race a move, and a failed call may already have changed Chrome. On failure, the UI reports completed moves and refreshes the inventory if possible. It never retries or rolls back automatically. Make a new proposal from the current state.

The board refreshes every ten seconds while visible, pausing during a drag, an open context menu, or proposal/group input. Manual refresh revalidates the preview. Refresh and rendering are read-only. Applying a Codex proposal requires the review button; sending a request to Codex does not authorize application. Tab inventories, URLs, plans and tokens remain in memory. The MCP host can retain tool results in conversation history.

## Implementation and verification

Window and Tab board use [direct interaction](../src/native/interaction.ts) for
manual mutations and Undo under the extension's mutation lock; Undo validates
only affected windows. [Window labels](../src/native/window-labels.ts) live in
trusted session storage. On macOS Chrome the [name adapter](../native/window-names.mts)
targets the connected PID, reads AppleScript `givenName`, validates the affected
IDs and expected name, then reads back a rename. Legacy helper-only labels are
imported on reviewed Apply. `saul_workspace_*` names remain wire identifiers,
not names for the extension workspace or history operations.

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

The native build bundles the pinned MCP Apps SDK in self-contained HTML.
Each server freezes its hash-addressed resource at startup. Only
`saul_workspace_show` opens the board; proposal tools update it by notification.
The adapter registers notifications before initialization, gates actions by
host capability and stops polls/local requests on teardown. It keeps visible
drafts and reports uncertain delivery without resend. The SDK owns request IDs.

`pnpm verify:connection` reads the installed catalog, advertised HTML and live
inventory, without comparing against checkout HTML. The SDK test host loads the
delivered HTML under CSP in an opaque frame, exercises app tools, timeout,
teardown and real tab changes. Group creation uses buttons/keyboard without
HTML form submission. Denied local storage yields a visible preference error.
This does not prove rendering in the active desktop panel.

See [dated timing evidence](testing.md#tab-board-timing--2026-10-19).

References: [OpenAI MCP App UI](https://developers.openai.com/plugins/build/chatgpt-ui), [conversation panels](https://developers.openai.com/plugins/build/extensions), [MCP Apps standard](https://modelcontextprotocol.io/extensions/apps/overview).

## Standalone board and shared diagnostics

Run `pnpm board` from `apps/saul` to open the same board through a loopback HTTP
server. Open the URL printed by the command; its fragment holds a per-process
access token. The server accepts API calls only from its own origin with that
token. Closing the command stops the server. A connected Saul tab helper is
still required for Chrome operations; Codex is not. The installed equivalent is
`node ~/.saul/bridge/board-web.mjs` (the installation's Node executable must be
available). Standalone uses **Copy message**, preserving the draft and making no
conversation request. Its direct tab edits and reviewed Apply call the same
workspace service as MCP.

**App info (ⓘ)** remains available in both modes. Info identifies the build by
its content-addressed resource URI, the connection, log path and recording health.
Tools comes from the actual MCP registration list. Conversation flow contains
labelled plain-message and selected-context fixtures; they execute nothing.
Interactions exposes frozen application-boundary requests, responses and errors.
**Inspect send** selects the last send; inventory refresh does not erase its
status. Accepted by host is not proof of arrival or an assistant reply.

The native board service is the sole diagnostic file writer. By default it uses
`${XDG_STATE_HOME:-~/.local/state}/mcp-apps/saul-tab-board/<instance>/`;
`MCP_APP_LOG_ROOT` overrides the directory above the app name. Automatic
`app.jsonl` and `server.jsonl` contain metadata only. Payloads remain in bounded
live memory and may be lost on close/restart. Known credentials, including board
approval and interaction tokens, are masked; each payload is capped at 64 KiB.
App-origin reports remain untrusted app observations, with separate IDs from
server operations. Inspection never repeats the action or enters chat context.

**Save diagnostic capture** persists only the selected interaction's retained
masked observations. Captures are limited to 8 per server session and 2 MiB each.
Metadata rotates at 2 MiB per source, keeping one previous file. On startup, the
service prunes recognized inactive sessions older than 7 days or beyond the latest
8; live processes, symlinks and unknown directories are excluded. Info discloses
this policy and write failures. Diagnostic read/write operations are app-only;
visibility is not authentication. Browser requests also pass the loopback token
and origin gates. HTTP and MCP call the same validated diagnostic definitions.
