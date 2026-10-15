# Shared design adoption

EZ and Saul use **Little Clarity**, a portable Google Labs DESIGN.md contract.
EZ supplied its visual baseline: a green accent, serif subjects, system controls,
quiet surfaces, and a spacious reading area. Native system surfaces remain native.

The single authoring source in this local two-repository setup is
`../Saul/DESIGN.md`; the application workflow is `../Saul/design/SKILL.md`.
`Sources/EZ/DesignTokens.swift` records the exact source SHA-256 and is generated;
`AppStyle.swift` connects its roles to the app. Do not hand-edit generated tokens.
The compiled app and ordinary Swift checks require no JavaScript runtime or sibling checkout.

From the Saul checkout (Node 24 and installed pinned dependencies):

```sh
node design/generate.mjs --swift ../ez/Sources/EZ/DesignTokens.swift
node design/generate.mjs --swift ../ez/Sources/EZ/DesignTokens.swift --check
```

After regeneration, run EZ's `make format` and `make check`, then inspect the built
native app. `make design-preview` builds a separate offline app from the production
view sources, with temporary fixture history and no authentication connection or
global shortcut registration. Open `dist/EZ Design Preview.app`; its outer controls
switch between main/settings and light/dark appearance. The production controls
are disabled in this visual fixture. Shared token changes need rendered review in
both products. Native controls and task density may differ; preserve the contract's
content/action roles.
The generator and contract travel together when the design kit is moved or versioned.

`make surface-preview` builds `dist/EZ Surface Preview.app` from production views.
It uses disposable offline storage, blocks account/inference actions, and does not
register the global shortcut. Choose empty, multi-input, answer, streaming, blocked,
or no-recipes fixtures; open its actual Quick Lookup panel and inspect light/dark,
resizing, preset overrides, and main-window handoff. **Minimum panel** applies the
current state's minimum size. Fixture streaming is simulated. All three preview
targets use `scripts/preview.sh`, which stages and verifies each bundle before replacement.
The [surface contract](surfaces.md) governs which controls belong in each surface.

The initial adoption also makes answer metadata and composer hints readable at the
shared caption size. Quick Lookup uses the shared accent and a compact recipe-first
layout. The answer boundary shows a yellow light while waiting and transitions to
green on a reasoning-item event: a smooth 3.2-second round trip, at most 84 points wide, with a 2-point core and 3-point glow.
Reduce Motion replaces travel with a stationary light. The effect occupies the
existing divider and stops permanently once answer/refusal text arrives, or when
the lookup terminates; generation spinners are omitted. Hidden Quick Lookup panels remove the animated view. These are EZ-specific motion values,
implemented in `ThinkingDivider`, using the shared accent role.

Lookup dropdowns use stable-width native popup buttons with the entire control
available for click and hover scrolling, independent of title length. The compact
header recipe control fills its available space; the footer preset control stays
250 points wide and has an adjacent information button for request details.
Settings sections use a fixed-width segmented control. The offline surface preview
includes **Selector hitboxes** with long names and one-character alternatives.

## Native regression review

Use the [fixed UI journeys](ui-qa.md) for first-run, composition, history, settings,
long forms, recovery, and light/dark review. The main window gives selected answers
reading space and reveals the current draft through **Edit draft**; **Hide draft**
returns to reading. Preset/request details are progressive disclosures. Form hints
reserve a stable line, and Tab navigation scrolls the focused field into view.
The surface preview includes a **Signed out** fixture and resets search with each
fixture so one scenario cannot hide the next scenario's history.
