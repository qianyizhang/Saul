# Saul workspace

| App                         | Goal                                                              | Runtime                           |
| --------------------------- | ----------------------------------------------------------------- | --------------------------------- |
| [Saul](apps/saul/README.md) | Explain selections, summarize pages and organize tabs             | Chrome extension and Node helpers |
| [EZ](apps/ez/README.md)     | Run definitions, spelling checks, quick answers and image actions | Native macOS app                  |

- Independent installation. Shared local history and presets. An independent signed helper owns managed credentials. Each app owns its drafts and active requests. [Data ownership](docs/architecture.md#data-ownership)

## Find the right guide

| Goal                                  | Owner                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Install, upgrade or recover an app    | [Setup](docs/setup.md)                                                                                       |
| Understand runtime and data ownership | [Architecture](docs/architecture.md)                                                                         |
| Check cross-app guarantees            | [Shared contracts](contracts/README.md)                                                                      |
| Use consistent terms and controls     | [Glossary](GLOSSARY.md), [design](DESIGN.md)                                                                 |
| Verify a change                       | [Saul testing](apps/saul/docs/testing.md), [EZ verification](apps/ez/docs/verification.md), [CI](docs/ci.md) |
| Review or retain evidence             | [Feature review](design/SKILL.md), [artifact policy](docs/artifacts.md)                                      |

## Develop

| Goal                                                 | Root command                         |
| ---------------------------------------------------- | ------------------------------------ |
| Install JS dependencies with Node 24 and pinned pnpm | `pnpm install --frozen-lockfile`     |
| Install Git hooks with uv                            | `bash scripts/install-hooks.sh`      |
| Verify shared, Chrome and macOS code                 | `pnpm check`                         |
| Build an app                                         | `pnpm build:saul` or `pnpm build:ez` |
| Regenerate shared design outputs on macOS            | `pnpm design:generate`               |

- Gate membership and tool pins. [Workspace scripts](package.json), [hooks](.pre-commit-config.yaml), [EZ tool setup](apps/ez/CONTRIBUTING.md#development-setup-and-gates)
