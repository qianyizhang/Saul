# Offline checks

EZ keeps Apple Command Line Tools support: `EZChecks` and `EZStateChecks` are
native Swift executables, without XCTest, Swift Testing, or third-party packages.
`EZCheckSupport` is linked only into checks, not the application.

| Directory | Owner |
| --- | --- |
| `EZChecks/` | Core behavior: templates, presets, configuration, history, launcher, identity, Responses, Images, typed actions, authentication |
| `EZChecks/Fixtures/` | Synthetic credentials, signed identities, per-session HTTP fixtures |
| `EZStateChecks/` | AppModel actions with fresh offline storage and controlled execution adapters where needed |
| `Support/` | Named-case runner, source-location assertions, bounded fixture signals |

```sh
make test
make test-core CHECK_ARGS='--filter "auth: overlapping"'
make test-state CHECK_ARGS='--filter "deletion"'
make test-core CHECK_ARGS='--list'
make test CHECK_ARGS='--reverse'
make test-install
make test-services  # Host-native callback/pasteboard checks, separate from the offline gate
make test-ui        # Host-native row hit targets; requires a macOS graphical session
```

`test-install` checks the real build and installation scripts with disposable app
directories and mock compiler, icon, signing, and process tools. It verifies pinned,
explicit, and unconfigured signing selection, rejection before
replacement, copy/rename failures, signal recovery, and previous-bundle retention;
it does not access personal Keychain items or install an app. `make check` includes
these checks. Real certificate continuity and native launch are separate checks
recorded in [verification](../docs/verification.md).

Use `EZ_SWIFTPM_DISABLE_SANDBOX=1` in an outer agent sandbox that rejects
SwiftPM's nested sandbox. All checks remain offline and use disposable storage.

Register a `CheckCase` in the appropriate behavior file. Its runner-supplied
directory is unique and removed after success or failure. Construct each fixture
inside the case and close HTTP sessions / shut down models with `defer`.
AppModel fixtures seed configuration before initialization to avoid personal
UserDefaults. Never use real account credentials, Keychain, or app history.
Attempt cases explicitly supply the production `AttemptExecution` module with
controlled credential, stream and append adapters, then call AppModel Send, Stop,
Save again and deletion actions. Ordinary offline models still refuse Send.
The shared `contracts/fixtures/attempts.json` scenarios exercise both apps' common
saved-outcome rules without harmonizing their storage or status types.

Assert an observable contract. `expect` reports file and line; `expectEqual`
also reports expected and actual values. Use `expectThrows` / `expectAsyncThrows`
with an expected error type and, where meaningful, a predicate for status/code or
error details. Do not accept arbitrary thrown errors. Set up failure conditions
outside the operation being checked so a setup failure cannot satisfy rejection.

HTTP handlers and request logs belong to one ephemeral session, routed through a
locked registry. Every request is intercepted, including unregistered requests,
so a fixture mistake fails locally. Held responses plus `CheckSignal` coordinate
overlapping operations without sleeps; signal waits expire after three seconds and respond to cancellation. Handler
failures also notify observers, retaining assertion locations through URLSession.

Ordinary failures are collected while later cases run. `make test` runs both
executables even if the first reports failures. Empty filters / selections and
unknown options fail rather than pretending to run checks. Cases run serially;
`--reverse` checks for order dependence. A case stuck for 15 seconds terminates
its executable once with the case name: a non-cooperative task cannot safely be
abandoned and allowed to leak into later cases.

`scripts/check.sh state` builds the normal app and compiles its `AppModel.swift` and
`ProviderState.swift` alongside the state cases, linking SwiftPM's core/support objects. This keeps
app-only state out of EZCore and requires no Xcode test host. These checks do not
launch the native interface or prove focus, layout, shortcuts, or live inference;
those remain separate acceptance checks in `docs/verification.md`.

Native layout and keyboard regression journeys are maintained in
[docs/ui-qa.md](../docs/ui-qa.md). They run against the disposable surface preview,
using actual production views; they are separate from this offline executable suite.

`make test-ui` hosts the production `FullRowButton` in native windows and sends
window-local mouse events. It checks short/longer labels, selected/unselected rows,
blank space, padding, corners, outside bounds, disabled controls, and native keyboard
activation. No global input, Accessibility permission, account, or personal storage
is used. It is separate from `make check` because it needs a graphical session;
run it for row interaction changes, then replay the
[row click journey](../docs/ui-qa.md#row-click-targets).

`make test-services` checks the Services plist/Objective-C selector and exercises
the production callback with private named pasteboards and a disposable offline
AppModel. It checks Unicode delivery, no automatic submission, unchanged source
pasteboard and clipboard change counts, and reported errors. It needs access to
the macOS pasteboard server; request specific approved execution if the outer
agent sandbox blocks it. It does not launch EZ, read clipboard contents, or prove
Services menu discovery, cold launch, focus return, or live inference.

Typed-action checks cover legacy Write defaults, shared Draw preset preservation,
exact compiled prompts, explicit API tiers, owner-only PNG persistence/deletion,
path/symlink rejection, unavailable provider/type/key blockers, Stop/late-result
isolation and save-only recovery with the original bytes and no second request.

## Tooling and previews

`make` is the public entry point. `scripts/check.sh` owns core/state, Services,
row interaction and preview-source checks. `scripts/lib/swift-build.sh` owns
compiler flags and module/object discovery for SwiftPM and Xcode build layouts;
missing required objects fail before linking. `make test-tooling` tests both
layouts with disposable files and is part of `make check`.

Offline preview app sources live in `Tests/Previews/`; `make design-preview`,
`make configuration-preview` and `make surface-preview` package them through
`scripts/preview.sh`. The Services callback check lives in `Tests/Services/`.
These are development fixtures, not shipped application resources. Build,
installation, signing and tool bootstrap scripts stay separate because they own
different effects and recovery contracts.
