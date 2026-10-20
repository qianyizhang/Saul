# Shared design verification

## Shared design and configuration · 2026-10-18

The shared [contract](../../../DESIGN.md) now covers reading/composition states, action
names, keyboard ownership, progressive disclosure and a future mobile adaptation.
The existing palette and typography token values are retained; regenerated CSS,
TypeScript and Swift receipts all match the edited contract.

Minimum Mode defaults on in EZ and Saul. It is reversible, local to each runtime,
and independent of provider settings. The embedded board has its own preference.
This is a presentation change, not cross-app history or account synchronization.

The configuration pass adds named recipes and presets to Saul using the same
concepts as EZ. ChatGPT account controls share their vocabulary and direct sign-in
flow, while credentials remain separate. The account catalog supplies effort and
speed choices. Legacy prompt and active-connection migration, literal template
rendering, frozen retries, and completed-answer follow-ups have regression coverage.
Independent review also corrected stale catalog refreshes, auth/preset switching,
shown-answer metadata, preference-save races, and repeated Escape dismissal.

| Review step                     | Result                                                                                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| EZ new lookup                   | Native capture: composer is directly below the heading; repeated guidance reduced.                                                              |
| EZ saved answer                 | Native light/dark captures: Copy and Use again remain visible; More and Details retain secondary controls and metrics.                          |
| EZ Quick Lookup                 | Native capture: saved recipe/preset describe the displayed answer; Edit draft restores inputs without losing the answer.                        |
| EZ Settings and recovery        | Native mode switch and fixture errors inspected; model/save warnings remain prominent.                                                          |
| Saul selection and reading      | Real extension/local fixture: Copy leads; More/Details, follow-ups, source, interruptions and error recovery exercised.                         |
| Saul History, Settings and Tabs | Light/dark, 360/440/1000px reflow, touch targets, preference persistence, draft protection and scoped shortcuts checked.                        |
| Saul recipes and presets        | Named model choices, same-passage recipe changes, frozen retries/follow-ups, missing-context errors, and 360/440px light/dark captures checked. |
| ChatGPT configuration           | Fixture sign-in controls, model/effort/speed persistence, capability removal, cancellation, and locked preset switching checked.                |
| Embedded tab board              | Light/dark and narrow captures; drag, keyboard movement, preference reopening, stale proposals and explicit Apply verified.                     |

Validation:

- EZ: format and full check, including **53 core checks**, **24 state checks**,
  installer fixtures and Swift script compilation; app and offline preview builds.
- Saul: production build; design drift, format, lint, types and links checks;
  **155 unit/transport tests** covered successfully across the ordinary run and
  an approved retry of two socket-bound test files after sandbox `EPERM` errors.
- Saul browser suite: **64 distinct cases passed** across the full suite and a
  three-case recipe rerun after fixing the prompt textarea's accessible label.
  **3 expected skips**:
  two disabled on-device AI cases and the opt-in live GitHub case.
- Cross-repository CSS/TypeScript/Swift generation drift checks passed.

The preference-race and repeated-Escape regressions failed against the prior build
at their intended assertions and passed against the final implementation.

Fresh browser captures are in ignored `test-results-parity-final/` and
`test-results-parity-configuration-final/`; the initial comparison is in
`test-results-design-before/`. Native captures and the local annotation review
remain outside Git in the task's design-review artifact folder.

Limits: the previews use disposable fixture data. Live sign-in, model inference,
installed-app upgrade, native mobile, and a full assistive-technology audit are
not established by these checks. Native menu-first Escape still needs a direct
keyboard check: the automation dismissed the menu with a focus click before
sending Escape, so that result did not demonstrate a product failure. No timing
workaround or speculative menu interception was retained.

## Initial adoption · 2026-10-14

The initial receipt below records the first working-tree adoption, including the
then-present Quick Lookup prototype. The scoped review at the end records the
independent commit snapshots and later fixes.

**Delivered:** one portable [DESIGN.md](../../../DESIGN.md), the [application skill](../../../design/SKILL.md),
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
