# Product behavior

## Reading

1. Select a term or short passage and choose **Explain**, or press **Alt+Shift+E**.
2. Saul saves the request, adds a quiet underline, and confirms that the job is queued. It does not open a card automatically.
3. Keep reading. A completion notification offers **View**; the badge and page list retain unread state.
4. Click a marker or open the page list with **Alt+Shift+L** to inspect progress or the saved answer.

Reading jobs survive card closure, refresh, navigation, or source-tab closure while the extension runtime remains available. **Stop** cancels queued or running work and retains partial text. **Regenerate** and follow-ups create new attempts; the last successful answer remains available if a later attempt fails.

Opening a completed answer marks it read. Dismissing a notification does not. Error notifications can be muted from Settings or an error notification; success notifications and inline explanation errors remain visible.

### Page markers

- Saved passages restore on the same URL when quote context identifies one occurrence.
- Queries and hash routes remain part of page identity.
- Markers do not replace page text or intercept native links.
- Changed, missing, overlapping, or ambiguous text remains available in the page list and library.
- Shadow roots, frames, browser-restricted pages, and oversized text maps are outside the current capture surface.

### Explanation card

- Pin keeps the card open while interacting with the page.
- Concept terms expose notes on hover, focus, or click.
- **Simpler**, **Give an example**, and **Go deeper** retain the captured source context and include the previous explanation.
- Copy reports clipboard failures rather than claiming success.

## Library

The popup opens directly to reading history. Search and bookmarks stay visible; export and deletion of the entire library are under **Export and manage history**. The full workspace uses the same views with a wider reading area.

The full workspace provides:

- search across selected text, readable explanations, concept notes, titles, and URLs;
- bookmarks, pagination, source navigation, and per-passage attempt history;
- Markdown export of retained passages and attempts, including incomplete labels;
- deletion and **Clear all**, which cancel affected work and block late writes from recreating it.

SQLite-WASM stores the library in OPFS for the current browser profile. Data is local to that profile and remains until explicit deletion or browser-profile removal.

## Settings and models

- OpenAI-compatible profiles keep separate endpoint, model, temperature, and key values.
- Changing endpoint origin clears the current key.
- Missing/stale profile selection preserves the current configuration in a recovered profile.
- Invalid saved settings show the affected field and offer an explicit backup-and-reset action.
- Save, connection test, and generation test use the current draft without overwriting unreadable stored settings.
- Model setup appears first. Save and validation feedback stay visible while scrolling; leaving a changed draft asks before discarding it.
- Response language and context controls apply to new submissions.
- Chrome on-device AI is temporarily disabled while live model setup remains unverified. Saved selections remain readable and prompt an explicit switch to ChatGPT plan or OpenAI compatible. New local requests are blocked; Saul does not switch providers automatically.
- [ChatGPT plan](chatgpt-plan.md) supports OAuth sign-in, saved account registrations, account-specific model discovery, and streamed explanations. It requires the local helper. Its controls omit unsupported temperature and output-token options, and failures never switch billing providers.

Local tests cover the provider boundary with deterministic fixtures. They do not establish external-provider authentication, model quality, Chrome model availability/download, or device performance.

## Tabs

The Tabs workspace can preview and apply:

- title/domain sorting;
- creating, updating, or removing groups;
- moving unpinned, ungrouped tabs between normal windows.

Pinned tabs remain fixed and existing groups move as intact blocks during sorting. Saul rejects stale previews before apply. Browser actions can still race with a multi-step mutation, so refresh and inspect after any error. **Undo last sort** is available only while the tab layout still matches the applied result; previews and undo state disappear when the service worker restarts.

Grouping and moving controls appear when tabs are selected (or groups already exist). Optional connection controls are under **Codex connection**, after the tab list.

External CLI/MCP tab access is optional and disabled by default. It also supports creating windows from selected ungrouped tabs. A separate **Page reading and actions** switch enables bounded visible-page reads, referenced click/fill actions, and HTTP(S) navigation. Page mutations preview by default. See [native messaging](native-messaging.md).

## Compatibility

- Saul targets Google Chrome MV3 only.
- The native bridge supports macOS and Linux Chromium-family browsers; Google Chrome is the verified target.
- See [testing](testing.md) for covered behavior and evidence limits.
