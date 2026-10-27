# ADR 0002: Model presets and editable recipes

- **Status:** Accepted
- **Date:** 2026-10-14

## Decision

Configuration has two sections: **Model presets** and **Recipes**. A preset names
the exact model, reasoning effort, and Fast/Standard choice. A recipe names a prompt
template and references a default preset by stable ID. Dictionary, Spell Check,
Ask, and the two-field Lookup example are starter recipes; users can edit or remove
them. Starters are seeded only when configuration is absent, never when empty.

Templates support literal `{{field name}}` substitution. Fields appear once, in
first-appearance order, and all are required. Names may include spaces. Input
values are inserted once without parsing them as templates. Expressions, filters,
loops, and conditions are unsupported; this is not a Jinja runtime.

Selecting a recipe applies its default preset. The user can override that preset
for the current lookup; New lookup or choosing a recipe restores the default.
Unavailable models, effort, or Fast block sending with an explanation. No fallback
changes the saved preset, account, billing path, or requested service tier.

Raycast fills the selected recipe's first field. Single-field recipes submit
through the existing flow; multi-field recipes open Quick Lookup and require the
remaining fields and explicit Send. Restart selects the first remaining recipe.

## Persistence and history

Recipes and preset snapshots are stored in owner-only `configuration.json`, separate
from credentials and history. Since 2026-10-27, live model presets use the
[shared local store](../../../../contracts/README.md#accounts-and-models); configuration
records its revision and imports old presets once. Writes validate names, template syntax, and references
before atomic replacement. Referenced presets must be reassigned before removal.
Corrupt files are preserved and sending/editing is blocked rather than resetting.

New history records retain the recipe, preset, input values, and compiled prompt
used for the request. Editing or removing configuration cannot change old records.
Use again restores the saved snapshot and validates it against the current account
catalog. Legacy history remains readable without rewriting existing bytes.

## Consequences and limits

Everyday use presents recipe inputs and a preset picker. Raw model controls live
in Configuration. Prompt authoring is explicit: starter instructions live in
their editable templates; new recipes do not inherit hidden mode instructions.
Each lookup remains stateless and requires `response.completed` to succeed.

Native SwiftUI remains the implementation and visual review uses screenshots per
[ADR 0001](0001-screenshot-first-design-review.md). Full Jinja, multi-device sync,
recipe import/export tooling, and per-field validation rules are deferred.
