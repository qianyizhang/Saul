# Selective setup

The root coordinator installs only selected components. It is a local command,
not a published npm package. Run `node scripts/setup.mjs --help` for all options.
EZ can also be built/installed directly with Make and Apple tools without Node.

| Selection   | Requires                                                     | Does not require                     |
| ----------- | ------------------------------------------------------------ | ------------------------------------ |
| `extension` | Chrome; Node 24 and pinned pnpm to build                     | EZ, helpers, Codex                   |
| `chatgpt`   | Installed extension ID, Node 24, native host registration    | EZ, Codex                            |
| `tabs`      | Installed extension ID, Node 24, native host registration    | EZ, Codex unless registering MCP     |
| `ez`        | macOS, Apple tools, pinned signing identity for installation | Saul, helper, Node at runtime, Codex |

Chrome on-device inference remains disabled. Extension-only reading can use an
OpenAI-compatible provider. ChatGPT sign-in/inference and tab summaries require
`chatgpt`; external tab tools and native Chrome window names require `tabs`.

## First installation

```sh
# Inspect the plan first. Omit --dry-run to build and copy the extension.
node scripts/setup.mjs --components extension --dry-run
node scripts/setup.mjs --components extension
```

Load the printed directory explicitly in `chrome://extensions` (Developer mode,
Load unpacked). Copy its actual ID. Then install wanted helpers:

```sh
node scripts/setup.mjs --components chatgpt,tabs --extension-id YOUR_ID
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
node scripts/setup.mjs --components ez
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

The helper installer copies runtime into `~/.saul`; installed copies can keep
working after source moves. Registrations allow exact extension IDs. Reinstall a
helper using that existing ID when upgrading it. Preserve the installation-time
Node executable; replacing/removing it requires reinstalling the helpers.

EZ's ignored `apps/ez/.local/signing-identity` is not supplied by Git. On this Mac,
the migration retains the existing fingerprint without exporting any private key.
Other machines must perform their own explicit signing setup. Keep bundle ID,
Keychain service, URL scheme and `~/Applications/EZ.app` stable. Installed history
and credentials remain untouched.

The coordinator refuses to overwrite an existing `saul-tabs` Codex registration.
Omit `--codex` to preserve it. The browser application's advanced
[read-only connection checker](../apps/saul/docs/setup.md) can verify a matching existing
connection with a read-only live inventory; this is separate from artifact checks.

## Verify and remove

```sh
node scripts/setup.mjs --components extension --verify
node scripts/setup.mjs --components chatgpt,tabs --extension-id YOUR_ID --verify
node scripts/setup.mjs --components ez --verify
```

Verification checks installed artifacts/registrations or the app signature. It
never claims browser connectivity, live authentication, inference or running-version
acceptance. Use disposable profiles for development browser tests.

Remove the extension through Chrome only when its profile-local data is no longer
needed. Native helpers are separately removable using the documented
[helper lifecycle](../apps/saul/docs/setup.md) and
[ChatGPT helper guide](../apps/saul/docs/chatgpt-plan.md).
Removing EZ.app does not remove its history or Keychain credentials; handle those
through the app's documented account/history actions first. No coordinator uninstall
command silently erases user records, accounts, shared runtimes or registrations.
