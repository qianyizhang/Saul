# Selective setup

- **Coordinator** — Run `node scripts/setup.mts --help` from the repository root. No arguments opens the interactive selector in a terminal.
- **Preview or prepare** — `--dry-run` shows the plan. `--prepare` builds without installing. `--skip-build` uses prepared browser artifacts.
- **Partial failure** — Completed components may remain installed. Check them with `--verify` before retrying.

| Component   | Outcome                                                      | Requires                                                                                               |
| ----------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `extension` | Saul Chrome UI                                               | Chrome, Node 24 and pinned pnpm to build, `chatgpt` helper to use shared storage                       |
| `chatgpt`   | History, configuration and presets for all browser providers | Actual extension ID, Node 24 and native host registration                                              |
| `tabs`      | Optional CLI/MCP tab access and native Chrome window names   | Actual extension ID and Node 24. Codex only for MCP registration                                       |
| `actions`   | Optional [custom Calls](../apps/saul/docs/custom-actions.md) | Actual extension ID, Node 24 and a saved model preset                                                  |
| `ez`        | Native EZ and its signed credential owner                    | macOS 14+, Swift 6.3+ and [Apple signing](../apps/ez/docs/releasing.md#local-signing-and-installation) |

- **ChatGPT plan** — [Signed macOS owner](#shared-saul-credentials-on-macos) in addition to the storage helper.
- **API routes** — Browser-owned connections keep local keys. Compatible endpoints work without ChatGPT sign-in. See [provider choices](../apps/saul/docs/product.md#settings-and-models).
- **Native-only setup** — EZ builds and installs through Make and Apple tools without Node. [Toolchain](../apps/ez/CONTRIBUTING.md#development-setup-and-gates)

## First installation

Run these commands from the repository root.

### Saul for Chrome

1. **Build and copy the extension.** Run `node scripts/setup.mts --components extension`.
2. **Load it in Chrome.** Open `chrome://extensions`, enable **Developer mode**, then use **Load unpacked** with the directory printed by setup. Copy Saul’s extension ID from Chrome.
3. **Install the required history and settings helper.** Run `node scripts/setup.mts --components chatgpt --extension-id YOUR_ID` with that ID, even if you use an API key instead of a ChatGPT plan.
4. **Check the install.** Run the extension and `chatgpt` checks under [Verify and remove](#verify-and-remove). Open Saul’s **History** in Chrome and confirm that it loads without a storage error. An empty history is valid on first install.

For optional Codex tab access, include `tabs` in step 3 and pass `--codex`, then [connect and verify](../apps/saul/docs/native-messaging.md#connect-and-verify). To use a ChatGPT plan, follow [plan setup](../apps/saul/docs/chatgpt-plan.md#setup).

### EZ for macOS

1. **Set up signing.** Follow [local signing](../apps/ez/docs/releasing.md#local-signing-and-installation) to pin your Apple Development identity.
2. **Install EZ.** Quit any running copy. Run `make -C apps/ez install` to install EZ and its signed credential owner without Node. If you already use Node, `node scripts/setup.mts --components ez` runs the same install.
3. **Check the install.** Verify the installed signature with `codesign --verify --strict "$HOME/Applications/EZ.app"`, then open that copy and confirm the main window opens. For an exact payload comparison, see [Verify and remove](#verify-and-remove). Check account access and live inference separately in [EZ verification](../apps/ez/docs/verification.md#native-and-live-acceptance).

## Existing installations and repository migration

| Invariant                  | Outcome                                                                                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extension load path and ID | Keep the loaded directory until an explicit identity- and data-preserving upgrade. Removing and re-adding can change identity. The coordinator refuses an existing destination.        |
| Helper entry paths         | Complete generations live under `~/.saul/generations/`. `bridge` selects one generation. `bin` points into it. Chrome host paths, `bin/saul` and `bridge/mcp.mjs` stay stable.         |
| Running work               | Each launch resolves one generation. Existing processes keep their modules and board assets. Activation neither stops work nor resends requests.                                       |
| Installed components       | Updating one payload copies the other installed payloads and Node/proxy configuration. Preserve actual extension IDs, allowed origins and each pinned Node executable until reinstall. |
| Local state                | Keep socket state, signed Keychain credentials and legacy `~/.saul/chatgpt` files outside generations.                                                                                 |
| EZ                         | Keep bundle ID, URL scheme and `~/Applications/EZ.app` stable. The ignored signing pin stays under [local signing](../apps/ez/docs/releasing.md#local-signing-and-installation).       |
| Codex                      | Existing `saul-tabs` registration blocks replacement. Omit `--codex` to preserve it. [Read-only connection check](../apps/saul/docs/native-messaging.md#connect-and-verify)            |

If Saul reports an outdated storage helper, repeat the [history and settings
helper setup](#saul-for-chrome) with the existing extension ID. Older browser
builds may show **Invalid ChatGPT request.** when a retired helper rejects a
local storage operation such as saving an annotation. After updating the
helper, reload Saul in `chrome://extensions` and refresh the affected page.

### One-time helper migration

- **Goal** — Convert the old flat `bridge/` layout to generations while preserving installed payloads and credentials.
- **Required window** — Disconnect native connections in Saul Settings and stop Saul MCP in Codex. Select every installed helper. Running or uncertain legacy processes block activation.
- **Example** — `node scripts/setup.mts --components chatgpt,tabs --extension-id YOUR_ID --migrate-legacy`
- **Outcome** — Old directories retained at the printed `.legacy-<id>/` path. Reconnect after success. The flag confirms the manual disconnect and process inspection cannot prevent a race with a new connection.

### Failed preparation and explicit recovery

| Condition                          | Outcome                                                                                                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing, invalid or failed payload | Prior generation stays selected. Changed registrations are restored.                                                                                                                         |
| Concurrent installer               | Second installer refuses to run.                                                                                                                                                             |
| Interrupted transaction            | Rerun to recover the journal before new work. Uncertain or externally changed state stays in place for inspection. A committed generation is verified and kept.                              |
| Rollback requested                 | Use the printed prior generation ID with the command below. Verification covers the complete payload and registrations, including allowed origins. Reconnect to use the restored generation. |

```sh
pnpm --dir apps/saul native:install --install-dir "$HOME/.saul" --restore-generation GENERATION_ID
```

- **Retention** — Old generations and legacy backups stay available. Unselected staging directories are inactive. Startup failure has no automatic fallback.

### Shared history upgrade

- **Compatibility** — Upgrade both apps and Saul’s history helper together before reopening a changed schema.
- **Import** — Saul reads legacy profile OPFS at first history access. EZ reads prior JSONL and images at launch.
- **Recovery** — Preserve the original data. Reopen History or relaunch EZ after interrupted cleanup. Resolve validation errors before retrying. [Import and deletion guarantees](../contracts/history.md)

## Verify and remove

| Goal                            | Outcome                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Publish a delivered app version | Saul uses [package.json](../apps/saul/package.json). EZ uses [Info.plist](../apps/ez/Resources/Info.plist), with separate numeric `CFBundleVersion`. Use numeric MAJOR.MINOR.PATCH. Bump patch for fixes, minor for compatible features and major for breaking changes. Bump each affected app independently of protocol and schema versions. |
| Identify an exact build         | App-owned input lists include dirty and untracked source. Extend them for new inputs. [Saul inputs](../apps/saul/build-inputs.json), [EZ inputs](../apps/ez/build-inputs.json), [Version · Build display](../DESIGN.md#settings)                                                                                                              |
| Verify extension or EZ payload  | Build from current inputs first. `--verify` checks missing, changed and extra files and checks EZ’s signature separately. Pass `--extension-dir` for an established different load path. Read-only checks accept Saul’s direct WXT output.                                                                                                    |
| Verify installed helpers        | `--verify` compares the generation inventory, hashes and registrations against a current `build:native` receipt. Legacy file/registration checks lack generation freshness.                                                                                                                                                                   |
| Remove an app or profile        | Shared history and credentials remain. Use explicit history deletion or account sign-out.                                                                                                                                                                                                                                                     |
| Unregister the history helper   | Disconnect the extension. Remove only `com.saul.chatgpt.json` from the printed native-host directory. Preserve legacy credential files and [managed generations](../apps/saul/docs/native-messaging.md#access-and-troubleshooting).                                                                                                           |

```sh
node scripts/setup.mts --components extension --verify
node scripts/setup.mts --components chatgpt --extension-id YOUR_ID --verify
node scripts/setup.mts --components ez --verify
```

- **Built** — A current prepared artifact exists. This does not check the copy on disk at the install path.
- **Installed** — The commands above compare the installed payload with the current prepared build. Include `tabs` or `actions` in the helper check only if you installed them. The checks do not inspect running app versions.
- **Connected** — Check the path you intend to use: [Codex tab access](../apps/saul/docs/native-messaging.md#connect-and-verify) or [plan account and model access](../apps/saul/docs/chatgpt-plan.md#setup). Neither check runs inference.
- **Live request completed** — For Saul, use the [live digest check](../apps/saul/docs/testing.md#explicit-live-digest-check). For EZ, use [native and live acceptance](../apps/ez/docs/verification.md#native-and-live-acceptance). These checks use a live provider and can consume plan allowance or incur API charges.

## Shared Saul credentials on macOS

- **Installation and update order** — Install the [Apple-signed owner](../apps/ez/docs/releasing.md#local-signing-and-installation) before updating either client. New clients reject older owners that can import on account read.
- **Binding** — Chrome uses **Settings → Preferences → Integrations → Connect to Saul** with its existing extension ID. EZ uses the same owner. Either UI can run alone.
- **Migration** — Shared registrations and pauses stay available. Old credential records remain untouched. For a standalone-only registration, sign in through Connections and choose the account explicitly.
- **Ownership** — [Credential compatibility and retry](../contracts/credentials.md#retirement-and-removal).
