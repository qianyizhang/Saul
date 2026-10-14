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
layout. Motion guidance includes
reduced motion; richer VFX are future work.
