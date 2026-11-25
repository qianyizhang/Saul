# Saul

| Goal                                                  | Outcome                                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [Read and explain](docs/product.md#reading)           | Explain a selection and return to it through markers, notifications or the Library |
| [Summarize](docs/calls.md)                            | Run a Call on pages or PDFs and reopen, export or retry the result                 |
| [Annotate](docs/annotations.md)                       | Save page evidence, compose replies and keep a record across visits                |
| [Organize tabs](docs/mcp-app.md)                      | Edit windows and groups. Review and apply Codex proposals explicitly               |
| [Choose a model](docs/product.md#settings-and-models) | Use a ChatGPT plan or an OpenAI-compatible connection                              |

## Install

| Outcome                                                    | Owner                                             |
| ---------------------------------------------------------- | ------------------------------------------------- |
| Chrome extension and required history/configuration helper | [Selective setup](../../docs/setup.md)            |
| ChatGPT plan connection                                    | [Plan setup](docs/chatgpt-plan.md#setup)          |
| Optional tab access, page tools or Codex connection        | [Native browser access](docs/native-messaging.md) |
| Optional custom Calls                                      | [Custom Calls](docs/custom-actions.md)            |

## Develop

- **Runtime** — WXT, React, TypeScript and native SQLite. [Architecture](docs/architecture.md)
- **Development server, build or ZIP** — `pnpm dev`, `pnpm build` or `pnpm zip` from `apps/saul` after [workspace setup](../../README.md#develop).
- **Checks and browser launch** — [Testing](docs/testing.md) and [benchmarks](docs/benchmarks/README.md).
- **UI changes** — [Shared design](../../DESIGN.md) and [feature review](../../design/SKILL.md#feature-ui-review).
