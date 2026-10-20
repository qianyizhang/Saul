# Shared agent skills

Nine generic skills are installed at user scope from repo-kit's reviewed
`skills/` bundle: `writing-for-agents`, `codebase-design`, `grilling`,
`domain-modeling`, `retro`, `improve-codebase-architecture`, `next-slice`, `show-me`, `finish-work`.
This repository maintains no separate generic copy or upstream lock.
The shared maintenance procedure lives in repo-kit's `docs/skill-suite.md`. Update the installation there; preserve project-specific skills.

For GUI refinement or screenshot annotation, use the separately installed
`gui-review` skill installed at user scope. It owns the
review-surface procedure; [ADR 0001](adr/0001-screenshot-first-design-review.md)
preserves its original EZ rationale.

Resolve upstream document names to these existing owners. Create a glossary or
ADR only for a concrete unresolved term or consequential decision; do not create
a documentation framework as a prerequisite. Local guidance governs validation
and write scope. Clear acceptance settles a decision without a second confirmation.

| Upstream name | Local owner |
| --- | --- |
| `GLOSSARY.md` | Product terminology in [the glossary](../GLOSSARY.md); technical contracts in [architecture](architecture.md) |
| `docs/adr/` | Decisions in [architecture](architecture.md); create ADRs lazily when needed |
| `CODING_STANDARDS.md` | [AGENTS.md](../AGENTS.md), [CONTRIBUTING.md](../CONTRIBUTING.md) and existing formatter/checks |
| Plans and readiness | [Roadmap](roadmap.md) and [verification](verification.md) |

## Finishing a slice

Use `finish-work` for review and scoped commits. Read [surface contracts](surfaces.md)
and [architecture](architecture.md) for changed behavior; [the testing guide](../Tests/README.md)
and [verification record](verification.md) distinguish offline checks from native
and live-service acceptance. Keep shared lookup state and evidence boundaries intact.
