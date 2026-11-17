# EZ

A native Mac app for definitions, spelling checks, quick answers and images.
The main window and Quick Lookup panel share one workspace and local history
with Saul. See the [surface guide](docs/surfaces.md) for current user behavior and
[architecture](docs/architecture.md) for execution and storage boundaries.

## Run

Follow [selective setup](../../docs/setup.md) for prerequisites and installation;
[releasing](docs/releasing.md#local-signing-and-installation) owns signing and rollback.
For a local development build, run from `apps/ez`:

```sh
make tools
make check
make app
open dist/EZ.app
```

Start with [Connections and actions](docs/surfaces.md#connections-and-actions),
then use **⌘ Return** to Run. Write supports ChatGPT plan or an explicit API
preset; Draw and web search use separately billed API access. No Codex installation
is needed. The [credential contract](../../contracts/credentials.md) owns sign-in,
shared credentials and migration.

### Query from Raycast

Follow [Raycast setup and behavior](docs/raycast.md).

### Look up selected text

Follow [Services setup and use](docs/surfaces.md#look-up-selected-text).

## Illustration

See [image and search actions](docs/surfaces.md#image-and-search-actions).

## Configure connections, presets and actions

See [Connections and actions](docs/surfaces.md#connections-and-actions).

## Selectors and keyboard shortcuts

See the [surface guide](docs/surfaces.md#selectors-and-shortcuts) and
[keyboard reference](../../design/keyboard.md).

## Local data

[Shared data ownership](../../docs/architecture.md#data-ownership) defines the
history, configuration and credential stores. [Native persistence](docs/architecture.md#persistence-contract)
defines save/recovery behavior; [Keychain access](docs/keychain.md) explains signing
and access limits. Local history is plaintext and is not encrypted by EZ.

## Development

Use [contributing](CONTRIBUTING.md) for setup, tool pins, hooks and CI;
[tests](Tests/README.md) for focused checks;
[design](docs/design.md) for disposable native previews;
[verification](docs/verification.md) for evidence and acceptance gaps;
and [releasing](docs/releasing.md) for signing and distribution.
Gate membership lives in the [Makefile](Makefile) and
[shared hook configuration](../../.pre-commit-config.yaml).
Future candidates live in the [roadmap](docs/roadmap.md).

## Official integration references

See [architecture references](docs/architecture.md#official-integration-references).

This is a local personal project. No distribution license has been selected.
A release for other people requires the steps in the release guide.
