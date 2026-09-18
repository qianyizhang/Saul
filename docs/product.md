# Reading and tabs

Saul has three primary views: Reading, Tabs, and Settings. The popup provides quick access; **Open full workspace** opens a normal extension tab with room for the library and tab organizer.

## Reading

Select webpage text and click **Explain**, or press **Alt+Shift+E**. The explanation streams into an anchored card. Stop keeps the partial text visible without marking it as a saved result. Completed explanations save automatically; a storage error remains visible alongside the generated text.

Pin keeps the card open while interacting with the page. The card follows scrolling and stays inside the viewport. Escape or Close dismisses it. Hover, focus, or click an annotated term to read its note. Copy reports clipboard failures instead of claiming success.

**Simpler**, **Give an example**, and **Go deeper** retain the original selection and extracted context, and include the previous explanation in the follow-up prompt. Each completion creates a run; the library shows the latest run for that selection. Bookmark a completed explanation from its card or from history. Bookmarks belong to the selection and survive regeneration.

The library supports bookmarks, pagination, source links, and search across selected text, readable explanations, concept notes, page titles, and URLs. Empty history, no matches, and storage failures have separate states. Export includes all saved selections (not just the current page/filter), with readable concept notes. History and bookmarks refresh when returning to the workspace.

SQLite runs in a dedicated worker with persistent local storage. Existing records are retained. The readable explanation search index is backfilled from saved responses; the obsolete raw-markup index is removed. Export currently includes each selection's latest explanation, not every historical run.

## Tabs and Codex

The Tabs view works directly in the extension, without the native host. It can preview and apply sorts, new/existing groups, ungrouping, moves, and group name/color updates. Pinned tabs are protected, groups stay intact during sorting, and moves require ungrouped tabs. The preview includes the affected tab titles and proposed order/details.

Before applying, Saul compares the preview with current tab organization and rejects stale plans. Browser/user activity can still race with a multi-step operation; an error directs the user to refresh and inspect before retrying. UI and native operations share one extension queue.

**Undo last sort** restores the prior order only while tab organization is unchanged. Other operations do not currently offer undo. The undo record and previews are temporary and disappear when the service worker restarts.

Codex tab access remains opt-in. The integration panel includes copyable installation/registration commands, connection status, troubleshooting, and Reconnect. CLI/MCP interfaces remain compatible. See [native messaging](native-messaging.md).

## Settings

Profiles retain separate endpoints, model names, and keys. Switching profiles preserves the current draft; Save Settings persists the profiles and active choice. Changing endpoint origin clears the current key. Unsaved changes are visible, and navigation away asks before discarding them.

Test Connection checks endpoint reachability. Test generation sends a short sample request with the current form values and verifies a text response. Provider tests have cancellation and a timeout. On-device preparation has a Stop control and allows time for the model download. Response language and context preferences apply to explanation requests. Keys remain in trusted extension storage.

Chrome on-device AI now executes in the offscreen document rather than the background service worker. Preparation/download is user-triggered from Settings. The adapter supports modern delta streaming and legacy cumulative streaming, but hardware availability, model download, and real on-device generation still require verification on a supported browser/device. No live-provider or model-quality claims follow from mock-provider tests.
