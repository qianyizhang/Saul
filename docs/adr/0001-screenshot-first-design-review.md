# ADR 0001: Screenshot-first design review

- **Status:** Historical decision; procedure transferred to `gui-review` on 2026-10-14
- **Date:** 2026-10-14
- **Scope:** EZ design discussions and visual feedback

## Context

EZ is a native SwiftUI app. A screenshot can be displayed in Codex's side panel
for comments, but those comments attach to pixels rather than functional
components. Reconstructing the screen in HTML solely to support component
selection adds maintenance and can drift from the native app.

## Decision and current owner

The accepted approach was native screenshots with boxes/comments, deferring an
interactive web mockup until a redesign needed it. The intended review carrier
was an HTML page opened in Codex's browser panel for annotation.

On 2026-10-14 the reusable procedure moved to the user-scope
[`gui-review` skill](../../../../.codex/skills/gui-review/SKILL.md).
That skill is the single source of truth for preparing and refreshing annotation
surfaces. This ADR preserves EZ's rationale and decision history; it no longer
owns operational instructions. EZ's native behavior and design contracts remain
in [architecture](../architecture.md) and [design](../design.md).

## Consequences

This keeps small visual changes concrete without maintaining a second UI.
Comments can become stale after layout changes, and screenshots cannot demonstrate
resizing, keyboard focus, scrolling, or other interaction behavior. Verify those
in the built native app.

## Product authority

An interactive web mockup was deferred and is not EZ's canonical design or a
runtime dependency. A future change to that product authority warrants a new
ADR; routine changes to the review procedure belong in the skill.
