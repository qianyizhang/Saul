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

| Goal                                        | Command or control                                                                                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build and copy Saul                         | `node scripts/setup.mts --components extension`                                                                                                                         |
| Load Saul and obtain its actual ID          | `chrome://extensions` → Developer mode → Load unpacked → printed directory                                                                                              |
| Install Saul’s history/configuration helper | `node scripts/setup.mts --components chatgpt --extension-id YOUR_ID`                                                                                                    |
| Add optional Codex access                   | Add `tabs` and `--codex`. [Connect and verify](../apps/saul/docs/native-messaging.md#connect-and-verify)                                                                |
| Install EZ after signing setup              | Quit EZ. Run `make -C apps/ez install` or `node scripts/setup.mts --components ez`. [Signing and rollback](../apps/ez/docs/releasing.md#local-signing-and-installation) |

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
| Verify connectivity or live use | [Browser connection check](../apps/saul/docs/native-messaging.md#connect-and-verify), [Saul tests](../apps/saul/docs/testing.md), [EZ acceptance](../apps/ez/docs/verification.md#native-and-live-acceptance)                                                                                                                                 |
| Remove an app or profile        | Shared history and credentials remain. Use explicit history deletion or account sign-out.                                                                                                                                                                                                                                                     |
| Unregister the history helper   | Disconnect the extension. Remove only `com.saul.chatgpt.json` from the printed native-host directory. Preserve legacy credential files and [managed generations](../apps/saul/docs/native-messaging.md#access-and-troubleshooting).                                                                                                           |

```sh
node scripts/setup.mts --components extension --verify
node scripts/setup.mts --components chatgpt,tabs --extension-id YOUR_ID --verify
node scripts/setup.mts --components ez --verify
```

## Shared Saul credentials on macOS

- **Installation and update order** — Install the [Apple-signed owner](../apps/ez/docs/releasing.md#local-signing-and-installation) before updating either client. New clients reject older owners that can import on account read.
- **Binding** — Chrome uses **Settings → Preferences → Integrations → Connect to Saul** with its existing extension ID. EZ uses the same owner. Either UI can run alone.
- **Migration** — Shared registrations and pauses stay available. Old credential records remain untouched. For a standalone-only registration, sign in through Connections and choose the account explicitly.
- **Ownership** — [Credential compatibility and retry](../contracts/credentials.md#retirement-and-removal).
