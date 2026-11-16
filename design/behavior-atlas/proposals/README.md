# Accepted journey comparisons

> **Historical design studies — not maintained.** Preserve these comparisons and
> their baseline evidence. Current behavior belongs to [Saul product](../../../apps/saul/docs/product.md),
> [EZ surfaces](../../../apps/ez/docs/surfaces.md) and current source. See the
> [historical-reference policy](../../../docs/artifacts.md#historical-references).

All three proposals were accepted and implemented. Renderer
source remains unchanged. The comparisons below preserve the design study against
source `0a949cf`; the parent maps record the post-change survey.
The [six snapshot maps](../README.md) remain separate. These smaller models put
one decision in Comparison mode with shared start/end states, independently
scrubbable branches and both app/map views. Every new edge is `proposed: true`.

## Review method and findings

Reviewed all 61 original authored journeys before proposing these changes. Rank by the user's effort to find the next
action, keep context and recover work, not raw graph length. System checkpoints,
optional Cancel visits and retry loops are not avoidable clicks. Source facts are
verified below; their user impact is a design judgment, not measured usability.

| Priority                                   | Baseline route and problem                                                                                                              | Accepted change                                                                                                                                    | Trade-off / decision                                                                                                                                                                                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 · [EZ retry](ez-retry.json)              | Failed request → More → Reuse → draft → Run. “Reuse” is an indirect recovery cue, and the draft adds a stop when no edit is wanted.     | Put **Retry same request** beside failure. Keep Reuse for editing. Three deliberate Min Mode controls become one.                                  | A retry is another explicit model request. Retain the old output and validate saved input, preset and connection identity. Never confuse this with storage-only Save again. Implemented for failed/stopped text and image requests in both windows.                |
| 2 · [Saul stale draft](saul-conflict.json) | Save blocks → Reload → discard confirmation → re-enter edits → Save. The draft is protected initially, but normal recovery discards it. | **Review latest** retains the draft. Show original/current/local values, explicitly reapply the chosen edit, then Save against the fresh revision. | Larger implementation. No silent merge or overwrite. The fixture shows one non-overlapping name edit. Same-field conflicts require a choice; uncertain commits require reconciliation before retry. The benefit is preserving work, not a bulk click-saving claim. |
| 3 · [Saul read now](saul-open.json)        | Select → Explain → Waiting → View. Saved reuse opens immediately, while a new answer requires another View action.                      | Rename the pointer action **Explain & open** and open after acceptance. Keep existing keyboard queuing quiet.                                      | Earlier opening covers content, so invocation defines intent: pointer opens text/image progress, keyboard queues quietly. Completion never reopens the card.                                                                                                       |

### Baseline evidence and ownership

The descriptions and line numbers in this section refer to `0a949cf`, before
implementation. The parent maps retain the post-change survey and its source anchors.

- EZ's Min Mode menu owns Reuse in
  [ContentView.swift](../../../apps/ez/Sources/EZ/ContentView.swift), lines 243–252.
  [AppModel.swift](../../../apps/ez/Sources/EZ/AppModel.swift), lines 508–535 and
  599–633, separately owns Run and restoring the saved request as a draft.
  [AttemptExecution.swift](../../../apps/ez/Sources/EZCore/AttemptExecution.swift)
  must continue saving pending input before generation. The proposal is not
  shorthand for bypassing validation or blindly resending a current draft.
- Saul's `apps/saul/src/app/useSettingsDraft.ts` (historical source at the recorded baseline),
  lines 104–156, blocks stale/uncertain saves and confirms replacement on Reload.
  [Settings.tsx](../../../apps/saul/src/app/Settings.tsx), lines 1007–1025, exposes
  Reload while keeping Save disabled. Proposed read/review/reapply stays in this
  draft owner; the trusted commit still checks the current revision.
- Saul's [SaulRoot.tsx](../../../apps/saul/src/surface/SaulRoot.tsx), lines 286–325,
  opens reused work but shows Waiting for a new submission.
  [FloatingTrigger.tsx](../../../apps/saul/src/surface/FloatingTrigger.tsx), lines
  63–71, labels the button Explain. The
  [reading contract](../../../apps/saul/docs/product.md#reading) explicitly chooses
  quiet queuing. Proposal 3 intentionally challenges only the pointer entry; it is
  not a discovered code/documentation mismatch. The implementation revised that
  contract and entry handler together. Close remains authoritative after completion.

## Corrections and things to keep

- **Corrected model-only detours:** EZ Settings already has direct sidebar
  navigation from Overview to Actions, Connections and Preferences. The earlier
  `ez-settings.json` journeys unnecessarily visited Presets first. Added the
  actual edges and shortened those three authored routes, grounded in
  [SettingsView.swift](../../../apps/ez/Sources/EZ/SettingsView.swift), lines 56–68.
  This fixes an IR/source mismatch; no product shortcut is being proposed there.
- **Keep:** Calls' saved-result resolution before automatic execution; explicit
  Save and select before activating custom code; the distinction between Generate
  and Play for speech; delete/dirty-discard confirmation; Stop waiting for workers;
  closing a view without cancelling work. Their extra states carry useful intent
  or recovery boundaries.
- **Do not infer:** the existing atlas groups some menu actions and simplifies
  concurrency. It is insufficient for measured task-time, field-entry counts or
  claims that every control is represented. No native/live usability session was
  run for this review.

## Build and review

The parent [regeneration instructions](../README.md#regenerate) build the snapshot
maps and these comparisons together. Open one and choose **Comparison**;
click shared timeline stops to align both views,
or scrub each branch separately. **Map major** reveals which stops are bypassed;
**App major** shows the relevant controls and fixed values. The repository catalog
links all three pages. Accepted scope includes text/image Retry in both EZ windows,
field-level Settings recovery, and pointer-open / keyboard-quiet behavior for text
and images.

Validation: all six current/proposed routes replay to matching endpoints. Proposed
edges stay unavailable in Exploration. Read failure, review cancellation and a
second stale save return to the retained draft in the modeled recovery paths.
Browser checks covered all three comparisons, independent branch controls, shared
stop alignment, keyboard scrubbing and the map/app switch. This verifies the
discussion scaffold and IR; application verification is separate.
