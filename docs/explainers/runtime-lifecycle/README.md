# Saul runtime and lifecycle explainer

[Open the local explainer](index.html).

## Outcome and scope

Requested reading guide for the current helpers, bridges and runners, their exact
names, execution locations, start/stop/restart rules, persistence and the proposed
user-action host. Includes a containment map, lifecycle scenarios, summary sequence
and source links. Map buttons open native HTML popover cards in place. Each card
shows short start/stop/recovery facts, with technical limits and sources in a
secondary disclosure. CSS radio controls switch lifecycle scenarios. The page
executes no scripts, model calls or background work.

The proposed action helper now sits inside the same Local Node programs group
as the existing ChatGPT and tab helpers, marked not implemented. The helper is
the process; the user module loads inside it. Its overlay explains input/output, ownership,
credential access and draft call/reload/stop/reuse contracts. Host lifecycle and child-process rules are labelled as open at the survey baseline. The separate proposal
section was removed so this information has one home. This changes the explainer
only; no action host or executable contract is implemented.

The map's Create & reload overlay explains the proposed prompt-to-action journey:
generate a fixed-format candidate through the existing plan account, stage and
check without execution, offer Load/Replace, load an approved revision in a fresh
Node worker, then switch future runs only after readiness. Active runs keep the
old revision; loading does not invoke the handler. Code validity is distinct from
trust, and initialization side effects are not claimed to be reversible. This
journey and worker design describe the survey proposal; the separate hot-reload
implementation owns their executable contracts.

The simplification follows `practices/ui-ux.md` and the Communication rules in
`AGENTS.md`: one home for each fact, short sentences, and details after interest.
The duplicate inventory and lifecycle table were removed. Total visible and
disclosed prose initially fell from 3,670 to 2,174 words, before adding the requested
action-host contracts. Modern browser Popover support is
required; native controls handle Escape, outside-click dismissal and focus return.

Source baseline: `dc724fcf7cbd27cf7baec5c9aa1f2540099d2b40`, reviewed 2026-10-29.
This includes the committed PDF flow, standalone board and EZ Quick Lookup.
The separate in-progress action-host implementation is excluded. This is not a claim about
installed/running versions. The page embeds a snapshot of the generated Little
Clarity CSS tokens; it stays aligned with the root design owner rather than
introducing a separate theme.

## Verification

- Offline HTML checks passed: balanced structure, 43 unique IDs, 48 links,
  17 labelled popovers with matched open/close controls, four labelled radio
  choices, matching scenario selectors, and responsive CSS. All 24 checked
  light/dark text-color pairs meet 4.5:1 contrast. This does not establish rendered
  accessibility. No executable content or runtime asset requests are present.
- Prettier formatting passed for both bundle files with the pinned Node 24 runtime.
- Repository Markdown link/heading checks passed (42 documents).
- Closeout review on 2026-10-29 used the repository's disposable Chrome harness.
  Light/dark views at 390 px and 984 px had no page overflow; all 17 native popovers
  opened and dismissed with Escape without internal overflow. Screenshots were
  reviewed. The earlier in-app browser could not open the local file; that route
  remains separate from the browser-harness check. Scenario switching and
  assistive-technology acceptance were not established by this closeout.
- The original survey changed no application source and ran no application builds/tests. This
  survey does not establish provider behavior, current installation state or
  native-host/extension runtime acceptance.

## Retention and ownership

This bundle is the requested deliverable, retained as a repository reading guide.
Keep `index.html` and this manifest together. Refresh when the named runtime owners
or installation layout change; retire or replace the guide when superseded.
Temporary review captures belong under root `.artifacts/saul/runtime-explainer/`
and are disposable after review. No personal credentials, history or installation
metadata were copied into the bundle.

## Documentation corrections

- [Saul architecture](../../../apps/saul/docs/architecture.md) describes the retained
  Chrome on-device path without marking it disabled. The executable
  [flag](../../../apps/saul/src/models/chrome-ai.ts) is false and the
  [product guide](../../../apps/saul/docs/product.md) already states the restriction.
  **Resolved in this closeout:** the architecture now states that the retained
  adapter is disabled by `CHROME_AI_ENABLED`.
- Earlier during inspection, architecture described scripting capture and product
  text described loaded page text, while local [capture](../../../apps/saul/src/digest/capture.ts),
  [source](../../../apps/saul/src/digest/source.ts) and
  [PDF](../../../apps/saul/src/digest/pdf.ts) owners also download/extract PDFs in
  offscreen. Proposed correction: document the split, limits and fetched-versus-viewer
  caveat. **Resolved by concurrent edits before handoff:** both architecture and
  product now document those details. No existing file was changed for this survey.

- The explainer originally described local PDF extraction without naming its
  opt-in setting. It now follows `captureSummarySource`: PDF URL attachment is the
  default, local extraction is optional, and provider errors never switch modes.

Method: the user-invoked `show-me` skill; prose and diagrams are newly authored for
this guide. No third-party code, image or skill text is embedded.
