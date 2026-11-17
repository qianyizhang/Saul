# Saul / EZ behavior atlas

> **Historical snapshot — not maintained.** Models, comparisons, source anchors
> and recorded checks describe the baseline below, not current behavior. See
> [Saul product](../../apps/saul/docs/product.md), [EZ surfaces](../../apps/ez/docs/surfaces.md)
> and current source for today's behavior. Retention and future reconstruction
> follow the [historical-reference policy](../../docs/artifacts.md#historical-references).

Source-derived, fixed-fixture journeys for reviewing the product at that baseline. Six JSON
models contain 168 states, 261 transitions and 66 named journeys. The reusable
repo-kit scaffold owns validation, rendering and interaction; these files own
Saul/EZ facts. The six maps include the three accepted changes; scaffold source
remains unchanged.

Source: the code accompanying this IR, based on
`0a949cf12f226a63b0db6244f9fc2a1e3fef78d1` plus the accepted journey changes.
Source anchors were reviewed on 16 November 2026. This describes source behavior,
not the installed application revision.
Renderer: repo-kit `4914a3698c673ccbd644f9f133e64ef525e3f8a9`.

## Review scopes

| IR                                   | Journeys | Main questions                                                                                                                              |
| ------------------------------------ | -------: | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [EZ lookup](ez-lookup.json)          |       11 | Run, stop, initial-save blocking, save-only recovery, follow-up, history, Quick Lookup handoff, export and delete.                          |
| [EZ images](ez-images.json)          |       10 | Illustration/GIF, Make meme, sketch handoff, retained source, missing source and image-save recovery.                                       |
| [EZ settings](ez-settings.json)      |        9 | Presets/actions, dirty dismissal, reload/recovery, invalid preset repair, connections, Min Mode and speech preview.                         |
| [Saul reading](saul-reading.json)    |       13 | Select/Explain/View, saved reuse, current-input rerun, frozen retry, close versus stop, follow-up, image-save recovery and passage history. |
| [Saul Calls/window](saul-calls.json) |       11 | Capture, automatic start, saved reuse, frozen retry, stop, inspection, background completion, export/delete and tab grouping/undo.          |
| [Saul settings](saul-settings.json)  |       12 | Stale-save blocking, dirty navigation, connections, custom Call build/check/load/restore and speech playback.                               |

Start with the first journey in each map. Other journeys emphasize failure and
recovery, including repeat visits. Journey enables only its next step; Exploration
enables modeled outgoing transitions and pauses at meaningful outcomes. App major
is operable with a passive map; Map major reverses that relationship. **N** toggles
all names / nearby names. Inspect a distant landmark to read its source and detail.
These six snapshot maps contain implemented transitions. Three separate
[comparison studies](proposals/README.md) preserve the original accepted designs
against the pre-change baseline. Their links remain in the catalog.

## Interpretation and limits

- These are code-backed behavioral projections, not live app captures or pixel
  replicas. Fixed fictional content replaces accounts, history, keys and input.
  System actions simulate possible outcomes; they do not call providers or write
  product data. Some checkpoints expose persistence steps inside one real action.
- Each state and transition cites a repository-relative source file and line.
  Read them at the same revision as the IR. Guards, concurrent contexts and all field
  values are not exhaustively enumerated. Each model states its fixture conditions
  and omitted branches in **Coverage & source**.
- Compound labels include menu/section navigation. Transition counts are useful
  for comparing the same model, but are not measured user click counts. A terminal
  state ends this review scope; it does not mean the application exits.
- Model geometry groups navigation contexts and route/recovery neighborhoods.
  Coordinates imply neither time nor rank. Explicit layout hints avoid the default
  layout's crowding on these loop-heavy graphs. The two Settings maps exceed 30
  states and retain the scaffold's scrollable full map; App major keeps a full
  overview in the companion. Labels are shortened on the map; fixture titles and
  inspection retain their meaning.
- Saul text-save recovery can persist a failed record before a fresh explicit
  attempt. EZ **Save again** and Saul **Retry saving image** are storage-only.
  Closing a card, reader or Quick Lookup is distinct from stopping its request.
  Pointer-triggered Explain & open / Illustrate & open show the accepted request.
  Keyboard requests stay quiet, including saved reuse.

These additional surfaces were identified but are not expanded into journeys:

| Area                 | Source owner                                                                                                                                                      | Missing projection                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| EZ launch/access     | [Quick Lookup](../../apps/ez/Sources/EZ/QuickLookupController.swift), [shortcuts](../../apps/ez/Sources/EZ/ShortcutSettingsView.swift)                            | Shortcut/accessibility setup, Services/Raycast entry, every hidden-window and concurrent combination.                  |
| EZ native editing    | `apps/ez/Sources/EZ/GenerationState.swift` (historical source at the recorded baseline), [connections](../../apps/ez/Sources/EZ/ConnectionsView.swift)            | Every drawing operation, native file-picker branch, provider/model option and credential failure.                      |
| Saul reading/history | [reading owner](../../apps/saul/src/reading/runner.ts), [library](../../apps/saul/src/app/Library.tsx)                                                            | Every selection/positioning control, history filter, copy action and multi-request combination.                        |
| Saul Calls/window    | [runner](../../apps/saul/src/digest/runner.ts), [Call execution](../../apps/saul/src/calls/execution.ts), [tabs](../../apps/saul/src/app/Tabs.tsx)                | Mixed multi-tab outcomes, PDF paths, MCP tab-board proposals and detailed tab edits.                                   |
| Saul settings/setup  | `apps/saul/src/app/useSettingsDraft.ts` (historical source at the recorded baseline), [credential settings](../../apps/saul/src/app/SharedCredentialSettings.tsx) | Standalone credentials, invalid-record reset, helper installation, preferences/notifications and all provider options. |

## Regenerate

Use Node 24.21+ and the pinned repo-kit scaffold. From this repository root, choose
a **new** output bundle; the generator refuses to replace an existing destination.
The paths below reproduce the review structure in a fresh bundle:

```sh
ATLAS_OUT=.artifacts/shared/behavior-atlas/new-review
python3.12 ../repo-kit/skills/ui-discussion/scripts/scaffold_atlas.py \
  --target "$ATLAS_OUT/scaffold"
mkdir -p "$ATLAS_OUT/proposals"
for model in design/behavior-atlas/*.json design/behavior-atlas/proposals/*.json; do
  relative=${model#design/behavior-atlas/}
  node "$ATLAS_OUT/scaffold/build.ts" --input "$model" \
    --out "$ATLAS_OUT/${relative%.json}.html"
done
# Keep repository documentation links valid from this four-level output path.
sed 's|href="../../|href="../../../../|g' design/behavior-atlas/catalog.html > "$ATLAS_OUT/index.html"
python3.12 -m http.server 0 --bind 127.0.0.1 --directory .
```

Open `/.artifacts/shared/behavior-atlas/new-review/` at the printed local server
address. Serving the repository root also makes the documentation links available.

These commands reproduce the retained models; they do not reconstruct current
behavior. Do not edit the snapshot IR or refresh its anchors, comparisons or
renderings. For a new review, derive behavior from current source under the
historical-reference policy above. Generated output and screenshots follow the
[artifact policy](../../docs/artifacts.md).

## Validation

All six models passed the scaffold schema/build checks. All 66 journeys replayed
through the public controller: 346 transitions, enabled next steps and completed
endpoints. Each frame rendered deterministically with the full fixed node set.
All 429 state/transition source references resolved to existing lines. These
checks establish model consistency, not installed-app or live-provider behavior.
The review bundle records browser checks and its finite retention date.
