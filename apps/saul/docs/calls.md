# Calls and summaries

**Call Saul** is the page command; a **Call preset** selects the work and its
**Model preset** supplies the connection, model and options. Selected-text
[Actions](product.md#reading) are distinct. The [custom Call guide](custom-actions.md)
owns the optional builder, module API and host trust rules.

## Start, stop and reopen

Right-click a page, use the Call Saul shortcut, or select tabs in **Window**
and choose **Summarize**. The clicked page is the source even over a link or
selection. A batch preserves tab order and source-window labels. Saul opens
the side panel on Chrome gestures, keeps the source tab active and retains
the selected result across tab switches. Native and Tab board commands use
the full reader because they lack that gesture; existing reader URLs still work.

In **Settings → Calls**, select a Call preset and its runtime Write preset.
**Summarize (default)** needs a saved Write preset for new runs and **Run again**.
If none is set, choose a **Write preset** in the reader and select **Save and
start**. An unavailable or incompatible saved preset stays visible for repair.
Custom Call presets display both their approved revision's name and runtime
model preset. Switching to Summarize preserves the custom choices.

When Saul opens older settings, it keeps an existing explicit summary preset
reference. An older connection-only choice migrates only if exactly one Write
preset matches that bound plan account and the old model and options
(GPT-6 Luna, medium effort, Fast off). Otherwise choose a preset explicitly.
Historical routes remain available through **Retry unfinished** when their
saved bindings still resolve.

Different page URLs can run concurrently, including on the same site. Start
and Retry exclude exact URLs already queued, capturing, generating or saving
in another batch. Each batch runs up to two pages at a time. Provider and
custom-script failures pause unstarted pages; capture failures or a malformed
built-in summary affect only that page. Stop cancels active streams and retains
saved or partial output when possible. Save failure stops the batch without
overwriting completed rows or replaying inference.

The reader is disposable; closing it does not Stop, delete or regenerate.
Restart marks unfinished work interrupted. History separates **Passages** and
**Summaries**; passage Clear all does not delete summaries. Saved summaries use
the first selected page’s title and show how many more pages the batch contains.
Keep progress, Stop, Retry unfinished, coverage, errors and Export HTML available
in the reader. Deletion is under Details. The export is self-contained and includes incomplete
states. Tab surfaces show a compact active link. Completion never moves focus.

If a reader or the Call builder temporarily loses status, it keeps the last
known result and shows a separate read error. The view retries that read with
a delay, or you can select **Refresh status** to read immediately. Neither
starts, stops, or repeats inference. Checks end when the attempt settles or
the view closes.

The executor retains every output delta and publishes regular detached progress
at most every 50 ms, with an immediate final flush on success, failure or Stop. It rebuilds combined
transcripts only when publishing or settling. This does not change the runner's
500 ms custom-Call checkpoints or the requirement to save before reporting success.

For one page, lead with its title, source link and plain progress; omit repeated
titles and batch counts. For batches, distinguish successful and processed counts.
Show the saved preset/model in reader and export. Built-in output gives English
then equivalent Simplified Chinese, with one lead, two to four points and visible
limitations; disclose deeper material and intermediate output on demand.

## Source capture and PDFs

Loaded HTTP(S) capture limits text to 120,000 characters and does not focus or
reload the tab. It does not read video, audio, images, frames, linked pages or
collapsed/unloaded content. Unavailable, changed or restricted sources report
their limits; the original tab/URL is checked across capture.

Settings → Calls → **PDF processing** is independent of model presets. Saving
changes the default for new runs and Run again; Retry retains the saved method.

| Mode                                      | Input and limits                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PDF URL attachment (server)** · default | Use an eligible ChatGPT plan preset. Saul saves a validated URL without viewer fragment and sends it as `input_file.file_url` alongside text; it does not download, upload or store PDF bytes. OpenAI must be able to reach it without the browser's cookies. Local cutoffs do not apply. Private, expired, password-protected or unsupported inputs may fail without fallback. |
| **Local parsing · send text**             | Download the current document using available cookies and extract text with bundled PDF.js. Stop at 20 MiB, 200 pages, 120,000 characters or 30 seconds. No OCR, image interpretation, linked traversal, local files or automatic retry. Downloaded bytes are temporary; saved text can be retried.                                                                             |

Local parsing counts pages read, pages without text and truncation under
**Source coverage**. Order can be imperfect and the last page partial; the
download may differ from Chrome's open copy. Password, invalid-file, access
and OCR-required errors are explicit. Stop or source changes reject late capture.
Where injection is denied, only local mode may identify an extensionless PDF
via a bounded signature-checked download. HTML is not a PDF fallback.

An attachment's prepared time and exact URL are inspectable; text, character
counts, or page coverage are unavailable. The saved URL freezes the request,
not the document. Retry may read a newer file. Existing text-mode batches keep
their local capture and retry behavior. Attachment mode asks OpenAI to process text and page images,
subject to model and provider limits. See the [plan request contract](chatgpt-plan.md#pdf-url-attachments)
and [PDF checks](testing.md#pdf-summaries).

## Reuse, Retry and Run again

A repeated exact ordered URL selection reopens its active or latest saved
result. For custom Calls, the lookup also matches approved revision and preset ID.
Changed built-in choices are disclosed without silently rerunning. Before any model call,
show **Saved summary reused**, the original date and current-input comparison.
Distinguish exact matches, whitespace changes, token additions/removals,
changed request fields and unavailable input. A lexical estimate says nothing
about meaning or content outside the capture. Attachment URLs compare metadata
only; no “Text unchanged” verdict. Comparing or reopening does not call a model.

**Compare current page** may download a local PDF; temporary current captures
are discarded. Inspection shows saved source, coverage, prepared instructions,
the exact assembled prompt and raw output. Large blocks are displayed in bounded
sections with search and full-text Copy. **Run again** creates a fresh capture
and saved identity using the current choices. **Retry unfinished** keeps
completed results and uses frozen choices and captured input. If the saved route
is unavailable, Retry reports that failure. When launch settings, the chosen
route, or any source tab changes after inspection, the reader asks for a fresh
review before generation. No age or change threshold starts generation.

## Runtime owners

| Boundary                       | Owner                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Saved choice and builder draft | [Call editor](../src/calls/editor.ts) and [store](../src/calls/store.ts); draft writes do not resave choices                                                                                                                                                                                                          |
| Admission                      | [Call admission](../src/calls/admission.ts) owns launch review, launch-time preset selection and validation, and freezes the current or saved retry inputs before execution.                                                                                                                                          |
| One page                       | [Call executor](../src/calls/execution/module.ts) consumes a frozen Call, captured page and transient credential; detached progress never exposes DB state or secrets. It settles with validated output, failure or cancellation and publishes no later progress.                                                     |
| Capture                        | [Tab validation](../src/calls/capture/capture.ts), [source dispatch](../src/calls/capture/source.ts) and [local PDF](../src/calls/capture/pdf.ts). The explicit bundled PDF worker avoids blob/fake-worker fallback under CSP and terminates on completion or Stop.                                                   |
| Scheduling and durable results | [Runner](../src/calls/execution/batch-runner.ts) owns exclusion, cancellation and saves. Custom Calls checkpoint every 500 ms; built-in summaries save terminal output. Stop releases the control queue while workers settle. Save acknowledgments and interrupted rows remain distinct.                              |
| Reader                         | [Panel routing](../src/calls/panel-route.ts) opens during the initiating gesture, keeps a trusted per-window route and preserves the resolved saved ID. The [reader session](../src/calls/summary-session.ts) submits launch intent, displays review, adopts saved or reused results and observes the visible result. |

If site-based selection is ever added, freeze it at admission; site-specific DOM
extraction belongs to capture. Neither is an implicit URL rule today.

Only the trusted background snapshots selected tabs; only the offscreen runner
requests their captures. Content scripts cannot start or inspect summaries.
New Summarize batches store the frozen Write preset. Retry can read an older
batch’s original plan route. Both PDF modes run independently of the custom Call host. Source text and credentials never
pass through the Tab board. Keep the persisted `digest` and `action` names and
host identities stable without an explicit upgrade.
