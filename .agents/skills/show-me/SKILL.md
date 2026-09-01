---
name: show-me
version: "1.1.1"
last_updated: 2026-08-21
description: >-
  Explain the current topic in conversation with the smallest useful
  evidence-grounded visual and concise structured text. Use for relationships,
  flows, ownership, or diffs.
---

# Show me

Make the key relationship visible. Skip the preamble, keep prose brief, and
prefer one clear view over a gallery.

Ground labels in current evidence: real paths, functions, components, states,
and data where available. Mark hypothetical shapes and omit detail that does not
answer the question.

For a materially cross-cutting project or change, lead with the relevant
core-model relationship and show any before/after effect. Otherwise explain the
local mechanism directly. Descend into code, files, stack, or milestones only as
evidence.

## Pick the smallest useful shape

| Shape | Use it for |
| --- | --- |
| Pseudocode | Logic or an algorithm |
| Call or component tree | Runtime flow or UI ownership |
| Shallow file tree | Responsibility or a broad refactor |
| Mermaid | Sequence, data flow, interaction, or hierarchy |
| Focused diff | A change to an already understood shape |

Show the whole block only when most of it is new, omitted context would hide
ownership or order, or the user needs a copyable target.

## Artifact boundary

Keep the result in conversation by default. When the user explicitly asks for a
one-off interactive visual, use the environment's supported visualization
workflow and verify the rendered result.

## Completion

The visual makes the key relationship clear, labels are evidenced or marked
hypothetical, and the prose adds meaning instead of repeating the picture.

Adapted from HumanLayer's `show-me` skill at commit
`4d8d644ca747517973f58d7953f58d7cd07520cd`; see `LICENSE`. Model-first,
direct-manipulation guidance was informed by Geoffrey Litt's
[essay on understanding](https://www.geoffreylitt.com/2026/07/02/understanding-is-the-new-bottleneck).
