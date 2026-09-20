# Persistent explanations while reading

Status: implemented, 2026-09-21. All accepted D4–D8 and R1–R6 decisions are represented in the implementation. The decision interview is complete. See [product behavior](product.md), [verification](testing.md) and the closeout below.

## Accepted product intent

The reader highlights an unfamiliar term or short description, clicks Explain, and continues reading. They can return when the explanation is ready. The original passage has a quiet underline that opens its explanation. Saved annotations reappear after refreshing the page.

- Generation belongs to an explanation job, independently of whether a card is visible.
- Moving on within the page or dismissing the card must not cancel that job. Stop is a separate deliberate action.
- Each selected occurrence has a persistent identity linking its source position, explanation runs, and completion/read state.
- Completion cues offer a route back to the original passage and explanation without moving the reader automatically.
- Persistence uses Saul's existing local device/browser-profile storage. Bookmarking remains optional.

The earlier recommendation to cancel generation when a card closes is superseded. Interrupted work remains available with its partial text and an explicit Retry action. Only successful provider completion followed by a durable local commit produces a Ready result.

## Accepted decisions from the previous round

| ID  | Decision                                                                                                                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D4  | Use narrow sender capabilities. Global history, export, deletion, settings, and tab organization remain trusted-workspace operations. The new workflow additionally requires a page-scoped annotation read/subscription route: the background derives the page identity from the sender, rather than accepting an arbitrary history query from a content script. |
| D5  | Retain executable native JavaScript schemas, add precise request/reply types, and enforce agreement with contract tests. Preserve CLI/MCP shapes.                                                                                                                                                                                                                |
| D6  | Transactional forward-only migrations. New code rejects unknown future schema versions; existing older releases cannot be retroactively guarded. Downgrade compatibility is unsupported.                                                                                                                                                                         |
| D7  | Benchmark 10,000 selections / 50,000 completed runs, plus a 100,000-run stress case. These are test targets, not limits. Keep completed runs until explicit deletion; no automatic pruning. R5 also retains incomplete attempts and available partial text until explicit deletion.                                                                              |
| D8  | Disable edits during Save. During provider tests freeze the tested provider configuration, permit unrelated reading-preference edits, and retain Stop. Switching profiles hides revealed keys.                                                                                                                                                                   |

D4's page-scoped read is necessary to render saved explanations; it does not grant general database access to content scripts.

## Concrete design

Separate three concerns:

1. **Saved passage:** page identity, exact selected text, surrounding text, text-position/DOM hints, bookmark and viewed state. It is created durably before a provider request is acknowledged as queued.
2. **Explanation job/run:** passage ID, attempt ID, immutable prompt/context and non-secret provider configuration, execution status, result and failure information. Regeneration creates a new run for the same passage. Keys remain in trusted settings/runtime and are not exposed through annotation messages.
3. **Page attachment:** a reconstructed DOM Range, confidence/status of locating it, and the current visual marker. It is rebuilt on each visit; stored viewport coordinates are hints, not restoration authority.

Execution states: `queued → running → saving → completed`, with `failed`, `interrupted`, and `cancelled` as distinct outcomes. Incomplete provider output, including a length cutoff, uses `interrupted` with a structured reason. Being unseen is independent of completion. A previously completed answer remains available while a newer run executes or fails. Attachment states are separate: `attached`, `not-yet-present`, and `unresolved`.

The background validates submissions, resolves trusted settings and routes subscriptions. The existing offscreen document owns active model execution, with SQLite remaining in its dedicated worker. UI ports subscribe to jobs; losing a UI port does not abort one. Persisted job records, idempotent claims/commits, and reconciliation after runner loss prevent an interrupted job from masquerading as complete or being silently submitted twice. Remote and on-device queues have independent concurrency limits of two and one respectively.

This architecture must tolerate unexpected termination: Chrome documents service-worker shutdown and loss of in-memory globals. An offscreen document supports a separate document context but is not an always-running service outside Chrome. These constraints motivate persisted job state and an explicit restart policy. Sources: [service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen).

### Anchor restoration and rendering

Capture now uses the actual Range boundaries for normalized quote, prefix/suffix and text positions. Original selected text retains rendered line breaks. The old first-substring helper was removed.

Restore against a bounded normalized text map, verifying the selected quote and surrounding context before attaching. Keep original text/response bytes; normalization is for matching. URL identity must preserve content-significant queries and hash routes; canonical links alone do not prove two documents are equivalent. Page mutations should trigger bounded, throttled reattachment work.

Visual acceptance requires no text reflow, text replacement, font changes, animated markers, broken drag selection, or hijacked page links/buttons. Existing interactive content and unresolved overlaps need access through the page's annotation list. That list also provides keyboard access without making every word a tab stop.

Native CSS Custom Highlights passed the underline and hit-testing feasibility check in Chrome 153.0.8010.12. The renderer uses that API directly, without a layout overlay or compatibility shim; [raw capability evidence](benchmarks/rendering-capabilities.json) records the tested build. See the [CSS Custom Highlight specification](https://drafts.csswg.org/css-highlight-api-1/). This does not establish support in other browser builds.

## Accepted workflow decisions

| ID  | Decision                               | Accepted behavior                                                                                                                                                                                                                                                              | Tradeoff considered                                                                                                                                               |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Initial display after Explain          | Add a quiet pending underline and brief queued confirmation; do not automatically open a streaming card. Clicking the mark opens progress or the answer.                                                                                                                       | Opening a card immediately improves immediate feedback but occupies the reading area until dismissed.                                                             |
| R2  | Leaving the page and restarting Chrome | Keep work running through refresh, navigation and source-tab closure while the extension runtime remains available. After browser/runner loss, retain the request and mark uncertain work interrupted; require explicit Retry.                                                 | Automatic retry can repeat a provider request that already ran, consume more tokens, and send saved context later.                                                |
| R3  | Completion cues and return             | Show a short, coalesced completion toast on a visible source page, with View. Keep unseen results in a current-page list and Saul's unread count. Hidden-page completion updates the count; returning offers a summary. View alone triggers scrolling/opening.                 | Desktop notifications or opening cards/tabs automatically would interrupt other reading. An ephemeral toast alone is easy to miss.                                |
| R4  | Repeated text and changed pages        | Restore only the selected occurrence when its quote/context can be identified confidently. If ambiguous or gone, retain the answer in the library with a source-location-unavailable state.                                                                                    | Attaching to every same word or fuzzy nearby text risks putting an explanation on the wrong passage.                                                              |
| R5  | Incomplete answers and readiness       | Preserve available partial text as explicitly incomplete and retryable. Emit Ready only after successful provider completion and local commit. Bare EOF and output-limit truncation do not count as Ready; failed regeneration leaves the earlier completed answer accessible. | Treating a clean connection close as success tolerates more providers but can mislabel truncated responses. Throwing partials away loses potentially useful work. |
| R6  | Repeated Explain and multiple passages | Explain on an already-known occurrence opens/reuses its pending or saved result; Regenerate explicitly starts a new attempt. Different passages enqueue independently. Start with bounded execution: two remote requests, one on-device generation at a time.                  | Always regenerating repeats cost and creates duplicate annotations; unbounded parallelism can overload local models or provider limits.                           |

## Implementation slices and acceptance gates

| Slice                    | Scope                                                                                                                | Acceptance                                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Durable passages/jobs | Versioned schema, legacy completed-history migration, typed page/job operations, retry identity                      | Old responses/bookmarks preserved; interrupted migrations roll back; duplicate submission/commit cannot duplicate a run.                                            |
| 2. Independent execution | Offscreen-owned runner, bounded scheduling, explicit cancellation, completion classification, restart reconciliation | Reading elsewhere, card dismissal, refresh and source-tab closure do not cancel jobs; worker restart reconnects; actual runner loss has an honest terminal state.   |
| 3. Anchors and quiet UI  | Range-based context capture, restoration, markers, click viewing, completion/unread cues, View source                | Repeated terms resolve correctly, ambiguous matches remain unattached, refresh/revisit restore saved markers, native selection/links and page layout remain usable. |
| 4. Settings ownership    | Draft controller and provider-test hook; configuration captured for each submitted job                               | Later edits do not change a running job's prompt/model/endpoint; credentials stay associated with their origin; existing draft protections remain.                  |
| 5. Scale and closeout    | Real SQLite-WASM/OPFS measurements, query indexes, many-annotation page scenarios, runbook                           | Report measured results and limits; check page responsiveness, not just SQL latency; include automated and hands-on isolated-browser review.                        |

## Ownership and interfaces

These are implementation boundaries, not a requirement to introduce one abstraction per file.

| Area             | Responsibility                                                                                                                       | Expected code surface                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Contracts        | Discriminated request/reply and job-event types, runtime validators, sender capabilities                                             | Shared contract modules; `src/types`; background/offscreen receivers; existing native schemas and declarations |
| Persistence      | Versioned migrations, passage/run repositories, idempotent claims/checkpoints/commits, page-scoped queries and latest-success lookup | `src/storage`, `src/storage/db-worker.ts`, upgrade fixtures                                                    |
| Runtime          | Queue scheduling, immutable run inputs, provider result classification, cancellation and reconciliation                              | A job runner under `src/reading`; provider adapters; `entrypoints/offscreen/main.ts`; background as router     |
| Page integration | Precise capture, conservative text matching, page identity, attachment/marker lifecycle and input handling                           | `src/capture`; annotation modules under `src/reading`; content entrypoint                                      |
| Reading UI       | Job subscription, card visibility, page annotation list, queued/ready/error cues, source navigation and viewed state                 | `src/surface`; workspace/library integration; background tab navigation                                        |
| Settings         | One draft owner, explicit save state and a cancellable test controller                                                               | `src/app/Settings.tsx`, extracted hooks/reducer, existing settings storage format                              |

Content routes operate on the sender's page and its passages: submit, list/subscribe, read an associated result, stop/retry/regenerate an associated job, set its bookmark and acknowledge viewing. The background checks page ownership for every supplied passage/run ID. Content scripts do not receive provider keys or general database operations. Workspace routes retain global library/settings/tab access. Offscreen messages are accepted only from their intended trusted runtime callers; TypeScript annotations alone do not establish that trust.

## Invariants to implement and test

### Submission, cancellation and recovery

- A durable passage/run is created before the UI receives a queued acknowledgement; only then can generation be dispatched. If persistence fails, no provider request starts.
- Capture the selection, context, prompts, model and endpoint at submission. Later settings edits do not alter queued/running work. Provider credentials remain associated with that captured endpoint in trusted runtime memory, never in annotation payloads or persisted explanation records.
- Retransmission uses a submission ID; repeating an acknowledgement or completion is idempotent. Explain at an already-attached occurrence reuses the passage and its pending/saved result. Explicit Retry/Regenerate creates a distinct attempt.
- Persist partial output in bounded checkpoints and flush at terminal events. Unexpected process loss may lose the most recent uncheckpointed fragment; never claim byte-perfect recovery of an in-flight stream.
- Card dismissal, source-tab closure and subscriber disconnection do not imply Stop. Explicit Stop cancels a queued/running attempt. Once committing a completed answer starts, the save finishes; the UI reflects that boundary and does not falsely promise a rollback.
- Service-worker restart reconnects to an existing offscreen runner rather than starting duplicates. After actual runner/browser loss, reconcile unfinished records before scheduling anything; uncertain and unsent queued work remains retryable without automatic provider replay.
- A late event for an old attempt cannot alter the current card or newer run. A deleted passage cannot be resurrected by a late checkpoint/completion. Existing selection deletion and Clear All must cancel affected jobs and make late writes ineffective.

### Completion and history

- Adapters emit both text deltas and a classified terminal outcome. Malformed data, provider errors, transport EOF without completion, cancellation and output-length truncation cannot become a successful run.
- A recognized normal provider ending, readable output and successful local commit are all necessary for Ready. Where a compatible stream only supplies `[DONE]`, it can establish transport completion unless an explicit error/truncation reason was also received. Native on-device completion uses its adapter's normal terminal outcome; provider-specific limits remain a verification concern.
- Saving failure preserves available output and an actionable failure state, without a Ready cue. A retry must not silently duplicate a previously committed run if its acknowledgement was lost.
- Queries distinguish latest attempt from latest completed answer. Incomplete regeneration does not hide or overwrite the earlier answer; partial attempts remain explicitly labelled and inspectable.
- Viewed/unread state belongs to a completed run. Rendering an underline or dismissing a toast does not mark an answer read. Opening the answer acknowledges viewing; a later successful regeneration can become unread again.
- Legacy completed histories become saved passages without rewriting original responses/bookmarks. Treat migrated answers as already viewed so an upgrade does not announce the entire existing library as newly ready.

### Source restoration and quiet interaction

- Use actual Range boundaries for prefix/suffix and text positions, preserving original selected text and rendered line breaks. DOM paths and old screen coordinates cannot independently establish a match.
- Restore only within the same verified page identity and only when quote/context support an unambiguous occurrence. Do not merge pages merely because they declare the same canonical URL. Preserve queries/hash routes that distinguish content.
- Watch dynamic content with bounded, throttled work. A temporarily absent passage may attach once its text arrives; an ambiguous passage stays unresolved. Existing legacy anchors receive the same confidence checks.
- Pending, ready and incomplete markers are subtle, static underlines. Reading, drag selection and existing links/buttons keep their native behavior. Page annotations remain accessible through a keyboard-usable list when direct interaction would conflict with the page.
- No card opens automatically after submission or completion. Clicking a marker opens its progress/result. Toasts coalesce, never steal focus and never move the page. A user's View action can scroll to the passage and open its card; hidden-page completions remain discoverable through unread state.
- Source navigation from the library reuses a matching tab when possible or opens the stored source URL, then resolves the saved passage. Failure to locate the passage still opens the saved explanation with an honest unavailable-location state.

## Technical gates, not additional product questions

1. Prove quiet underlines and click hit testing in isolated target Chrome before selecting Custom Highlights versus a non-layout overlay. Verify multiline ranges, zoom/scroll, dark pages, overlapping selections, native links and keyboard access. Preserve host text DOM and layout whichever renderer is used.
2. Exercise the real offscreen/worker topology with a deterministic delayed provider: dismiss card, navigate, close source tab, refresh, restart only the service worker, and then separately destroy/recreate the offscreen runner. Assert provider request counts and persisted states, not just visible success.
3. Rehearse upgrades from supported legacy schemas with old histories, multiple runs, bookmarks and search indices; inject a migration failure and verify rollback. Verify new databases and reject unknown future schema versions.
4. Run scale cases against SQLite-WASM/OPFS and populated pages, reporting baseline/candidate timings, query plans, dataset sizes and browser/runtime versions. Measure repeated page-annotation lookup and rendering work as well as history pagination/export. Do not substitute host SQLite timing for extension measurements.
5. Finish with app/harness typechecks, formatting, focused unit/contract regressions, production build, complete local E2E suite and an isolated hands-on reading flow. Keep live-provider/on-device claims limited to providers/devices actually exercised.

All user-facing decisions are settled. Resolve routine engineering choices within this plan; reopen the interview only if an implementation finding would materially change the accepted behavior, data retention, external interfaces or compatibility guarantees.

## Implementation and independent review closeout

- `src/reading/runner.ts` owns queueing, checkpointing, terminal classification and recovery; the offscreen document owns its lifetime. `src/storage` owns typed, serialized operations and schema version 1. `src/contracts` validates page/workspace capabilities. Native JavaScript schemas remain authoritative with precise declarations and contract tests.
- `src/reading/anchors.ts` and `markers.ts` restore exact occurrences and paint native highlights. Restoration is throttled to avoid starvation under continuous DOM mutation. Maps are strictly capped at one million characters / 30,000 text nodes and truncated maps cannot authorize a match or partial capture.
- `useSettingsDraft` and `useProviderTest` separate draft ownership from cancellable tests without changing the settings storage format. The legacy streaming port, on-device bridge and legacy `window.ai` adapter were removed. The data migration preserves records; it does not preserve the obsolete runtime protocol.
- Independent review prompted fixes for source-open acknowledgement timing, persistence-failure retry, stale library attempt responses, stale captures after navigation, reused Explain requests, SPA subscription renewal and renderer mutation/boundary cases. These are covered by focused unit or browser regressions. No additional product decisions remain open.
- The benchmark report covers 10,000 passages with 50,000 and 100,000 runs in real SQLite-WASM/OPFS, plus 100/1,000 annotations in a populated DOM. These are measured fixtures, not supported-size or latency guarantees. Limits and reproduction commands are in the testing runbook.
