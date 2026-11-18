# EZ

| Goal                                                          | Outcome                                                                       |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [Look up or write](docs/surfaces.md#shared-workspace)         | Definitions, spelling checks and answers from the main window or Quick Lookup |
| [Use selected text](docs/surfaces.md#look-up-selected-text)   | Open a draft from another macOS app                                           |
| [Run from Raycast](docs/raycast.md)                           | Send a query to EZ through its URL scheme                                     |
| [Draw or search](docs/surfaces.md#image-and-search-actions)   | Image or web search with an explicitly selected API preset                    |
| [Configure a model](docs/surfaces.md#connections-and-actions) | Bind an action to a saved plan or API preset                                  |

## Run

- **Install and recover** — [Setup](../../docs/setup.md) and [local signing](docs/releasing.md#local-signing-and-installation).
- **Run a lookup** — `⌘ Return`. [Selectors and shortcuts](docs/surfaces.md#selectors-and-shortcuts)
- **Distribution** — Local personal project. Public release requires a license and [distribution checks](docs/releasing.md#distribution).

## Local data

- **History** — Shared SQLite with Saul. EZ stores it as plaintext. [Native persistence](docs/architecture.md#persistence-contract)
- **Credentials** — Shared signed owner with Keychain storage. [Keychain access](docs/keychain.md)
- **Data boundaries** — [Shared ownership](../../docs/architecture.md#data-ownership).

## Development

| Goal                                       | Owner                                                          |
| ------------------------------------------ | -------------------------------------------------------------- |
| Build and check native code                | [Contributing](CONTRIBUTING.md), [Makefile](Makefile)          |
| Verify offline, installed or live behavior | [Tests](Tests/README.md), [verification](docs/verification.md) |
| Review native UI                           | [Native design and previews](docs/design.md)                   |
| Understand request and storage boundaries  | [Architecture](docs/architecture.md)                           |
| Find planned work                          | [Roadmap](docs/roadmap.md)                                     |
