# Shared agent skills

Shared skills are maintained in repo-kit (`docs/skill-suite.md`) and installed
at user scope. Keep only project-specific skills here.

Use `gui-review` for a small native screenshot annotation round. Use
`ui-discussion` for a structured UI map, component inspection and user journeys.
Its canonical source is in repo-kit; install it through the shared-skill workflow.
Portable report terms and presentation stay in the skill's
`references/review-surface.md`. Native behavior, design intent and EZ terminology
remain app-owned.

The [screenshot-first decision](adr/0001-screenshot-first-design-review.md)
retains the original rationale. Review HTML is a discussion artifact, not an EZ
runtime or canonical design. Keep one active bundle under root `.artifacts/ez/`
when a later UX round needs its captures; follow the
[artifact policy](../../../docs/artifacts.md) at closeout.

Use these local owners when a shared skill names a generic document:

| Upstream name         | Local owner                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GLOSSARY.md`         | Product terminology in [the glossary](../GLOSSARY.md); technical contracts in [architecture](architecture.md) |
| `docs/adr/`           | Decisions in [architecture](architecture.md); create ADRs lazily when needed                                  |
| `CODING_STANDARDS.md` | [AGENTS.md](../AGENTS.md), [CONTRIBUTING.md](../CONTRIBUTING.md) and existing formatter/checks                |
| Plans and readiness   | [Roadmap](roadmap.md) and [verification](verification.md)                                                     |

## Finishing a slice

Use `finish-work` for review and scoped commits. Read [surface contracts](surfaces.md)
and [architecture](architecture.md) for changed behavior; [the testing guide](../Tests/README.md)
and [verification record](verification.md) distinguish offline checks from native
and live-service acceptance. Keep shared lookup state and evidence boundaries intact.
