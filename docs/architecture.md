# Architecture

| Runtime                                      | Owner                                                   |
| -------------------------------------------- | ------------------------------------------------------- |
| Chrome UI, capture, anchors and Node helpers | [Saul](../apps/saul/docs/architecture.md)               |
| macOS UI and native request/storage adapters | [EZ](../apps/ez/docs/architecture.md)                   |
| Managed credentials and provider operations  | [Independent signed owner](../contracts/credentials.md) |

## Documentation ownership

| Decision or question                | Owner                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| Shared guarantees and fixtures      | [Contracts](../contracts/README.md)                                                              |
| Shipped behavior                    | [Saul product](../apps/saul/docs/product.md), [EZ surfaces](../apps/ez/docs/surfaces.md)         |
| Terms and presentation              | [Glossary](../GLOSSARY.md), [design](../DESIGN.md)                                               |
| Installation, upgrades and recovery | [Setup](setup.md)                                                                                |
| Checks and diagnosis                | [Saul testing](../apps/saul/docs/testing.md), [EZ verification](../apps/ez/docs/verification.md) |
| Historical evidence                 | [Artifact policy](artifacts.md#historical-references)                                            |
| Implementation and tool pins        | Code, schemas, scripts and configuration                                                         |
| Durable trade-offs                  | [ADR rule](../AGENTS.md#architecture-decisions)                                                  |

## Lifecycle ownership

- **One owner** — States, valid data, transitions and effects. Callers request transitions and read snapshots. Use distinct types for independent facts or states with different data and operations.
- **Evidence** — Verify transitions through the caller-facing interface. Cover failure, cancellation, uncertain effects and stale responses.
- **Persistence** — Use storage transactions and constraints. Provider completion and saved success require separate evidence. [Attempt contract](../contracts/actions-and-attempts.md#execution), [bounded recovery decision](adr/0006-bound-local-recovery.md)

## Data ownership

| Data                       | Owner                                                                                                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connections and presets    | Shared local settings. Node storage helper for Saul, Swift adapter for EZ. [Configuration scopes](../contracts/configuration.md#unified-configuration-scopes)                                                              |
| Actions                    | App-scoped configuration. Cross-app import and multi-device sync are outside the shared contract.                                                                                                                          |
| Managed credentials        | Signed owner. Browser-local API connections keep app-owned keys. [Credential contract](../contracts/credentials.md)                                                                                                        |
| Connection setup           | Each app retains per-connection public recovery records. The signed owner admits credential use. Both [settings writers](../contracts/configuration.md#unified-configuration-scopes) check the same reservation at commit. |
| History                    | [Shared SQLite](#shared-history)                                                                                                                                                                                           |
| Drafts and active requests | App-local runtime state                                                                                                                                                                                                    |

## Shared history

- **Store and adapters** — [History contract](../contracts/history.md).
- **Upgrade and recovery** — [Shared history setup](setup.md#shared-history-upgrade).
- **Trade-off** — [Shared history decision](adr/0001-share-local-history.md) and [History interface decision](adr/0007-history-records-and-entries.md).

## Optional shared capabilities

| Requirement                | Outcome                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Justification and adoption | Maintenance benefit for two real consumers. Independent installation and per-app opt-in. Other provider routes can coexist.                            |
| Interface                  | Versioned discovery, capabilities, selection, operations, cancellation and recovery. Authenticate callers and restrict operations.                     |
| Identity and execution     | One refresh owner. Identity and permission remain distinct. Freeze route and account for each request. Loss blocks execution until an explicit choice. |
| Acceptance                 | Disconnect, uninstall and failure exercised through both adapters. [Credential implementation](../contracts/credentials.md)                            |

## Managed connections

- **Binding, migration and model choices** — [Configuration](../contracts/configuration.md#connections-and-presets).
- **Catalogs and identity** — [Credential contract](../contracts/credentials.md#connection-identity-and-catalogs).
- **Setup, active runs and recovery** — [Shared admission rules](../contracts/credentials.md#shared-connection-setup-and-execution) and [coordination decision](adr/0008-coordinate-shared-connection-work.md).
- **Module ownership across apps** — [Architecture consolidation inventory](architecture-consolidation.md#implemented-ownership).

### Provider, connection and protocol

- **Terms and saved names** — [Glossary](../GLOSSARY.md), [connection upgrades](../contracts/configuration.md#connection-data-upgrades).

## TypeScript maintenance

- **Source** — Author code and types together. Validate external JSON at the boundary. [Compiler and delivery checks](../apps/saul/docs/testing.md#typescript-and-delivered-helper-checks)
- **Delivery** — Complete helper builds live outside WXT output. Installed helpers use emitted modules and stable entry paths without a TypeScript loader. [Artifact decision](adr/0005-separate-saul-helper-source-from-installed-artifacts.md)

## Naming reminder

- **Display names** — Saul is the repository name. Saul and EZ are the app names. Revisit public names before distribution.
- **Installed identities** — Retain identifiers and data paths across display renames. [Setup](setup.md), [migration](migration.md#installed-identities-and-artifacts)
