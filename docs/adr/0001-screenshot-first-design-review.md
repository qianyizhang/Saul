# ADR 0001: Screenshot-first design review

- **Status:** Accepted
- **Date:** 2026-10-14
- **Scope:** EZ design discussions and visual feedback

## Context

EZ is a native SwiftUI app. A screenshot can be displayed in Codex's side panel
for comments, but those comments attach to pixels rather than functional
components. Reconstructing the screen in HTML solely to support component
selection adds maintenance and can drift from the native app.

## Decision

Use screenshots of the native app with boxes and comments as the default design
review surface. Use named regions when helpful, and resolve feedback against the
SwiftUI source and native accessibility tree when needed. Refresh screenshots
after relevant UI changes; the image is a snapshot, not an interactive app.

The native implementation owns current behavior. Accepted design decisions belong
in repository documentation; screenshots illustrate the state being discussed.
Keep screenshots containing personal lookup history out of Git.

## Consequences

This keeps small visual changes concrete without maintaining a second UI.
Comments can become stale after layout changes, and screenshots cannot demonstrate
resizing, keyboard focus, scrolling, or other interaction behavior. Verify those
in the built native app.

## Revisit when

Consider a small interactive web mockup when a substantial redesign or new flow
requires comparing layouts, window sizes, or multiple interaction states before
SwiftUI implementation. A web mockup is deferred, not currently the canonical
design or a planned runtime dependency.

If adopted, record a new ADR that supersedes this decision and defines what the
mockup governs and how native differences are verified. Preserve this record as
the rationale for the earlier workflow.
