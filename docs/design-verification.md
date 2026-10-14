# Little Clarity adoption · 2026-10-14

The initial receipt below records the first working-tree adoption, including the
then-present Quick Lookup prototype. The scoped review at the end records the
independent commit snapshots and later fixes.

**Delivered:** one portable [DESIGN.md](../DESIGN.md), the [application skill](../design/SKILL.md),
deterministic web/SwiftUI generation, all Saul visual surfaces, and targeted EZ typography polish.
The projects remain separate; EZ builds independently from its generated Swift source.

## Source receipt

The authored contract SHA-256 is
`0d6d2e1b929690cd23b660b3b78a068e39234f6ba411c8ec4077d34cd4c31ab4`.
Generated files embed that receipt. The tested rebuilt extension's content script is
`efb08a795fff2aa8ef3f969c6f0c307695ef65db1588b83e91c258bcae00fc85`;
its content CSS is `3f686f23ffda31a1e6e72904ff03152e96ae00a113c32587fa70222932f622db`.
The local EZ release executable is
`75509972af94f9c5521062edee40261b4e727687a7493c7d4265a5619f23ec17`.

## Checks

| Check                                                             | Result and scope                                                                                                                                         |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Saul generated-output drift, formatting, lint, types, local links | Passed                                                                                                                                                   |
| Saul unit/transport checks                                        | 124 unique tests passed. The ordinary sandbox run blocked 11 socket cases; the approved 29-test socket-file rerun passed, including those 11.            |
| Final disposable browser suite                                    | 53 passed, 1 optional live GitHub test skipped                                                                                                           |
| Appearance scenarios                                              | Light/dark library and overlays, compact/wide layout, actual reading-text contrast, concept notes, page list, failure recovery, reduced-motion streaming |
| MCP board                                                         | Host theme changes, compact layout, drag/keyboard proposals and explicit apply preserved                                                                 |
| EZ                                                                | `make check`: 16 offline contract checks, strict formatting and native build passed; signed local development bundle built                               |
| Portable workflow                                                 | Skill validator passed; edited identity, invalid references/contrast, native font mapping and another-project drift checks passed                        |

## Rendered review

Inspected Saul popup/history/settings/tabs, wide library, page card, concept tooltip,
page list, submission-error notification, incomplete answer, and the MCP tab board.
The review caught and fixed incorrect body-font inheritance in concept notes and
the Explain trigger. Browser screenshots are disposable local evidence under
`test-results-design-final/`; they are not committed fixtures.

Inspected actual EZ production view sources in the separate `EZ Design Preview.app`:
main and Quick Lookup, light and dark. It uses temporary fixture history, never
connects authentication or registers the global shortcut, and disables production
controls. This establishes native rendering, not a live account/shortcut acceptance
test. Screenshots are under EZ's ignored `dist/design-preview-*.png`.

Existing EZ work was preserved. No live-provider generation or personal Chrome-profile
automation was performed. Motion/reduced-motion principles are included; richer VFX
and runtime theme personalization remain future work.

## Scoped review and cleanup

- Generator outputs cannot overwrite the authoring document through symbolic or
  hard links. Swift keywords are escaped; conflicting native member names fail
  before writing. Two additional behavior checks pass.
- Compact web headings derive their size from the shared subject role. CI now
  checks generated-output drift directly.
- Saul: **126 unit/transport checks passed**, with the 29 socket-file checks run
  using approved local access. **6 affected browser scenarios passed** after the
  typography polish; the earlier full suite had 53 passes and one optional skip.
- EZ: a snapshot of HEAD `ea532df` plus only the nine design-owned paths passed
  strict formatting, native build, **15 offline checks**, and preview compilation.
  The preview is self-contained (main/settings), cleans up its fixture history on
  exit, and was inspected in light/dark appearance without unfinished feature files.
- The reviewed content CSS SHA-256 is
  `58dfca92a53c385e307efaa78d4d6c329322883f7d2e524034cfc794e3e40e09`.
- Concurrent skill migration and EZ feature changes are outside these commits.
