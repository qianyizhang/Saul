# Shared agent skills

Nine generic skills are installed at user scope from repo-kit's reviewed
`skills/` bundle: `writing-for-agents`, `codebase-design`, `grilling`,
`domain-modeling`, `retro`, `improve-codebase-architecture`, `next-slice`, `show-me`, `finish-work`.
This repository maintains no separate generic copy or upstream lock.
The shared maintenance procedure lives in repo-kit's `docs/skill-suite.md`. Update the installation there; preserve project-specific skills.

Resolve upstream document names to these existing owners. Create a glossary or
ADR only for a concrete unresolved term or consequential decision; do not create
a documentation framework as a prerequisite. Local guidance governs validation
and write scope. Clear acceptance settles a decision without a second confirmation.

| Upstream name         | Local owner                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GLOSSARY.md`         | Domain terms in [product](product.md) and [architecture](architecture.md); add a glossary only when needed |
| `docs/adr/`           | Consequential decisions in [architecture](architecture.md); create ADRs lazily                             |
| `CODING_STANDARDS.md` | [AGENTS.md](../AGENTS.md) and existing lint, types and [testing](testing.md)                               |
| Browser verification  | [Local browser skill](../../../.agents/skills/saul-browser-testing/SKILL.md)                               |

## Finishing a slice

Use `finish-work` for review and scoped commits against [product contracts](product.md),
[architecture](architecture.md), and [testing](testing.md). For browser changes, use
the existing browser skill above. Preserve MV3 recovery and the tab proposal Apply
boundary; distinguish source builds from the installed extension or MCP app.
