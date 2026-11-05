# Shared agent skills

Shared skills live in repo-kit (`docs/skill-suite.md`) and install at user scope.
Keep only project-specific skills here.

- `gui-review`: small native screenshot annotation rounds.
- `ui-discussion`: UI maps, components and journeys; portable report terms belong
  to its `references/review-surface.md`.
- `finish-work`: scoped review and commits when requested; use [tests](../Tests/README.md)
  and [verification](verification.md) to distinguish offline/native/live evidence.

EZ behavior, vocabulary and design remain app-owned. Review HTML is a discussion
artifact, never runtime or canonical design. Keep one active capture bundle under
root `.artifacts/ez/`; follow [retention](../../../docs/artifacts.md).
[ADR 0001](adr/0001-screenshot-first-design-review.md) records the rationale.

| Generic skill owner   | EZ owner                                                                      |
| --------------------- | ----------------------------------------------------------------------------- |
| `GLOSSARY.md`         | [Glossary](../GLOSSARY.md), [architecture](architecture.md)                   |
| `docs/adr/`           | [Architecture](architecture.md); add ADRs only when needed                    |
| `CODING_STANDARDS.md` | [AGENTS](../AGENTS.md), [CONTRIBUTING](../CONTRIBUTING.md), executable checks |
| Plans / readiness     | [Roadmap](roadmap.md), [verification](verification.md)                        |
