# Building and releasing

| Goal                     | Outcome                                                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build for local review   | `make app` stages, signs and verifies `dist/EZ.app`. Without a pin, the development build is ad-hoc. Quit the running app before opening a candidate. |
| Replace an installed app | `make install` uses the pinned identity and keeps a rollback copy. [Local signing](#local-signing-and-installation)                                   |
| Distribute externally    | [Distribution gate](#distribution)                                                                                                                    |

## Local signing and installation

- **Certificate** — Create **Apple Development** in Xcode → Settings → Accounts. The shared owner requires an Apple-issued certificate and Team ID. This plain macOS executable needs no provisioning profile. Private keys stay in Keychain.
- **Initial pin** — From `apps/ez`, `EZ_SIGNING_IDENTITY="APPLE_DEVELOPMENT_SHA1" make signing-setup`. Accepts a name or fingerprint. Stores the fingerprint in ignored `.local/signing-identity`.
- **Pin continuity** — `make app`, `make run` and `make install` reuse the pin. An unavailable identity stops the build. Development overrides are allowed. Installation rejects a different fingerprint. `make clean` preserves the pin and Keychain.
- **Explicit change or renewal** — Supply the exact old fingerprint. The old pin stays at `.local/signing-identity.previous-OLD_SHA1`. Keys stay in place.

```sh
EZ_SIGNING_IDENTITY="NEW_SHA1" bash scripts/configure-signing.sh --replace-pinned OLD_SHA1
```

| Operation                      | Acceptance                                                                                                                                                                                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install EZ                     | Quit EZ before `make install`. The staged copy beside `~/Applications/EZ.app` must match the certificate and bundle ID. A same-certificate upgrade must match the installed designated requirement.                                                                               |
| Install the credential owner   | `make install` also installs signed `~/Library/Application Support/Little Clarity/Credentials/Saul.app` and registers `com.saul.credentials`. Use `make credentials-install` for the owner alone. Set `SAUL_EXTENSION_ID` if the existing history host manifest cannot supply it. |
| Recover from failed activation | App replacement retains `~/Applications/.ez-upgrade.XXXXXX/previous.app` and attempts restoration on interruption. Owner activation failure restores the previous owner bundle and manifest.                                                                                      |
| Roll back EZ                   | Quit EZ and restore `previous.app` to `~/Applications/EZ.app`. Preserve the newer bundle if needed. Keychain and history remain in place.                                                                                                                                         |
| Verify                         | Confirm normal operation before removing the backup. [Changed-build Keychain checks](keychain.md#why-a-rebuild-can-ask-again), [installed acceptance](verification.md#native-and-live-acceptance)                                                                                 |

- **Client binding and update order** — [Shared credential setup](../../../docs/setup.md#shared-saul-credentials-on-macos).

## CI artifact

- **Deliverable** — `EZ-macos.zip` for the runner’s architecture, retained for 14 days on main or manual workflows. Ad-hoc development signing. [Native workflow](../../../.github/workflows/native.yml)

## Distribution

| Gate                       | Required outcome                                                                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization and identity | Explicit user direction, license and stable owned bundle identifier. [Installed identity rules](../../../docs/setup.md#existing-installations-and-repository-migration)                                                    |
| Plan eligibility           | Confirm current Sign in with ChatGPT terms and eligibility.                                                                                                                                                                |
| Signing and Gatekeeper     | Developer ID, hardened runtime, entitlements, notarization and stapling. A local Apple Development identity alone is insufficient. [Apple signing policies](https://developer.apple.com/library/archive/technotes/tn2206/) |
| Clean-machine acceptance   | Launch, changed-build Keychain access, OAuth, live inference, logout, history recovery and accessibility.                                                                                                                  |
| Publication                | Version, changelog, verified artifact and hash.                                                                                                                                                                            |

- **Service scope** — No auto-update endpoint, analytics or telemetry.
