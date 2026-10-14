# Roadmap

## Initial scope

Native SwiftUI window, ChatGPT sign-in and account selection, model/effort/Fast
controls, Dictionary / Spell Check / Ask, streaming, cancellation, JSONL history,
search, copy, and Markdown export. Acceptance includes a real user-authorized
sign-in and completed inference; offline tests alone cannot establish those.

## Implemented after initial scope

- Model presets and editable recipes: local configuration, explicit prompt
  templates, generated inputs, temporary preset overrides, and immutable history
  snapshots. Built-in starters can be edited/removed. Multi-field Raycast queries
  open Quick Lookup for completion. See [ADR 0002](adr/0002-model-presets-and-recipes.md).
- Quick Lookup: Control–Option–Space, menu-bar entry, compact native panel, shared
  requests/history/preferences, explicit paste, and Escape to hide. Native launcher
  panel and history access are verified; full-screen/display/focus acceptance remains
  partial. See [verification](verification.md).
- Raycast query entry: `ez Space query Return`, explicit submission to the shared
  request flow, and compact native answer panel. See [setup](raycast.md) and
  [verification](verification.md). Spotlight actions remain a separate candidate.

- Individual lookup deletion: confirmed answer/history-row actions, removal of all
  saved snapshots for the selected ID, draft preservation, and visible storage
  failures. Deletion is blocked during requests and pending launcher submissions.

## Candidates, not commitments
- Selected-text Services integration, with explicit pasteboard behavior.
- Language preferences and optional richer recipe field rules.
- Bulk history deletion, retention controls, and larger-history indexing.
- Optional explicitly billed API-key provider.
- Conversation follow-ups with deliberate context selection.
- Signed/notarized distribution and an update channel.

For each addition, define the interaction, data boundary, and acceptance checks
before implementation. Keep the default experience fast and compact.
