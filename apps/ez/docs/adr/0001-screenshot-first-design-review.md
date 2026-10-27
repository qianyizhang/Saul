# ADR 0001: Screenshot-first design review

- **Status:** Historical decision; reusable procedures are owned by shared review skills
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

On 2026-10-14 the reusable screenshot procedure moved to the user-scope
`gui-review` skill.
It owns small screenshot-annotation rounds. Since 2026-10-27, structured maps
and journey reports use `ui-discussion`; [local skill mappings](../agent-skills.md)
own that routing. Portable report terms and presentation remain in the shared
skill. This ADR preserves EZ's rationale and decision history, not operational
instructions. EZ's native behavior and design contracts remain
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
