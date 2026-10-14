# Shared agent skills

Eight generic skills are installed at user scope from repo-kit's reviewed
`skills/` bundle: `writing-for-agents`, `codebase-design`, `grilling`,
`domain-modeling`, `retro`, `improve-codebase-architecture`, `next-slice`, `show-me`.
This repository maintains no separate generic copy or upstream lock.
The shared maintenance procedure is at `../repo-kit/docs/skill-suite.md` in the
sibling checkout. Update the installation there; preserve project-specific skills.

Resolve upstream document names to these existing owners. Create a glossary or
ADR only for a concrete unresolved term or consequential decision; do not create
a documentation framework as a prerequisite. Local guidance governs validation
and write scope. Clear acceptance settles a decision without a second confirmation.

| Upstream name | Local owner |
| --- | --- |
| `GLOSSARY.md` | Terminology in [architecture](architecture.md); add a small glossary only when needed |
| `docs/adr/` | Decisions in [architecture](architecture.md); create ADRs lazily when needed |
| `CODING_STANDARDS.md` | [AGENTS.md](../AGENTS.md), [CONTRIBUTING.md](../CONTRIBUTING.md) and existing formatter/checks |
| Plans and readiness | [Roadmap](roadmap.md) and [verification](verification.md) |
