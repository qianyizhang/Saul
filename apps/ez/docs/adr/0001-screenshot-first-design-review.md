# ADR 0001: Screenshot-first design review

- **Status:** Historical; procedures now belong to shared review skills
- **Date:** 2026-10-14
- **Scope:** EZ visual feedback

## Decision and rationale

Review native screenshots with boxes/comments in Codex's browser panel. Rebuilding
SwiftUI in HTML just for component selection adds maintenance and risks drift;
interactive web mockups were deferred until needed for redesign.

The procedure moved to `gui-review` on 2026-10-14. Since 2026-10-27,
`ui-discussion` owns structured maps and journeys. [Local mappings](../agent-skills.md)
own routing; shared skills own portable report terms and presentation.

## Consequences

Screenshots keep small changes concrete, but annotations can become stale and
cannot prove resizing, focus, scrolling or interaction. Verify those natively.
HTML remains a discussion artifact, never EZ runtime or canonical design.
Changing that authority needs a new ADR; routine procedure edits belong in the
skill. Current product contracts live in [architecture](../architecture.md) and
[design](../design.md).
