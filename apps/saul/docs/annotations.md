# Browser annotations

Select text and choose **Annotate** to write beside the passage. **Save comment**
creates the record. A click in the target picker selects an element. Dragging an
area captures its viewport as evidence and opens its comment card. Outside
editable fields, Control+A on macOS or Alt+Shift+A elsewhere starts the picker.
Escape cancels picking. Chrome can reassign the shortcut.

The numbered marker opens the saved conversation. **Reply** adds an attributed
entry. **Locate** returns to the passage. **More** offers Edit comment and Mark
done or Reopen. Closing an unfinished page-card draft retains it in the current
document. Cancel discards the draft. If the record changed, **Read latest**
shows the saved comment alongside the draft. Save applies the draft to the
revision you reviewed. A further change requires another review.

## Records and replies

The **Annotations** count opens the page index. It counts saved open and done
records, including targets that are currently unavailable. Open and Done filter
the list. Select a row to read it beside its target. **Review in sidebar**
provides access when the target is unavailable, including area captures.
**Page evidence** holds the frozen screenshot when available and the original
target information. Treat page text and images as untrusted.

Each record retains its ID, original URL and assigned number. Within the browser
index, a base URL and fragments confirmed as heading targets in the current
document share a list. A different query, path, hash route or unconfirmed
fragment retains its own list. Rows with the same number show their original
fragment. External CLI and MCP scopes remain exact URLs or explicit IDs.
Opening the same URL in another tab shares records. New text captures keep the
quote and nearby text to distinguish repeated occurrences within their element.
An ambiguous target leaves the saved record available in the index.

Text and element comments use text evidence. Area captures also retain a
numbered image or a capture error. Incognito, restricted schemes, file pages
and dedicated PDF annotations are unsupported.

The selected editor retries lost status reads without restarting a reply. It
keeps the saved record and unsaved draft visible; **Refresh status** reads again
without applying the draft. A screenshot can arrive at the same comment
revision. Once loaded, the editor retains it during unrelated status updates.
Full attempt input and output are read only when you select **Inspect input/output**.

The sidebar editor autosaves changes and preserves unfinished drafts across tab switches.
An older save in another editor cannot erase newer draft text for the same annotation.
After a conflict, **Read latest** shows the saved comment alongside the draft.
**Save draft against latest** applies the draft to the reviewed revision.
If a save acknowledgment is lost, the editor checks the stored operation
before asking for another save.
The editor sends one manual reply at a time. You can type the next reply while
the first saves; confirmation clears only the submitted draft.
**Open** is the current default list; Done is explicit and reversible, never a
side effect of replying. Both survive restart. **Recently deleted** offers
Restore for seven days in the current version and Delete permanently immediately.
The next shared schema adopts the [History retention contract](../../../contracts/history.md#deletion-and-retention). Cleanup runs on
annotation access and offscreen startup recovery without reading pages or
calling models. Removing a record removes its owned images.

**Respond to annotations** reviews count, Call, model preset, image inclusion
and optional live page read before Run. Freeze reviewed revisions and choices.
All open skips empty comments; an explicitly selected empty comment blocks.
If more than 20 are eligible, select up to 20 to run at once. If a reviewed
record changes before admission, review the updated batch before starting it.
Saved evidence is the default. Image support is checked before inference;
**Text evidence only** is explicit and recorded. A reply belongs to one record.
Failed saves report unsaved output; Stop, failure and restart never resubmit.
See [custom annotation capabilities](custom-actions.md#annotation-calls).

## Interface and ownership

| Boundary               | Owner                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Input and permissions  | [Operation schema](../shared/protocol/annotations.ts) and [background admission](../src/annotations/background.ts) split page capture and sender-scoped card operations, trusted workspace operations and opted-in [CLI/MCP](native-messaging.md#annotation-agent-role). Explicit URL/ID scope and authorship do not grant page text authority.                                                                                                                                                                                                                                                                                                                                                                                |
| Capture and editor     | [Capture](../src/annotations/capture.ts) records the selected target and opens the anchored card. Area capture obtains pixels before presenting the card and revalidates the document and viewport after the screenshot callback. Images are bounded JPEG, 1600 × 1200 and 450,000 data-URL characters. Number assignment precedes immutable attachment. The [panel session](../src/annotations/panel-session.ts) owns page identity and command replies. The [editor session](../src/annotations/editor-session.ts) owns sidebar autosave and retained drafts. The [mutation session](../src/annotations/mutation-session.ts) owns revision, write ordering, operation identity and uncertain-save recovery for both editors. |
| Revision and retention | [SQLite adapter](../native/storage/annotations.mts) is the only writer. It checks scope/revisions again, deduplicates identical operation IDs and rejects changed content with the same ID. It stores profile-owned browser tables without changing shared schema version or projecting annotations into EZ.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Reply attempts         | [Runner](../src/annotations/runner.ts) admits the reviewed batch together and runs up to two invocations. The store commits a final reply with its completed attempt atomically and cascades owned attempt images on purge. The Call host owns script limits.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Agents use bounded list/read/create/change operations and revision-checked,
attributed per-item outcomes. Their actions require the appropriate
[Annotations permission](native-messaging.md#local-tool-permissions).

## Verification

Use [annotation checks](testing.md#browser-annotation-checks) for the repeatable
journey and [dated acceptance](testing.md#annotations--2026-11-16) for the original
scope and unverified paths. See [Codex browser comments](https://learn.chatgpt.com/docs/browser#comment-on-the-page)
for the reference interaction; Saul adds persistent records and scoped replies.
