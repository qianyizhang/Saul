---
name: apply-design
description: Extract, refine, or apply a portable DESIGN.md visual identity to an existing project, generating platform tokens and verifying adapted surfaces. Use for adopting a shared design across projects; preserve product behavior and platform conventions.
---

# Apply a portable design

Read the target views, styles and current design guidance. Little Clarity's
[design guide](../DESIGN.md) owns presentation rules; [tokens.md](tokens.md)
owns platform style values and [symbols.json](symbols.json) owns shared control
symbols. Review rendered screens before changing visual behavior.

A portable design can also carry its tokens as YAML frontmatter or fenced
YAML in a Google Labs DESIGN.md document. Use that document's guidance to
adapt the target, and preserve prose when editing it.

## Feature UI review

Apply this sequence to new features and to changes in labels, forms, metadata,
actions or disclosures. Keep the review in the existing task and design owners;
a separate design document is needed only for a new reusable decision.

1. **Frame the task.** Inspect the current rendered surface. State who is using it,
   what they need to decide or do, and which answer/draft/configuration the UI
   describes. List the affected sibling surfaces and meaningful states before coding.
   Done when the default view and primary action are unambiguous.
2. **Budget the information.** Assign each fact or control to the default view,
   a named disclosure, or Settings. Remove duplicates; label values and units;
   keep editable fields identifiable after filling. Use an existing shared pattern
   where its semantics match. Done when every visible element supports a decision,
   action or necessary status and the first read works without explanatory prose.
3. **Exercise the result.** Inspect actual native views or the built browser UI,
   including populated/long content, missing data, active/error states, narrow/wide,
   light/dark and each affected presentation mode. Click the whole disclosure row,
   follow keyboard focus, and check overflow and draft preservation. Use safe fixtures
   for mutations. Compare the complete screen with its sibling surfaces, not only
   the changed component. Done when every affected state has evidence or a named limit.
4. **Close the findings.** Fix observed confusion, crowding, repeated facts and lost
   context, then recheck the affected state. Keep source, fixtures, documentation and
   generated design receipts consistent. Deliver a current screenshot and distinguish
   source/build, installed UI and live-service verification. Report blocked checks
   explicitly; code review and passing tests do not replace rendered acceptance.

## Generate

From the repository root, run `pnpm design:generate` to regenerate tokens and
symbols, then `pnpm design:check` to verify them. After a symbol-only edit,
`pnpm symbols:generate` runs [generate-symbols.mts](generate-symbols.mts) on
[symbols.json](symbols.json). It emits the web and Swift mappings and the
[symbol sheet](symbols.html). The main generator includes this step via `--symbols`.

`generate.mts` uses the pinned `@google/design.md@0.4.0` parser/linter and
Prettier version pinned in the owning project's `package.json`. Native output also needs
`xcrun swift-format` (Apple Command Line Tools). It can run from here against another project:

```sh
node /path/to/design/generate.mts --source /target/DESIGN.md --css /target/assets/design-tokens.css
node /path/to/design/generate.mts --source /target/DESIGN.md --swift /target/Sources/DesignTokens.swift
```

With no `--source`, the generator reads [tokens.md](tokens.md) beside itself.
Copy the design directory and the design guide as a kit; install the pinned
parser and formatter in the target. No Google/Stitch account is required.

`--check` compares the complete generated output without writing. Prose-only
edits do not change the output, including when using a portable DESIGN.md.
Generation leaves identical token files untouched. CSS may be repeated for
self-contained surfaces; use `--typescript` for the palette.

The adapter pairs `colors.<role>` with `colors.<role>-dark`. An unpaired light color
is constant in both appearances. Current native export accepts opaque sRGB colors,
px lengths (mapped to points), system sans/serif roles, and standard font weights.
Unsupported native mappings fail before output writes; add a concrete adapter when
a target needs another mapping. Token generation does not implement prose/layout rules.

## Adapt and verify

Connect generated roles to existing components; remove superseded literal styling.
Use `:host` for shadow-root overlays and inline generated tokens in isolated MCP
documents. Preserve host-provided theme choices, native semantic controls, product
vocabulary, keyboard behavior, honest loading/errors, and persisted state.

Allow reading, compact and dense layouts while retaining typography and action
hierarchy. Apply reduced-motion guidance. Run the target's behavior checks and
follow steps 3–4 of the [feature UI review](#feature-ui-review), using its
browser-launch and disposable-profile requirements.

Carry the contract and generator as a versioned unit. Link `DESIGN.md` and this
workflow from the target's `AGENTS.md`, and pin/check generated outputs during builds.
