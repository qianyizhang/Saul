# Architecture

[Saul](../apps/saul/docs/architecture.md) owns Chrome UI, capture, anchors and Node
helpers. [EZ](../apps/ez/docs/architecture.md) owns the native UI and its request
and storage adapters. They build and install independently. The signed Saul
credential owner is a separate executable, not an EZ or Chrome UI process.

## Documentation ownership

| To find                             | Read                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| Shared guarantees and fixture links | [Contracts](../contracts/README.md)                                                              |
| Current behavior                    | [Saul product](../apps/saul/docs/product.md), [EZ surfaces](../apps/ez/docs/surfaces.md)         |
| Terms and presentation              | [Glossary](../GLOSSARY.md), [design](../DESIGN.md)                                               |
| Installation, upgrades and recovery | [Setup](setup.md)                                                                                |
| Checks and diagnosis                | [Saul testing](../apps/saul/docs/testing.md), [EZ verification](../apps/ez/docs/verification.md) |
| Historical evidence                 | [Snapshot policy](artifacts.md#historical-references)                                            |

Code, schemas, scripts and configuration own implementation details and tool pins.
Use the [ADR rule](../AGENTS.md#architecture-decisions) for durable trade-offs.

## Lifecycle ownership

One lifecycle has one owner for its states, valid data, transitions and effects.
Callers request transitions and read snapshots. Keep independent facts separate;
use distinct types when states require different data or operations.

Trace each transition through its owner and check it through the caller-facing
interface. Handle failures, cancellations, uncertain effects and stale responses.
Advance on evidence from the owning contract: a provider completion does not
establish a saved result. The [Attempt contract](../contracts/actions-and-attempts.md#execution)
owns save failures and replay rules; the app architecture pages identify runtime
owners. Use the storage owner's transactions and constraints directly.

## Data ownership

- [Configuration](../contracts/configuration.md#unified-configuration-scopes) shares a
  local settings file, with common connections/presets and app-scoped actions.
- [Credentials](../contracts/credentials.md): the signed owner owns all active
  ChatGPT credentials. Local browser API connections retain their app-owned
  credentials. The Node helper owns browser history, configuration and presets.
- [History](#shared-history) is shared. Drafts and active request state stay
  app-owned. There is no cross-app action import or multi-device sync.

## Shared history

Both apps use one local SQLite store. See the [history contract](../contracts/history.md)
for guarantees, schema and adapters, [setup](setup.md#shared-history-upgrade) for
upgrade and recovery, and the [decision record](adr/0001-share-local-history.md)
for the trade-off.

## Optional shared capabilities

Before adding a shared account or execution replacement, show a maintenance
benefit for two concrete consumers. Keep installation independent and opt-in per
app. Independent routes for other providers can coexist with a shared capability.

Use a versioned interface for discovery, capabilities, selection, operations,
cancellation and recovery. Authenticate callers, restrict operations and keep
secrets behind one refresh owner. Separate identity from permission, and freeze
the chosen implementation and account for each request. Loss blocks explicitly;
switching between available routes requires an explicit choice. Define and test disconnect,
uninstall and failure with both adapters before enabling the replacement.
The [credential contract](../contracts/credentials.md) is the existing instance.

## Managed connections

[Connections and presets](../contracts/configuration.md#connections-and-presets) owns
binding, migration and model choices. The [credential contract](../contracts/credentials.md#connection-identity-and-catalogs)
owns credential lifecycle and live catalogs.

### Provider, connection and protocol

See the [glossary](../GLOSSARY.md) for the distinction and the
[connection upgrade contract](../contracts/configuration.md#connection-data-upgrades)
for stored names and compatibility.

## TypeScript maintenance

Keep authored code and types together; validate external JSON at the boundary.
[Saul testing](../apps/saul/docs/testing.md#typescript-and-delivered-helper-checks)
covers the different compiler and test scopes. The complete helper build lives
outside WXT output so rebuilding the extension cannot erase it. Installed helpers
use emitted modules and stable entry paths without a TypeScript loader.

## Naming reminder

Saul is the repository name; Saul and EZ remain app names. Revisit public names
before distribution. Shared vocabulary uses domain names. Preserve installed
identities and data locations across display renames; see [setup](setup.md) and
[installed identities](migration.md#installed-identities-and-artifacts).
