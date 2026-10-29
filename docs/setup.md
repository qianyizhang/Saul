# Selective setup

The root coordinator installs only selected components. It is a local command,
not a published npm package. Run `node scripts/setup.mts --help` for all options.
EZ can also be built/installed directly with Make and Apple tools without Node.

| Selection   | Requires                                                     | Does not require                     |
| ----------- | ------------------------------------------------------------ | ------------------------------------ |
| `extension` | Chrome; Node 24 and pinned pnpm to build                     | EZ, helpers, Codex                   |
| `chatgpt`   | Installed extension ID, Node 24, native host registration    | EZ, Codex                            |
| `tabs`      | Installed extension ID, Node 24, native host registration    | EZ, Codex unless registering MCP     |
| `actions`   | Installed extension ID, Node 24, native host registration    | EZ, tabs helper, Codex               |
| `ez`        | macOS, Apple tools, pinned signing identity for installation | Saul, helper, Node at runtime, Codex |

Chrome on-device inference remains disabled. Extension-only reading can use an
OpenAI-compatible provider. ChatGPT sign-in/inference and built-in tab summaries
require `chatgpt`; external tab tools and native Chrome window names require `tabs`.
Custom Summarize actions require the optional `actions` helper and an existing
saved model preset. A ChatGPT preset still requires `chatgpt`. The action host
does not take over credentials. See [custom actions](../apps/saul/docs/custom-actions.md).

## First installation

```sh
# Inspect the plan first. Omit --dry-run to build and copy the extension.
node scripts/setup.mts --components extension --dry-run
node scripts/setup.mts --components extension
```

Load the printed directory explicitly in `chrome://extensions` (Developer mode,
Load unpacked). Copy its actual ID. Then install wanted helpers:

```sh
node scripts/setup.mts --components chatgpt,tabs --extension-id YOUR_ID
# Add --codex only if you want Codex MCP registration.
```

`--prepare` builds without installing. `--skip-build` uses prepared browser
artifacts. For an interactive selection, run the command without arguments in a
terminal. The coordinator stops after a failed command; completed components may
remain installed. Inspect them with `--verify` before retrying.

To install EZ from this monorepo (quit EZ first):

```sh
make -C apps/ez install
# Or use the optional coordinator:
node scripts/setup.mts --components ez
```

On a new machine, first follow [local signing setup](../apps/ez/docs/releasing.md#local-signing-and-installation),
then `make -C apps/ez signing-setup`.
The existing installer refuses replacement while EZ is running, preserves signing
identity, verifies the staged bundle and retains a rollback copy.

## Existing installations and repository migration

Moving source does not authorize replacing an installed extension. Existing
unpacked installations may derive identity from their load path: retain the old
loaded directory until an explicit identity/data migration is verified. Never
remove/re-add the extension merely to point it at the monorepo. The root installer
refuses an existing extension destination. It is a first-install coordinator;
upgrading a loaded extension remains an explicit operation on its established path.

The helper installer stages and verifies complete runtime generations under
`~/.saul/generations/`. `bridge` is the single managed activation link; `bin`
points into it. Chrome's host paths, `bin/saul`, and the existing Codex command
`bridge/mcp.mjs` remain stable. Each launch resolves one generation, so an already
running process keeps its original modules and board assets while new connections
use the activated version. Installation never kills, resends, or restarts work.

Tab, ChatGPT and action payloads are separate within a generation. Updating one copies the
other installed payloads and their Node/proxy configuration unchanged. Credentials stay
in `~/.saul/chatgpt`; socket state stays in its existing runtime directory. Neither
is part of a generation. Registrations retain their exact extension IDs and the
selected helper's existing allowed origins. Preserve each installation-time Node
executable until the corresponding helper is reinstalled with a new one.

### One-time helper migration

The old flat `bridge/` cannot be replaced safely while its processes may reread
files. For its first upgrade, disconnect both native connections in Saul Settings
and stop the Saul MCP connection in Codex. Select **every helper already installed**
for this migration; after migration, they can again be upgraded independently.

```sh
node scripts/setup.mts --components chatgpt,tabs --extension-id YOUR_ID --migrate-legacy
```

Use only the installed helper selection (for example `tabs` alone if ChatGPT was
never installed). `--migrate-legacy` confirms the manual disconnected maintenance
window; it does not disconnect applications for you. Visible legacy processes or
an uncertain installation stop activation. Process inspection is diagnostic, not
a race-free guarantee against another app reconnecting during this one-time step.
Reconnect only after the command succeeds. The old directories are retained in a
printed `.legacy-<id>/` directory; no credential file is moved.

### Failed preparation and explicit recovery

Missing files, invalid modules, and failed activation keep the prior active
selection and restore any changed registrations. An installation transaction is
serialized; a second installer refuses to run concurrently. After a process exits
mid-transaction, rerunning the installer recovers its journal before new work. An
uncertain or externally changed journal/registration is preserved and reported
instead of overwritten. A generation already selected at the atomic commit is
verified and retained during recovery; it is not silently rolled back.

The installer prints the previous generation after a managed upgrade. To select a
retained generation explicitly, use its printed identifier:

```sh
pnpm --dir apps/saul native:install --install-dir "$HOME/.saul" --restore-generation GENERATION_ID
```

Recovery verifies the entire payload and restores that generation's registrations,
including its allowed origins. Existing processes remain on their original version;
reconnect to use the selected version. A startup failure never triggers automatic
fallback. Old generations and legacy backups are retained in this slice; no
background cleanup deletes files still in use. Unselected staging directories are
not active runtimes.

EZ's ignored `apps/ez/.local/signing-identity` is not supplied by Git. On this Mac,
the migration retains the existing fingerprint without exporting any private key.
Other machines must perform their own explicit signing setup. Keep bundle ID,
Keychain service, URL scheme and `~/Applications/EZ.app` stable. Installed history
and credentials remain untouched.

The coordinator refuses to overwrite an existing `saul-tabs` Codex registration.
Omit `--codex` to preserve it. The browser application's advanced
[read-only connection checker](../apps/saul/docs/native-messaging.md) can verify a matching existing
connection with a read-only live inventory; this is separate from artifact checks.

## Verify and remove

```sh
node scripts/setup.mts --components extension --verify
node scripts/setup.mts --components chatgpt,tabs --extension-id YOUR_ID --verify
node scripts/setup.mts --components ez --verify
```

Verification checks the selected helper generation inventory, file hashes and
registrations, extension artifacts, or the app signature. Legacy helpers receive
only a file/registration check, with an explicit generation-integrity limitation;
read-only verification does not migrate them. Verification never claims browser connectivity, live authentication, inference or running-version
acceptance. Use disposable profiles for development browser tests.

Remove the extension through Chrome only when its profile-local data is no longer
needed. Native helpers are separately removable using the documented
[helper lifecycle](../apps/saul/docs/native-messaging.md) and
[ChatGPT helper guide](../apps/saul/docs/chatgpt-plan.md).
Removing EZ.app does not remove its history or Keychain credentials; handle those
through the app's documented account/history actions first. No coordinator uninstall
command silently erases user records, accounts, shared runtimes or registrations.
