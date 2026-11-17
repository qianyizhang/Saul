# Selective setup

The root coordinator installs only selected components. It is a local command,
not a published npm package. Run `node scripts/setup.mts --help` for all options.
EZ requires macOS 14+ and Apple Command Line Tools with Swift 6.3+
(`xcode-select --install`). It can also be built/installed directly with Make and
Apple tools without Node.

| Selection   | Requires                                                                     | Does not require                  |
| ----------- | ---------------------------------------------------------------------------- | --------------------------------- |
| `extension` | Chrome, history/configuration helper; Node 24 and pinned pnpm to build       | EZ, tabs/actions helpers, Codex   |
| `chatgpt`   | Installed extension ID, Node 24, native host registration                    | EZ, Codex                         |
| `tabs`      | Installed extension ID, Node 24, native host registration                    | EZ, Codex unless registering MCP  |
| `actions`   | Installed extension ID, Node 24, native host registration                    | EZ, tabs helper, Codex            |
| `ez`        | macOS, Apple tools, pinned Apple signing; installs the Saul credential owner | Chrome UI, Node at runtime, Codex |

The `chatgpt` component keeps its installation name and provides browser history,
configuration and presets for all providers. Local OpenAI-compatible connections
do not require ChatGPT sign-in. ChatGPT plan presets, including those used for tab
summaries, also require the [signed credential owner](#shared-saul-credentials-on-macos).
Chrome on-device inference is retired; saved selections require an explicit
provider change. External tab tools and native Chrome window names require `tabs`.
Custom Summarize actions require the optional `actions` helper and a saved
model preset. See [custom actions](../apps/saul/docs/custom-actions.md).

## First installation

```sh
# Inspect the plan first. Omit --dry-run to build and copy the extension.
node scripts/setup.mts --components extension --dry-run
node scripts/setup.mts --components extension
```

Load the printed directory explicitly in `chrome://extensions` (Developer mode,
Load unpacked). Copy its actual ID. Then install the history/configuration helper; add `tabs`
only for optional tab access:

```sh
node scripts/setup.mts --components chatgpt --extension-id YOUR_ID
# Add tabs to --components and --codex only if you want Codex MCP registration.
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

Tab, history/configuration and action payloads are separate within a generation.
Updating one copies the other installed payloads and their Node/proxy
configuration unchanged. Active ChatGPT credentials are in the shared Keychain;
old files in `~/.saul/chatgpt` are preserved. Socket state stays in its existing
runtime directory. Neither credential nor socket state is part of a generation.
Registrations retain their exact extension IDs and the
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

Use only the installed helper selection (for example `tabs` alone if the
history/configuration helper was never installed). `--migrate-legacy` confirms
the manual disconnected maintenance
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

EZ's ignored `apps/ez/.local/signing-identity` is not supplied by Git. Signing-pin
replacement requires an explicit transition that preserves the old pin and does
not export a private key. Follow the [signing guide](../apps/ez/docs/releasing.md#local-signing-and-installation).
Keep bundle ID, URL scheme and `~/Applications/EZ.app` stable.

The coordinator refuses to overwrite an existing `saul-tabs` Codex registration.
Omit `--codex` to preserve it. The browser application's advanced
[read-only connection checker](../apps/saul/docs/native-messaging.md) can verify a matching existing
connection with a read-only live inventory; this is separate from artifact checks.

### Shared history upgrade

Upgrade both apps and Saul's history helper together before reopening shared
history when a release changes the schema. On first history access, Saul imports
its browser profile's OPFS history; EZ imports its old JSONL and images at launch.
Keep the original data and reopen History or relaunch EZ if cleanup is interrupted.
If validation blocks import, preserve the source and resolve the reported error
before retrying. The [history contract](../contracts/history.md) defines what must
commit before legacy data can be removed.

## Verify and remove

Saul and EZ are versioned independently. Saul's version owner is
`apps/saul/package.json`; EZ's version owner is `apps/ez/Resources/Info.plist`
(`CFBundleShortVersionString`, with a separate numeric `CFBundleVersion`). Keep
three-part numeric semantic versions: patch for compatible fixes, minor for
compatible features, major for intentional breaking product changes. Bump each
affected app for its next delivered version; a shared change bumps both only when
both apps change. Versions do not replace history-schema or transport versions.

Each app's `build-inputs.json` owns the sources used for Build ID; dirty and
untracked inputs count. Hash selected source bytes and build tools without
changing installed identity. Extend that list for new build inputs.
[Design](../DESIGN.md#settings) owns Version · Build presentation.

```sh
node scripts/setup.mts --components extension --verify
node scripts/setup.mts --components chatgpt,tabs --extension-id YOUR_ID --verify
node scripts/setup.mts --components ez --verify
```

Pass `--extension-dir` with the established loaded path when it differs from the
default. Read-only verification also permits an extension loaded directly from
`apps/saul/.output/chrome-mv3`; installation there remains refused.

Extension and EZ verification require a prepared build from the current selected
source inputs. They compare the complete installed payload with that reference,
rejecting changed, missing and extra files even when the version is unchanged.
The native signature is checked separately. Verification does not build or write
files; run the ordinary build first if the reference is absent or stale.
Helper verification checks the selected generation inventory, file hashes and
registrations against the current prepared helper build, including its packaged
dependencies. It requires a current `build:native` receipt. Legacy helpers cannot
prove freshness; use the explicit generation migration before this verification.
Standalone legacy integrity checks through the helper lifecycle still provide
only a file/registration check, with an explicit generation-integrity limitation;
read-only verification does not migrate them. Verification never claims browser connectivity, live authentication, inference or running-version
acceptance. Use disposable profiles for development browser tests.

Removing EZ, Saul or its profile leaves shared history and credentials intact.
Delete history or sign out explicitly. To unregister the history/configuration
helper, disconnect the extension and remove only `com.saul.chatgpt.json` from
the native-host directory reported by the installer. This does not sign out.
Keep legacy credential files and follow the
[helper lifecycle](../apps/saul/docs/native-messaging.md) for generation cleanup.

## Shared Saul credentials on macOS

Follow [Apple signing and owner installation](../apps/ez/docs/releasing.md#local-signing-and-installation),
then select **Connect to Saul** in Chrome’s Settings → Preferences → Integrations.
The signed host uses the existing extension ID. EZ uses the same owner, and
neither UI needs the other to be running. Local browser API profiles keep their
separate keys.

Update the signed owner before the browser or EZ client. New clients refuse
older owners: those owners can still import on an account read. The new owner
keeps existing shared registrations and pauses. It does not import, delete or
clean up old credential records. If a connection only had a standalone
registration, sign in through Connections and choose its account explicitly.
See the [credential contract](../contracts/credentials.md#retirement-and-removal)
for version compatibility and retry boundaries.
