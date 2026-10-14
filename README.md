# EZ

A small native Mac app for definitions, spelling checks, and quick answers.
SwiftUI UI, direct OpenAI Responses API, and history saved on your Mac.

The [surface contract](docs/surfaces.md) defines the **main window** and
**Quick Lookup panel**, their core functions, and their shared workspace.

## Run

Requires macOS 14+ and Apple Command Line Tools with Swift 6.3+ (`xcode-select --install`).
The app has no third-party runtime packages and needs no API key or Codex installation.

```sh
make tools
make check
make app
open dist/EZ.app
```

In EZ, open **Settings → Account & history → Continue with ChatGPT**, finish sign-in
in your browser, and allow ChatGPT plan usage. Choose a recipe, fill its inputs,
then press **⌘ Return**. **⌘ N** starts a new lookup and **⌘ .** stops generation.
You can copy answers, export Markdown, and search previous lookups. To delete a
lookup, use **Delete lookup** below its answer or right-click its history row, then
confirm. Deletion removes its saved snapshots from this Mac and cannot be undone;
it is unavailable while a request or launcher submission is active. Your current
draft is preserved.

For quick access while EZ is running, press **⌃⌥ Space** (Control–Option–Space)
or choose **Quick Lookup** from EZ’s menu-bar icon. Type or paste text and press
**⌘ Return** after filling the recipe's inputs. The panel starts small and grows
for results; long forms and answers scroll. Click the preset label for an override,
exact request choices, and the displayed answer's actual service tier. Use the
actions menu for Configuration. **Esc** hides the panel and returns keyboard focus to
your work. A running answer continues while hidden; **⌘ .** stops it. **⌘ N** starts
a new lookup. Drafts and answers are shared with the full window, and reopening
the panel preserves them. Use its history button to open the main window. Closing
the full window leaves EZ available through the menu bar; **Quit EZ** exits it.
If another app holds the shortcut, EZ displays a warning and menu access still works.

### Query from Raycast

With EZ installed at `~/Applications/EZ.app`, add this repository's
`integrations/raycast` folder in **Raycast Settings → Script Commands** (under
Extensions in Raycast v1). Give **EZ Lookup** the alias **ez**. Then open Raycast,
type **ez**, press **Space**, type your query, and press **Return**. EZ launches if
needed and streams the answer in its compact panel. On macOS 15+, a cold launcher
start suppresses the full window; macOS 14 may also display the full window.

The command fills the selected recipe’s first input and uses its preset and the
current account. A single-field recipe submits immediately; a multi-field recipe
opens the panel for you to complete the remaining inputs and explicitly Send.
After restart, EZ selects the first remaining recipe. Raycast does not generate or bill for the
answer. Return explicitly submits single-field recipes through EZ’s existing ChatGPT plan
flow. An in-progress lookup is preserved and a second submission is refused.
If sign-in, model loading, or history storage blocks sending, the panel shows the
error and retains your query for manual retry. It does not send later on sign-in.
Escape hides the panel. The command pins the installed app, so an indexed build
in `dist` cannot steal the submission. See [Raycast integration](docs/raycast.md).

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

## Configure presets and recipes

Open **Settings → Configuration**. A **model preset** names a model, effort, and
Fast/Normal choice, for example `lit`. A **recipe** selects a default preset and
contains the entire prompt. Add `{{fuzzy term}}` and `{{fuzzy context}}` to create
two inputs with those placeholders. Repeated names share one field; all fields
are required. Templates support substitution only, without Jinja expressions.
Save each edited preset/recipe explicitly. The input preview shows the generated form.

Dictionary, Spell Check, Ask, and Lookup are editable/removable starters. They are
not restored after removal. Select a recipe during use; the preset picker can
override its default until New lookup or another recipe is selected. Unavailable
saved model/effort/Fast choices block sending rather than silently changing them.
History and Use again preserve the original recipe, inputs, and preset. See
[configuration decisions](docs/adr/0002-model-presets-and-recipes.md).

## Local data

- Queries/answers: `~/Library/Application Support/EZ/history.jsonl`, owner-only.
- Credentials, issued client IDs, and host ID: macOS Keychain (`local.ez.app.chatgpt`).
- Model presets and recipes: owner-only `~/Library/Application Support/EZ/configuration.json`.
- Previous model/effort/Fast preferences seed the initial Current preset.
- Build products: ignored `.build/` and `dist/`; regenerate them with `make app`.

History uses append-only snapshots during requests: a query is saved before
sending, followed by a terminal snapshot with the same ID. The latest valid
snapshot wins; abandoned pending requests appear interrupted on restart.
Explicit deletion atomically rewrites the
file to remove all snapshots with the selected ID. Unrelated bytes, including
damaged lines with no identifiable ID, are preserved. Queries are sent to OpenAI;
previous lookups are not sent. Local history is plaintext; it is not encrypted by EZ.

## Development

| Command | Purpose |
| --- | --- |
| `make build` | Compile the native app |
| `make test` | Run isolated offline core and app-state checks |
| `make tools` | Download checksum-pinned development linters |
| `make hooks` | Install commit and push checks (requires uv) |
| `make lint` | Swift formatting/correctness, shell, workflow, and plist checks |
| `make check` | Lint, warnings-as-errors build, complete concurrency checking, offline contracts |
| `make pre-commit` | Run commit hooks across tracked files |
| `make pre-push` | Run the full push gate |
| `make format` | Apply the repository Swift format |
| `make app` | Build and locally sign `dist/EZ.app` |
| `make run` | Build and open the app |
| `make configuration-preview` | Build editable native configuration preview with disposable offline data |
| `make surface-preview` | Review compact panel states with disposable offline data |

Inside an agent sandbox that rejects nested SwiftPM sandboxing, prefix commands
with `EZ_SWIFTPM_DISABLE_SANDBOX=1`. This does not disable the outer sandbox.
For hooks, install [uv](https://docs.astral.sh/uv/getting-started/installation/)
(`brew install uv`), then run `make hooks`. Tool downloads and hook environments
are development-only; the app still has no third-party runtime dependencies.

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
