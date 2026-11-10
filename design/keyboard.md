# Keyboard reference

For current assignments, open **Settings → Shortcuts** (EZ) or
**Settings → Preferences → Shortcuts** (Saul). EZ records replacements there;
Saul opens Chrome's shortcut editor for browser commands.

## Editing a draft

**Return** and **Shift+Return** insert a newline at the caret or replace the
selection, without moving focus or sending. This applies to EZ action inputs
and follow-ups in both windows, and to Saul reading card follow-ups.
Leave single-line fields and text composition to the platform. Menus and dialogs
take priority. Leave browser navigation, tab, find, address bar and editing keys
to the browser. Keep inline shortcut hints out of Min Mode.

## EZ

| Command                              | Key         | Binding         |
| ------------------------------------ | ----------- | --------------- |
| Run action or send focused follow-up | ⌘Return     | Configurable    |
| Stop generating                      | ⌘.          | Configurable    |
| New run (when idle)                  | ⌘N          | Configurable    |
| Previous / next action (wraps)       | ⌘⇧[ / ⌘⇧]   | Configurable    |
| Action 1–8 / Last action             | ⌘1–8 / ⌘9   | Configurable    |
| Toggle Quick Lookup                  | ⌃⌥Space     | Fixed, global   |
| Hide Quick Lookup (work continues)   | Escape / ⌘W | Fixed, in panel |
| Open Settings                        | ⌘,          | Fixed           |

macOS **Services → Look Up in EZ** can also fill a draft without submitting it.
In Shortcuts, **Use Chrome navigation** assigns ⌘⌥← / ⌘⌥→ to previous/next action.

Owners: [draft editing](../apps/ez/Sources/EZ/MultilineDraftReturn.swift),
[configurable commands](../apps/ez/Sources/EZCore/KeyboardShortcuts.swift),
[panel and routing](../apps/ez/Sources/EZ/QuickLookupController.swift).
Check with [native UI checks](../apps/ez/Tests/README.md#offline-checks).

## Saul

| Command                  | Key                                    | Scope                                                                     |
| ------------------------ | -------------------------------------- | ------------------------------------------------------------------------- |
| Explain selected passage | ⌘/Ctrl+Enter or Alt+Shift+E            | Page selection outside editable content                                   |
| Send follow-up           | ⌘/Ctrl+Enter                           | Focused follow-up draft                                                   |
| Toggle page explanations | Alt+Shift+L                            | Page outside editable content                                             |
| Stop generating          | ⌘/Ctrl+.                               | Active reading card, outside editable content                             |
| Dismiss the reading card | Escape                                 | Page; work continues                                                      |
| Open Settings            | ⌘/Ctrl+,                               | Extension popup and workspace                                             |
| Call Saul                | Ctrl+S on macOS; Alt+Shift+S elsewhere | Chrome default; runs for the current regular HTTP(S) tab                  |
| Close summary panel      | Ctrl+W on macOS; Alt+Shift+W elsewhere | Chrome default; closes only the current window's panel and work continues |

The open summary panel also handles Ctrl+W locally. Command+S and Command+W
remain Chrome's on macOS. The [tab board](../apps/saul/docs/mcp-app.md) has its own
keyboard controls.

Owners: [follow-up](../apps/saul/src/surface/ExplanationCard.tsx),
[page commands](../apps/saul/src/surface/SaulRoot.tsx),
[workspace](../apps/saul/src/app/Workspace.tsx),
[browser defaults](../apps/saul/wxt.config.ts) and
[summary panel](../apps/saul/src/app/SummaryPanel.tsx).
Check follow-up editing and sending in the [browser journey](../apps/saul/tests/e2e/follow-up.spec.ts).
