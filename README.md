# EZ

A small native Mac app for definitions, spelling checks, and quick answers.
SwiftUI UI, direct OpenAI Responses API, and history saved on your Mac.

## Run

Requires macOS 14+ and Apple Command Line Tools with Swift 6+ (`xcode-select --install`).
No third-party packages, API key, or Codex installation are required.

```sh
make check
make app
open dist/EZ.app
```

In EZ, open **Account & settings → Continue with ChatGPT**, finish sign-in in your
browser, and allow ChatGPT plan usage. Select a model and effort, choose a mode,
then press **⌘ Return**. **⌘ N** starts a new lookup and **⌘ .** stops generation.
You can copy answers, export Markdown, and search previous lookups.

macOS may ask whether **EZ** can access its Keychain item to save or restore your
sign-in. EZ queries only its own credential record. Locally signed development
rebuilds can trigger another prompt; refusing access keeps history available but
prevents the saved sign-in from loading.
See [Keychain access](docs/keychain.md) for the stored data, permission choices,
and why a rebuild can ask again. The same explanation is available in Settings.

ChatGPT plan access depends on account eligibility and rollout. The integration
uses OAuth with explicit `chatgpt.tokens.use.direct` permission, then
`POST https://api.openai.com/v1/responses` with `store: false` and `stream: true`.
Fast requests priority service only when advertised by the model catalog; it can
consume more allowance and is not a guarantee of latency. Use **Manage usage** in
settings to inspect your app allowance. No fallback API billing is configured.

## Local data

- Queries/answers: `~/Library/Application Support/EZ/history.jsonl`, owner-only.
- Credentials, issued client IDs, and host ID: macOS Keychain (`local.ez.app.chatgpt`).
- Model, effort, and Fast preferences: saved when changed under bundle ID `local.ez.app`.
- Build products: ignored `.build/` and `dist/`; regenerate them with `make app`.

History is append-only: a query is saved before sending, followed by a terminal
snapshot with the same ID. The latest valid snapshot wins; abandoned pending
requests appear interrupted on restart. Queries are sent to OpenAI, and previous
lookups are not sent. Local history is plaintext; it is not encrypted by EZ.

## Development

| Command | Purpose |
| --- | --- |
| `make build` | Compile the native app |
| `make test` | Run offline security/protocol/storage contracts |
| `make check` | Formatting, compile, and contract checks |
| `make format` | Apply the repository Swift format |
| `make app` | Build and locally sign `dist/EZ.app` |
| `make run` | Build and open the app |

Inside an agent sandbox that rejects nested SwiftPM sandboxing, prefix commands
with `EZ_SWIFTPM_DISABLE_SANDBOX=1`. This does not disable the outer sandbox.

Read [contributor guidance](CONTRIBUTING.md), [architecture](docs/architecture.md),
[verification](docs/verification.md), [release process](docs/releasing.md), and
[roadmap](docs/roadmap.md). CI runs offline checks on macOS; it does not log in to
ChatGPT or spend plan usage. This repository has no third-party runtime dependencies.

## Official integration references

- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts and refresh](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and Responses](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview constraints](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

This is a local personal project. No distribution license or remote repository
has been selected. A release for other people requires the steps in the release guide.
