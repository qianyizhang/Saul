# Browser annotations

**Annotate** captures selected text, a DOM element or an area before opening the
Chrome side panel. The Annotations view has a current-page list and editor;
the sibling Summary view retains its result. Outside editable fields, use
Control+A on macOS or Alt+Shift+A elsewhere to pick a target; Escape cancels.
The clickable entry and Chrome shortcut reassignment remain available.

## Records and replies

A record belongs to the exact HTTP(S) URL, including query and fragment.
Duplicate tabs share records; browser tab/document identity guards capture,
not retention. Canvas or inaccessible frames use area capture without invented
selectors. Incognito, restricted schemes, file pages and dedicated PDF
annotations are unsupported. Failed capture labels missing evidence instead
of substituting another page.

Show the frozen screenshot with numbered target, labelled **Comment**, save
or error state, **Done** and attributed replies. Metadata belongs in **Page
evidence**; frozen requests and raw output in **Inspect input/output**. Treat
page text and images as untrusted. Lists omit image bytes and exact payloads.

Autosave preserves empty and unfinished comments, including across tab switches.
**Open** is the current default list; Done is explicit and reversible, never a
side effect of replying. Both survive restart. **Recently deleted** offers
Restore for seven days and Delete permanently immediately. Cleanup runs on
annotation access and offscreen startup recovery without reading pages or
calling models. Removing a record removes its owned images.

**Respond to annotations** reviews count, Call, model preset, image inclusion
and optional live page read before Run. Freeze reviewed revisions and choices.
All open skips empty comments; an explicitly selected empty comment blocks.
Saved evidence is the default. Image support is checked before inference;
**Text evidence only** is explicit and recorded. A reply belongs to one record.
Failed saves report unsaved output; Stop, failure and restart never resubmit.
See [custom annotation capabilities](custom-actions.md#annotation-calls).

## Interface and ownership

| Boundary               | Owner                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input and permissions  | [Operation schema](../src/annotations/contract.ts) and [background admission](../src/annotations/background.ts) split page capture/marker reads, trusted editor and opted-in [CLI/MCP](native-messaging.md#annotation-agent-role). Explicit URL/ID scope and authorship do not grant page text authority.                                                                                |
| Capture and editor     | [Capture](../src/annotations/capture.ts) checks document identity and navigation before the screenshot callback opens the panel during the gesture. Images are bounded JPEG, 1600 × 1200 and 450,000 data-URL characters. Number assignment precedes immutable attachment. [AnnotationPanel](../src/annotations/AnnotationPanel.tsx) retains failed drafts and explicit conflict review. |
| Revision and retention | [SQLite adapter](../native/annotation-store.mts) is the only writer. It checks scope/revisions again, deduplicates identical operation IDs and rejects changed content with the same ID. It stores profile-owned browser tables without changing shared schema version or projecting annotations into EZ.                                                                                |
| Reply attempts         | [Runner](../src/annotations/runner.ts) admits the reviewed batch together and runs up to two invocations. The store commits a final reply with its completed attempt atomically and cascades owned attempt images on purge. The Call host owns script limits.                                                                                                                            |

Agents use bounded list/read/create/change operations and revision-checked,
attributed per-item outcomes. They need explicit Annotation access; unrelated
page-reading and mutation capabilities remain separate.

## Verification

Use [annotation checks](testing.md#browser-annotation-checks) for the repeatable
journey and [dated acceptance](testing.md#annotations--2026-11-16) for the original
scope and unverified paths. See [Codex browser comments](https://learn.chatgpt.com/docs/browser#comment-on-the-page)
for the reference interaction; Saul adds persistent records and scoped replies.
