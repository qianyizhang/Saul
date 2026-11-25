# Product behavior

- [Saul terms and surfaces](../GLOSSARY.md)

## Reading

| Goal                                 | Outcome                                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Open a selected explanation or image | **Explain & open** or **Illustrate & open** opens the card after acceptance, including saved reuse.                                                                      |
| Submit quietly                       | **Alt+Shift+E** or **Command/Ctrl+Enter** queues the selected or default action. Repeated keyboard requests stay quiet.                                                  |
| Return to a request                  | Use the persistent marker, **View** from a completion notification, or **Alt+Shift+L** for the page list.                                                                |
| Keep reading while work runs         | Card closure, refresh, navigation and tab closure leave work active while the extension runtime remains available. Completion never reopens the card.                    |
| Stop or continue                     | **Stop** cancels queued or running work and retains partial text. **Regenerate** and follow-ups create new attempts. Later failures preserve the last successful answer. |
| Clear unread state                   | Open the completed answer. Dismissing the notification leaves it unread.                                                                                                 |
| Mute errors                          | Mute error notifications in Settings or from a notification. Success notifications and inline errors stay visible.                                                       |

### Illustrate and reading activity

- **Image attempt** — Choose the Draw preset and PNG/GIF in the selection widget. **Illustrate & open** starts the attempt. Existing libraries can add the starter under Settings → Actions.
- **Saved image** — Each attempt keeps its own image. Download preserves original bytes. GIF Play/Pause respects Reduce Motion. Reading an image leaves the request unchanged.
- **Activity** — [Answer divider](../assets/surface.css) shows warning while waiting, green on a provider thinking signal and a static light under Reduce Motion. Retain its space. Clear the light at answer/refusal text. **Waiting…**, **Generating response…**, **Saving…** and saved/error status remain visible, including in Min Mode.

### Page markers

- Saved passages restore on the same URL when quote context identifies one occurrence.
- Queries and hash routes remain part of page identity.
- Markers do not replace page text or intercept native links.
- Changed, missing, overlapping, or ambiguous text remains available in the page list and library.
- Shadow roots, frames, browser-restricted pages, and oversized text maps are outside the current capture surface.

### Explanation card

- **Inspect input/output** reveals the selected attempt's saved instructions,
  context fields, assembled user prompt and literal response text on one left edge. Each block can
  be selected or copied. History and past attempts use the same inspector. Status
  distinguishes prepared, completed and incomplete attempts. Missing older input
  is labelled unavailable. Inspection does not send another request.

- Pin keeps the card open while interacting with the page.
- Concept terms expose notes on hover, focus, or click.
- **Simpler**, **Give an example**, and **Go deeper** retain the captured source context and include the previous explanation.
- **Ask a follow-up** labels the borderless draft below an eligible saved answer. Send or Command/Ctrl+Enter submits it with the saved source, earlier exchanges and the same model choices. The question appears with its answer, and earlier answers remain in Past attempts. Closing the card preserves the draft on the page. Stop or failure preserves the last successful answer.
- Follow-ups reject questions over 2,000 characters or compiled conversations
  over 120,000 characters. Context stays intact.
- Copy reports clipboard failures rather than claiming success.

## History

Right-click an article and choose **Save & deep dive** to save its link in
**History → Deep dives** and send your instruction and the article URL from a
new background tab in the current Chrome profile. Sign in to ChatGPT in that
profile for automatic sending. Edit the reusable instruction under **Settings →
Preferences → Deep dives**. A repeated action on the same URL reuses its record.

The saved chat link appears after Saul sees the matching user message in a
ChatGPT conversation with a stable URL. If the composer needs help, open the
ChatGPT tab and send manually. If delivery is unconfirmed, check that tab before
sending again. Saul keeps the saved article and any confirmed chat link in the
Chrome profile. Removing the saved entry in Saul leaves the chat in ChatGPT.

| Goal                      | Outcome                                                                                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Find saved work           | Popup opens to History. The workspace offers wider reading with the same views. Search selected text, readable answers, notes, titles and URLs. Bookmark, paginate, reopen sources or inspect past attempts.                                                             |
| Export or delete          | Markdown includes retained attempts and incomplete labels. **Recently deleted** offers Restore and Delete permanently. **Clear History** permanently clears visible and deleted Library records across both apps. Stop active work before deletion.                      |
| Use Min Mode              | Default everyday view. Keep essential state, controls and choices visible. More/Details exposes uncommon operations. [Shared design](../../../DESIGN.md#min-mode)                                                                                                        |
| Change presentation       | Preferences save independently of configuration drafts and update open surfaces, including the summary panel. The board keeps its own mode. Current key assignments appear in Settings → Preferences → Shortcuts. [Keyboard reference](../../../design/keyboard.md#saul) |
| Preserve or reuse history | [Shared history](../../../contracts/history.md) requires the helper even with API providers and survives browser profile removal. Reuse is disclosed. **Run again with current input** captures a new request. **Regenerate** uses the frozen request.                   |

## Settings and models

| Goal                            | Outcome                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configure an action             | Editable prompts and default model presets. Explain, Lookup and Nudge are editable starters. New installations have explicit Actions and Presets.                                                                                                                                                                                                                                                             |
| Edit across sections            | Overview leads with reading defaults. Presets keeps the choice near its fields and uses a compact selector at narrow widths. Section changes keep the draft and visible Save/validation. Leaving or reloading a dirty draft asks before discard.                                                                                                                                                              |
| Resolve stale or uncertain save | **Review latest** compares original, saved and local values. Show local edits. Choose **Mine / Latest** for same-field conflicts and keep non-conflicting edits. **Apply to draft** updates only the draft. Save checks the fresh revision. Cancel keeps the draft. An already delivered write needs no second save. [Transaction contract](../../../contracts/configuration.md#unified-configuration-scopes) |
| Prepare text                    | `{{text}}` is required. Other allowed fields are `{{context}}`, `{{page title}}`, `{{page url}}`, `{{heading}}` and `{{paragraph}}`. Response language and context changes affect new requests. [Preparation guarantees](../../../contracts/actions-and-attempts.md#action-preparation)                                                                                                                       |
| Bind a model                    | Presets bind connection, capability and options. Inspection leaves account and defaults intact. [Shared preset contract](../../../contracts/configuration.md#connections-and-presets), [ChatGPT plan](chatgpt-plan.md)                                                                                                                                                                                        |
| Use a local API profile         | Separate endpoint, model, temperature and key. Changing origin clears the current key.                                                                                                                                                                                                                                                                                                                        |
| Repair unavailable settings     | Missing profiles stay unavailable. Invalid or obsolete settings show the field and offer explicit backup-and-reset. Unsupported records stay intact until explicit reset. Save and connection/generation tests use the current draft.                                                                                                                                                                         |
| Retry a saved attempt           | Frozen choices remain bound. Changed credential owner or endpoint preserves output and asks for a new preset and attempt. [Retry rules](../../../contracts/actions-and-attempts.md#execution)                                                                                                                                                                                                                 |
| Replace retired Chrome AI       | Saved selections stay readable. Explicitly select ChatGPT plan or OpenAI compatible before new work.                                                                                                                                                                                                                                                                                                          |

## Window and Tab board

| Goal                      | Outcome                                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pick the scope            | **Window** manages the containing Chrome window. The MCP **Tab board** shows connected normal windows. Incognito is excluded.                                                                                      |
| Select tabs               | Individual selection, Shift ranges or Select all. Order follows displayed windows and tabs. **Group**, **Move to** or **Summarize**. Pins can be summarized and remain pinned.                                     |
| Arrange manually          | Drags and Group/Move apply immediately. Individual tabs enter or leave groups. Drag group headings to keep groups intact. Cross-window grouping asks for a destination. Keyboard move controls accompany dragging. |
| Recover a manual edit     | Undo applies while the affected arrangement can be restored. Closing the source window prevents Undo. Refresh and inspect partial failures before retrying.                                                        |
| Review a Codex suggestion | [Tab board proposal rules](mcp-app.md#proposal-and-approval-lifetime).                                                                                                                                             |
| Share window names        | [Window label ownership and native Chrome names](mcp-app.md#manual-controls).                                                                                                                                      |
| Grant external access     | Settings → Preferences → Integrations → Local tool access. Access is off by default. [Native messaging](native-messaging.md#connect-and-verify)                                                                    |

- **Rows** — Readable titles with hostname fallback and full original title/URL on hover. Standard view shows window counts above the list. Display labels preserve source metadata.
- **Refresh** — Preserve focus, scroll and surviving choices.

### Summaries

- [Calls and summaries](calls.md) owns page capture, the reader, PDFs and retry.

## Compatibility

- Saul targets Google Chrome MV3 only.
- [Native bridge support](native-messaging.md) covers tested browsers and platforms.
- See [testing](testing.md) for covered behavior and evidence limits.

- [Shared presets](../../../contracts/configuration.md) and [Speak preview](chatgpt-plan.md#speech-preview) own capability rules.

## Browser annotations

- [Annotation guide](annotations.md) owns capture, replies, evidence and retention.
