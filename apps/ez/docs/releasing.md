# Building and releasing

`make app` builds `dist/EZ.app` from the Swift package and `Resources/Info.plist`.
It stages, signs and verifies before replacement; failures preserve the previous
bundle or attempt restoration after interruption. Quit older EZ before opening it.
Without a signing pin, builds are ad-hoc for offline development/CI.

## Local signing and installation

In Xcode → Settings → Accounts, use your Apple Account/Personal Team to create an
**Apple Development** certificate. The shared Saul owner requires an Apple-issued
certificate and Team ID, but no provisioning profile for this plain macOS executable.
Keep private keys in Keychain, never the repository.

From `apps/ez`:

```sh
EZ_SIGNING_IDENTITY="APPLE_DEVELOPMENT_SHA1" make signing-setup
# Quit EZ before installation.
make install
```

Setup pins the certificate fingerprint in ignored `.local/signing-identity`;
initial setup accepts a name or fingerprint. Later setup preserves the pin.
Intentional replacement requires its exact old fingerprint:

```sh
EZ_SIGNING_IDENTITY="NEW_SHA1" bash scripts/configure-signing.sh --replace-pinned OLD_SHA1
```

The old pin remains in `.local/signing-identity.previous-OLD_SHA1`. This does not
rotate/export keys. Renewal is another explicit transition; Personal Team signing
is not Developer ID or notarization.

`make app`, `make run` and `make install` reuse the pin; unavailable identity stops
the build, never falls back. `make clean` preserves it and Keychain state.
Development `EZ_SIGNING_IDENTITY` overrides are allowed, but installation rejects
a fingerprint different from the pin.

`make install`:

- Requires EZ stopped; stages a release copy beside `~/Applications/EZ.app` and
  verifies certificate/bundle ID. Same-certificate upgrades must also satisfy the
  installed build's designated requirement.
- Installs/updates the signed owner at
  `~/Library/Application Support/Little Clarity/Credentials/Saul.app`, registering
  `com.saul.credentials` for the installed extension. Set `SAUL_EXTENSION_ID` if no
  existing ChatGPT host manifest supplies it. `make credentials-install` installs
  only that owner. Owner activation failure restores its prior bundle/manifest.
- Replaces EZ and retains `~/Applications/.ez-upgrade.XXXXXX/previous.app` for
  rollback; interrupted replacement attempts restoration. It does not launch EZ
  or change credentials/history. Verify normal use before removing the backup.

To roll back, quit EZ and move `previous.app` to `~/Applications/EZ.app`, preserving
the newer bundle if needed. Bundle rollback does not undo credential migration;
old builds may need fresh sign-in. Chrome connects explicitly in Settings → Preferences → Integrations; EZ
uses the owner by default and offers Disconnect app. Neither UI must stay running.

Stable signing alone does not guarantee prompt-free Keychain upgrades.
[Keychain diagnosis](keychain.md#why-a-rebuild-can-ask-again) owns the old self-signed
failure and Team ID distinction; [verification](verification.md) records changed-build
acceptance. Never work around prompts by allowing all applications.

## CI artifact

[Native CI](../../../.github/workflows/native.yml) owns runner/toolchain pins and
packages `EZ-macos.zip` for 14 days. It preserves the bundle and targets the runner's
architecture. The ad-hoc artifact is for development, not a notarized release.

## Distribution

Public distribution needs explicit user direction and these separate steps:

1. Choose a license and stable owned bundle identifier; treat existing identities
   as migration contracts under [root setup](../../../docs/setup.md).
2. Confirm current Sign in with ChatGPT eligibility/terms.
3. Configure Developer ID, hardened runtime, entitlements, notarization and stapling.
4. Test clean-machine launch, changed-build Keychain access, OAuth, live inference,
   logout, history recovery and accessibility.
5. Update version/changelog; publish only the verified artifact and hash.

`EZ_SIGNING_IDENTITY` alone supplies none of those release guarantees. Another Mac
may need Gatekeeper approval; see [Apple's signing policies](https://developer.apple.com/library/archive/technotes/tn2206/).
No auto-update endpoint, analytics or telemetry service is configured.
