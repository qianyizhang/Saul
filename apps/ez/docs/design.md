# Shared design adoption

EZ and Saul use **Little Clarity**, a portable Google Labs DESIGN.md contract.
EZ supplied its visual baseline: a green accent, serif subjects, system controls,
quiet surfaces, and a spacious reading area. Native system surfaces remain native.

The single authoring source is [DESIGN.md](../../../DESIGN.md); the application
workflow is [feature UI review](../../../design/SKILL.md#feature-ui-review).
`Sources/EZ/DesignTokens.swift` records the exact source SHA-256 and is generated;
`AppStyle.swift` connects its roles to the app. Do not hand-edit generated tokens.
The compiled app and ordinary Swift checks require no JavaScript runtime or sibling checkout.

From the monorepo root (Node 24 and installed pinned dependencies):

```sh
pnpm design:generate
pnpm design:check
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

## Feature UI review

Follow the shared [feature UI review](../../../design/SKILL.md#feature-ui-review)
for new features and changes to forms, metadata, actions or disclosures. Map the
user’s task and information hierarchy before editing. Verify the affected main
window, Quick Lookup and Settings states through [native UI journeys](ui-qa.md),
including filled fields, long/missing values, errors and both presentation modes.
Keep screenshots outside Git and record evidence limits in [verification](verification.md).

## Min Mode

Min Mode follows the shared [expert everyday policy](../../../DESIGN.md#min-mode).
It is local to EZ, shared by the main window and Quick Lookup, and defaults on.
Settings → Preferences and Quick Lookup’s menu expose the same preference.
Routine subtext and redundant icon/text pairs disappear. Short action words retain
complete accessible names and help. Errors, blocked choices, unsaved answers and
recovery actions remain visible. Help-only disclosures, documentation links and gray
explanatory paragraphs are absent in Min Mode. Accounts uses one aligned action row;
History places its title and Reveal action on the same row.

Settings uses native sidebar sections: Overview, Models, Recipes, Preferences,
Accounts and Shortcuts. Models and Recipes share one mounted draft owner but show
one editor at a time; navigating sections preserves both drafts. Switching the
selected item still requires saving or explicitly discarding its edits. Overview
shows current recipe/preset/account state and routes to the relevant editor.

A saved answer prioritizes Copy. Min Mode puts Reuse, Export and Delete in More,
and input/output inspection inside Details. Edit reveals the retained draft; Hide
returns to reading. Standard view retains the longer action names and guidance.
The compact preset selector omits the routine Standard suffix; requested Fast
remains explicit, and complete recorded choices remain in Details.

## Offline previews

`make surface-preview` builds `dist/EZ Surface Preview.app` from production views.
It uses disposable offline storage, blocks account/inference actions, and does not
register the global shortcut. Choose empty, multi-input, answer, streaming, blocked,
or no-recipes fixtures; toggle Min Mode, open its actual Quick Lookup panel,
and inspect light/dark, resizing, preset overrides, and main-window handoff.
**Minimum panel** applies the
current state's minimum size. Fixture streaming is simulated. All three preview
targets use `scripts/preview.sh`, which stages and verifies each bundle before replacement.
The [surface contract](surfaces.md) governs which controls belong in each surface.

For failure recovery, launch the same surface preview with `--unsaved-attempt`.
This explicit mode uses a synthetic provider, fails its first terminal save and
allows Save again against disposable history. It does not connect to an account
or the network. Ordinary preview mode still blocks Send. Inspect the Unsaved
notice in the main window and Quick Lookup, including its Save error disclosure,
Copy/Export access, successful Save again and retained draft after navigation.

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
Settings sections use a native sidebar. The offline surface preview
includes **Selector hitboxes** with long names and one-character alternatives.

## Native regression review

Use the [fixed UI journeys](ui-qa.md) for first-run, composition, history, settings,
long forms, recovery, and light/dark review. The main window gives selected answers
reading space and reveals the current draft through **Edit**; **Hide**
returns to reading. Preset/request details are progressive disclosures. Form hints
reserve a stable line, and Tab navigation scrolls the focused field into view.
The surface preview includes a **Signed out** fixture and resets search with each
fixture so one scenario cannot hide the next scenario's history.

## Prose corrections

Long passages use body typography, never a full-page subject heading. Completed
Spell Check answers with an explicit corrected-text or changes heading offer an
Original / Corrected comparison. Removed text uses a warm tint and strikethrough;
added text uses the shared green and underline. Labels make color nonessential.
Two readable columns share one scroll area at wider widths. Corresponding paragraphs
and list items occupy shared, top-aligned rows whose height follows the taller side;
paragraph splits and merges stay together, and unmatched paragraphs leave an empty
opposite cell. Narrow windows and Quick Lookup show Corrected first with Original
in a disclosure. Explanatory notes sit under Why these changes. Unrecognized responses keep the ordinary answer view
with long original text collapsed. In Min Mode, the literal full response remains in Details → Inspect on both lookup surfaces. Standard Mode also exposes the main-window inspector directly.

Disclosure headers use a shared full-width button with a minimum 32-point height.
The chevron, label, and remaining header space all toggle expansion; the expanded
content remains independently selectable and interactive. Native button keyboard
activation and an accessible Expanded/Collapsed value accompany the visual state.

## Metadata readability

Answer Details uses a stable label/value column, primary-text values, and compact
three-column token and timing groups. Unknown metrics use a dash; unreported
service tiers say Not reported. Long identifiers wrap. The main composer’s information
button describes Next lookup only; Quick Lookup opens Answer details whenever an
answer is selected, with Next lookup collapsed in both presentation modes. Standard view's footer keeps first-text and total time in
plain language; full token counts and throughput remain in Details. Both native
surfaces share the same layout and full-row disclosures.

Multi-input recipes retain a label above each field after typing; single-input
recipes keep the compact placeholder. Fixed shortcut references use aligned
label/value rows too. The offline preview includes Long metadata and Legacy
answer fixtures for wrapping and unavailable-data review.
