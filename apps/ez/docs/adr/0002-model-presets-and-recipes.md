# ADR 0002: Model presets and editable actions

- **Status:** Accepted; storage and capabilities evolved as linked below
- **Date:** 2026-10-14

## Decision

Separate model presets from editable prompt templates, originally called Recipes
and now Actions. Presets name model, effort and Fast/Standard; actions reference a
default preset by stable ID. Dictionary, Spell Check, Ask and two-field Lookup
were the original editable/removable starters. Initial seeding occurs only when
configuration is absent, never merely empty; later starters use versioned migrations.

Templates substitute literal `{{field name}}` values once. Fields are required,
unique and ordered by first appearance; names may contain spaces. Values are not
reparsed. No expressions, filters, loops, conditions or Jinja runtime.

Action selection/New restores its default preset; per-lookup overrides are allowed.
Unavailable choices block with an explanation, never silently changing account,
model, billing or tier. Starter instructions live in editable templates; custom
actions inherit no hidden instructions. Raw model controls belong in Settings.

## Persistence and evolution

Validate names, templates and references before atomic save; reassign referenced
presets before removal. Preserve corrupt configuration and block sending/editing
rather than resetting. History freezes action, preset, input values and compiled
prompt. Edits/removal cannot change saved entries; Reuse restores and validates
the snapshot against current availability. Legacy history remains readable.

The original owner-only `configuration.json` and independent lookup model have
since evolved:

- [Unified configuration](../architecture.md#unified-configuration) owns shared
  presets, scoped actions, revision checks and one-time imports. Persisted
  `recipes`/`recipeSnapshot` keys remain compatibility contracts.
- [Connections and Illustration](../architecture.md#connections-and-illustration)
  adds typed providers/Draw; [Raycast](../raycast.md) submits only single-field Write.
- [Follow-ups](../architecture.md#follow-ups) explicitly retain conversation context.
  Text success still requires `response.completed`; opening an answer never sends.

Native SwiftUI and screenshot review remain per [ADR 0001](0001-screenshot-first-design-review.md).
Full Jinja, multi-device sync, action import/export and per-field validation remain
deferred; candidates live in [roadmap](../roadmap.md).
