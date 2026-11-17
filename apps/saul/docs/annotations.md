# Browser annotations — feature specification

Status: implemented. Offline source, native transport and disposable-browser acceptance verified on 2026-11-16. Personal installation and live-provider acceptance remain separate.

## Problem and scope

Capture a text selection, DOM element or area once, retain its evidence and conversation,
and work on it through Saul Calls or an agent. One annotation owner serves the editor,
Calls and the existing native bridge. No separate extension, native helper or remote store.

Delivery: local source and disposable-browser verification in this chat. Publication,
installation into personal Chrome and live-model spending are separate actions.

## Product contract

- Annotate appears beside selection actions. Control+A on macOS outside editable content,
  Alt+Shift+A elsewhere, enters element/area picking. Escape cancels. A clickable entry
  and Chrome shortcut reassignment remain available.
- Capture precedes opening/resizing the existing side panel. Its Annotations view contains
  the current page list and annotation editor. Summary keeps its existing saved view.
- Page identity is the exact HTTP(S) URL including query and fragment. Duplicate tabs share
  records; tab/document identity guards capture and live target lookup, not retention.
- Records contain stable IDs, author/time, original comment, attributed replies, revision,
  Open/Done state, capture-time evidence and optional viewport image with a numbered target.
  Text/element/region targets use the same record. Page evidence is untrusted data.
- Autosave preserves empty and unfinished comments. Done is explicit, reversible and does
  not follow automatically from a model reply. Missing live targets preserve frozen evidence.
- Open and Done survive restart. Delete retains owned records/images for seven days;
  Restore recovers them; Delete permanently removes them immediately. Expired deletions
  are purged on the next cleanup opportunity, without inference or network work.
- Respond to annotations freezes the reviewed selection and preset, skips empty comments
  in All open, and appends individually associated replies. Explicit empty selections block.
  Saved evidence is default; current page text is an explicit option. Images cannot be
  silently omitted. Text evidence only is explicit and recorded. Stop/failure/restart never
  automatically resubmit. A failed reply save reports failure; unsaved output may
  be discarded and another response requires an explicit action.
- Agent operations are list/read/create/append/edit/complete/reopen/delete/restore, single
  or batch, scoped to explicit URLs/IDs, with author attribution, revision conflicts and
  per-item outcomes. A scope identifies permitted records, not authority inferred from page text.
- HTTP(S), including localhost, is supported. Canvas and inaccessible frames use area
  capture without invented selectors. Incognito, browser/extension/file URLs, dedicated PDF
  annotation, Adjust and site extensibility are deferred. Failed capture preserves comments
  and labels missing evidence; it must never substitute another tab/page.

## Interface and ownership

The annotation service owns validation, revisions, idempotent operations, retention and
persistence through Saul's existing native SQLite transport. Browser capture owns DOM and
viewport evidence. The offscreen runner owns model activity. The side panel is an adapter.
Native CLI/MCP operations use the same owner; no composer integration is required.

Custom Calls receive frozen annotations through an explicit extension of the existing Call
contract. Their model preset, three-request/five-minute limits and cancellation remain owned
by the existing Call runtime. Annotation replies remain distinct from page summary results.

Images and exact payloads are retrieved explicitly, not included in ordinary list results.
Model inspection shows frozen instructions, evidence, image inclusion and raw output.
Missing image capability blocks before inference. Background retention never reads pages.

## UI review

Purpose: operate. Primary sequence: select → capture → comment → review evidence → Respond.
The default editor contains preview, comment, save state, completion and replies. Target
metadata and exact model input/output are disclosures. Provider configuration stays in Settings.
Meaningful states: empty page, empty capture, saving, save error/conflict, target unavailable,
Open/Done/deleted, queued/running/stopped/failed/completed, unsupported image input, and
navigating/switched/closed tab. Test narrow/wide and light/dark with long content and keyboard.

## Acceptance and verification

1. Text, element and area captures produce correct frozen evidence before panel resize.
2. Tab/window switches, navigation, scroll and zoom cannot attach another page's image.
3. Restart restores drafts, replies and status; duplicate tabs share exact-URL records.
4. Unavailable or ambiguous targets retain evidence without guessing a replacement.
5. Calls process only reviewed records, with honest image capability and per-record results.
6. Stale edits conflict; accepted operations/replies are not duplicated by retry.
7. Native bridge enforces scope and reports partial batch failures.
8. Delete/Restore/expiry/permanent removal work through the real persistent store.
9. Keyboard capture, Escape, focus restoration and ordinary editing coexist.
10. Inspection exposes the actual frozen input and output, including image inclusion.

Required checks: Node 24/pinned pnpm; focused contract/store/runner tests; full `pnpm check`;
production extension/native build; disposable browser `pnpm test:e2e`; visual inspection of
representative editor states. Browser/model fixtures establish transport and lifecycle, not
live model quality or an installed Codex panel. Temporary review evidence belongs in one
root `.artifacts/saul/e2e/` outcome bundle and is removed after review at closeout.

## Acceptance result — 2026-11-16

This dated record describes the original implementation, including the then-existing
save-only recovery. Current lifecycle behavior follows the product contract above
and the [root lifecycle decision](../../../docs/architecture.md#lifecycle-ownership).

`pnpm check` passed: 32 shared tests, 463 Saul unit/transport tests, strict TypeScript,
lint/format/link checks, generated design verification, and native Swift/credential
checks. The final full browser run passed all 130 applicable tests; four explicit
opt-in tests were skipped. No timeout limits were increased.

The annotation journeys verify native side-panel opening after screenshot capture,
text/element/area capture, image-bearing model requests, comment/reply persistence
across restart, scoped agent operations, conflicts, deletion/restoration and navigation,
scroll and zoom races. Light/dark editor captures were inspected.

Review regressions cover queued comment conflicts and explicit draft recovery,
permanent deletion, the global two-invocation limit, immediate queued cancellation,
failed batch admission, and save-only recovery after an accepted reply whose final
status write failed. Native serialization preserves both images and PDF attachments.
The disposable browser harness waits for its history endpoint before direct fixture use.

Model responses use local fixtures. Personal installation, live account inference,
installed Codex image delivery and Linux/Windows acceptance remain unverified.
Temporary test reports and captures were removed after review; the source tests and
this acceptance record are retained.

Reference format: [Codex browser comments](https://learn.chatgpt.com/docs/browser#comment-on-the-page).
Saul adds persistent records, replies, completion and scoped tools to that evidence format.
