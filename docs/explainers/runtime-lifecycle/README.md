# Saul runtime and lifecycle explainer

> **Historical explainer — not maintained.** Diagrams, examples, technical details
> and checks describe the recorded survey and updates below. They are not a current
> runtime specification. Use [Saul architecture](../../../apps/saul/docs/architecture.md),
> [shared architecture](../../architecture.md) and current source for today's behavior.
> See the [historical-reference policy](../../artifacts.md#historical-references).

[Open the local explainer](index.html).

## Outcome and scope

Reading guide for the helpers, bridges and runners: their execution locations,
start/stop/restart rules, persistence and user-action lifecycle. The HTML includes
a containment map, lifecycle scenarios, a summary sequence and source links.
Native HTML popovers disclose details; the page executes no scripts, model calls
or background work.

The action helper is implemented. It stages and checks candidate revisions,
loads an explicitly selected revision in an isolated worker, and retains the
active revision for in-flight runs. Loading is distinct from invoking a handler.
Shared history is owned by the native SQLite helper; browser OPFS is used only
for one-time import. The HTML already reflects those ownership changes.

The original survey baseline was `dc724fcf7cbd27cf7baec5c9aa1f2540099d2b40`
(2026-10-29). The guide has since been updated for implemented actions and shared
history. Historical checks below describe their recorded source, not current
installed or running versions. Living runtime documentation is in
[Saul architecture](../../../apps/saul/docs/architecture.md) and
[shared architecture](../../architecture.md).

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

This requested deliverable is retained for its historical analysis and provenance.
Keep `index.html` and this manifest together; do not update its diagrams, examples
or technical details to match later runtime or installation changes.
Temporary review captures belong under root `.artifacts/saul/runtime-explainer/`
and are disposable after review. No personal credentials, history or installation
metadata were copied into the bundle.

## Recorded scope

Chrome on-device AI is retired. Old saved selections are readable and reject
execution until the user chooses an available provider. The map describes the
remote provider routes; it does not establish live-provider acceptance.

Method: the user-invoked `show-me` skill for the original survey. No third-party
code, image or skill text is embedded.
