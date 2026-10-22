# Shared agent skills

Shared skills are maintained in repo-kit (`docs/skill-suite.md`) and installed
at user scope. Keep only project-specific skills here.

Use these local owners when a shared skill names a generic document:

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
