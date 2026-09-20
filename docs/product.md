# Reading and tabs

Saul has three primary views: Reading, Tabs, and Settings. The popup provides quick access; **Open full workspace** opens a normal extension tab with room for the library and tab organizer.

## Reading

Select an unfamiliar term or short description and click **Explain**, or press **Alt+Shift+E**. Saul saves the request, adds a quiet dotted underline and briefly confirms **Queued · keep reading**. It does not open a card automatically. Continue reading; a completion toast offers **View**, and the page list and extension badge retain unread counts after the toast disappears.

Click the underlined passage to open progress or the saved answer. **View** returns to its source position. **Alt+Shift+L** opens the page list, including passages that cannot be located confidently. Opening a completed answer marks that run read; dismissing a notification does not. Refreshing or revisiting the same URL restores saved passages. Storage is local to this device and browser profile.

Generation belongs to a durable job. Closing the card, refreshing, navigating or closing the source tab does not cancel it while the extension runtime remains available. **Stop** explicitly cancels queued/running work and retains available partial text. Saving already-completed output finishes once its commit begins. Two remote requests and one on-device generation can run concurrently; additional passages queue. Repeating Explain at a known occurrence reopens it. **Regenerate** and follow-ups create a new attempt.

**Ready** requires a recognized provider completion, readable output and a successful local commit. Bare EOF, malformed events, output-limit truncation and failures remain explicitly incomplete. An incomplete regeneration retains its partial text and the earlier successful answer. After actual runner/browser loss, uncertain and unsent queued jobs become interrupted and require **Retry**; there is no automatic provider replay. Checkpoints limit recovery loss, but a final uncheckpointed fragment can be lost. Output from a failed save remains available in the current runner; it is not guaranteed to survive its termination.

Pin keeps the card open while interacting with the page. Escape or Close dismisses it. Hover, focus or click a concept inside the explanation to read its note. Copy reports clipboard failures. **Simpler**, **Give an example** and **Go deeper** retain the captured source context and include the previous explanation in their prompt. Bookmarks belong to passages and survive regeneration.

The library supports bookmarks, pagination, source navigation and search across selected text, readable explanations, concept notes, page titles and URLs. It distinguishes the latest attempt from the last successful answer and exposes past attempts. **View source** reuses a matching tab or opens the stored URL and explanation. Export includes every retained passage and attempt, with incomplete labels and readable concept notes. Delete and Clear All cancel affected work and prevent late events from recreating it.

Underlines use native CSS Custom Highlights without wrapping or replacing page text. Quote and surrounding context must identify the selected occurrence unambiguously. Changed or ambiguous text stays available in the list/library with **location unavailable**. Queries and hash routes remain part of page identity. Native links/buttons retain their behavior; overlapping passages are accessible through the page list. Text scans stop at one million characters or 30,000 text nodes: oversized pages cannot create reliable new anchors and existing marks remain unattached. Shadow-root content, frames and browser-restricted pages are outside the current capture surface. A browser without native underline hit testing gets an update message and retains list access; there is no compatibility renderer.

SQLite runs in a dedicated worker using persistent OPFS storage. Transactional, versioned migration preserves legacy responses and bookmarks, marks old completed answers as already viewed, and rejects unknown future schemas. Downgrades are unsupported. Completed and incomplete attempts remain until explicit deletion; credentials are excluded from stored run inputs and page messages. Content scripts can access only reading operations on their source page, while the trusted workspace owns global history, export, deletion, settings and tab organization.

## Tabs and Codex

The Tabs view works directly in the extension, without the native host. It can preview and apply sorts, new/existing groups, ungrouping, moves, and group name/color updates. Pinned tabs are protected, groups stay intact during sorting, and moves require ungrouped tabs. The preview includes the affected tab titles and proposed order/details.

Before applying, Saul compares the preview with current tab organization and rejects stale plans. Browser/user activity can still race with a multi-step operation; an error directs the user to refresh and inspect before retrying. UI and native operations share one extension queue.

**Undo last sort** restores the prior order only while tab organization is unchanged. Other operations do not currently offer undo. The undo record and previews are temporary and disappear when the service worker restarts.

Refreshing tabs clears an undo record that no longer matches the browser layout.

Codex tab access remains opt-in. The integration panel includes copyable installation/registration commands, connection status, troubleshooting, and Reconnect. CLI/MCP interfaces remain compatible. See [native messaging](native-messaging.md).

## Settings

Profiles retain separate endpoints, model names, and keys. Switching profiles preserves the current draft and hides revealed keys; Save Settings persists the profiles and active choice. Changing endpoint origin clears the current key. Unsaved changes are visible, and navigation away asks before discarding them.

If saved settings cannot be read, Saul shows an error and prevents saving over them. Defaults apply when no saved settings exist.

Test Connection checks endpoint reachability. Test generation sends a short sample request with the current form values and verifies a text response. All form edits are disabled during Save. Provider tests freeze the tested configuration while allowing unrelated reading-preference edits, and retain cancellation and a timeout. On-device preparation has a Stop control and allows time for the model download. Response language and context preferences apply to explanation requests. Keys remain in trusted extension storage.

Chrome on-device AI now executes in the offscreen document rather than the background service worker. Preparation/download is user-triggered from Settings. The adapter uses the modern LanguageModel API and delta streaming. Hardware availability, model download and real on-device generation still require verification on a supported browser/device. No live-provider or model-quality claims follow from mock-provider tests.

## Verification

See [the testing runbook](testing.md) for the production build, unit/contract checks, isolated browser regressions, migration rehearsal, measured scale results and hands-on evidence. The [accepted implementation decisions](reading-workflow-plan.md) explain the architecture and tradeoffs. Live external provider authentication, actual Chrome model downloads/generation, native-host registration and Firefox are not established by the local-provider tests.
