# Applying Little Clarity

[DESIGN.md](../DESIGN.md) is the single authored identity. Its YAML gives exact
values; its prose defines hierarchy, component use, surface adaptation, and motion.
The [apply-design skill](../design/SKILL.md) is the reusable agent workflow.

## Generate and check

Use Node 24 and the pinned pnpm version:

```sh
pnpm design:generate
pnpm design:check
# Local EZ adoption, while these projects remain separate checkouts:
node design/generate.mjs --swift ../ez/Sources/EZ/DesignTokens.swift
node design/generate.mjs --swift ../ez/Sources/EZ/DesignTokens.swift --check
```

The parser/linter is pinned at `@google/design.md@0.4.0`; the upstream format is
alpha. Source SHA-256 receipts accompany all generated assets. Formatting or
editing the contract requires regeneration, including EZ when its styles change.
`pnpm check` checks the Saul artifacts; the explicit Swift check verifies the sibling
consumer without making either project's ordinary build depend on the other checkout.

## Surface adapters

| Surface                                                          | Adapter                                                            | Density            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------ |
| Popup, library, settings, tabs                                   | Generated CSS via `assets/tailwind.css`, semantic workspace styles | Compact or reading |
| Selection trigger, card, concept notes, page list, notifications | Same CSS scoped through the shadow root                            | Compact reading    |
| Page underlines                                                  | Generated TypeScript palette, native CSS Highlights                | Host page          |
| Codex MCP tab board                                              | Generated CSS inlined with board styles                            | Dense              |
| EZ main window and settings tint                                 | Generated SwiftUI roles through `AppStyle`                         | Native reading     |

Web appearance follows system preference; the MCP host's explicit light/dark
choice takes precedence. Paired `-dark` colors provide the appearance mapping.
The native app keeps system backgrounds and controls. The adapter maps web px
values to native points and system font roles, without adding a runtime dependency.

## Adopt in another project

Carry the contract and `design/` directory together, install the pinned parser and
Prettier in the kit's owning project, and invoke the generator with explicit source
and output paths. Connect the generated values to the target's existing components;
the generator does not rewrite arbitrary applications. Link the contract/workflow
from its `AGENTS.md`, record the design version, and add output drift checks to its gate.

Review real light/dark, narrow/wide, populated, loading, error, focus, and tooltip
states. Confirm readable text, preserved actions, no overflow, and reduced-motion
behavior. Keep platform differences intentional. Contrast warnings reject generation;
an orphan-token notice is informational for this adapter because tokens also have
direct CSS/Swift consumers outside the document's component examples.

## References

- [Google Labs DESIGN.md specification](https://github.com/google-labs-code/design.md)
- [DTCG token format](https://www.designtokens.org/tr/2025.10/format/)

Runtime personalization and richer VFX remain future work. The first release provides
an editable contract, deterministic generation, platform adaptation, and agent-led review.

Initial adoption evidence is recorded in [design verification](design-verification.md).
The scoped native preview covers main/settings and builds from a clean checkout.
Quick Lookup and configuration feature work remain separate from the design commits.
