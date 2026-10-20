# Building and releasing

`make app` generates `dist/EZ.app` from the Swift package and `Resources/Info.plist`.
Without local configuration the signature is ad-hoc. Configured builds reuse the
pinned certificate below. macOS may request Keychain access again after an ad-hoc rebuild.
See [Keychain access](keychain.md) for the reason and permission choices.

Packaging creates, signs, and verifies a temporary bundle before replacing
`dist/EZ.app`. A failure before replacement leaves the previous app intact;
interrupted replacement attempts to restore it. Quit EZ before opening the new
build so the existing process does not continue running an older version.

## Local signing and installation

Create a persistent identity once in **Keychain Access → Certificate Assistant →
Create a Certificate**: name **EZ Local Signing**, identity type **Self Signed Root**,
certificate type **Code Signing**. Override the defaults if you want a longer
validity period (for example, 3,650 days). Keep the certificate and its private key
in your login Keychain. If necessary, set this certificate's **Code Signing** trust
policy to **Always Trust**; do not change its other trust policies.

Then pin the existing identity and install:

```sh
make signing-setup
# Quit EZ before installing or upgrading.
make install
open ~/Applications/EZ.app
```

`signing-setup` selects exactly one valid identity named `EZ Local Signing` and
saves its certificate fingerprint in ignored `.local/signing-identity`. To select
another existing identity on initial setup, use
`EZ_SIGNING_IDENTITY="certificate name or fingerprint" make signing-setup`.
Setup reuses an existing pin and refuses to replace it with a different certificate.
It does not create, export, or rotate private keys. Keep a secure backup of the
identity through Keychain Access if you need recovery or signing on another Mac;
recipients of the app do not need your private key.

`make app`, `make run`, and `make install` reuse the pin. If the configured identity
is unavailable, the command stops rather than reverting to ad-hoc signing.
`make clean` preserves the pin and Keychain identity. An explicit
`EZ_SIGNING_IDENTITY` overrides signing for development builds; installation
requires the pinned fingerprint and rejects an override to a different identity.

`make install` builds a release bundle and stages a verified copy beside
`~/Applications/EZ.app`. It checks the expected certificate and bundle identifier.
For an installed build using that certificate, it also checks the new build against
the installed build's identity requirement. It refuses replacement while EZ is
running. Replacement retains the old bundle under
`~/Applications/.ez-upgrade.XXXXXX/previous.app`; an interrupted replacement attempts
to restore it. Keep or remove that backup after verifying the upgrade. To roll
back, quit EZ and move `previous.app` back to `~/Applications/EZ.app`, retaining the
newer bundle elsewhere if desired. Installation does not launch EZ or change
credentials, history, or other app data.

Certificate continuity does not establish prompt-free Keychain access. The Oct 16
upgrade preserved the exact designated requirement but still prompted: the
credential item's additional partition policy was tied to the executable's code
hash. **Always Allow** can remember current access without authorizing a future
changed hash. See the [diagnosis](keychain.md#why-a-rebuild-can-ask-again).
Apple-issued developer signing with a stable Team ID is a separate setup and must
be tested with a changed-build upgrade before claiming prompt-free continuity.

Self-signing supports personal use and app identity continuity. It does not provide
Developer ID, notarization, or App Store approval. Another Mac may need manual
Gatekeeper approval. See Apple's [code-signing policies](https://developer.apple.com/library/archive/technotes/tn2206/).

## Distribution

For distribution:

1. Choose a distribution license and a stable owned bundle identifier.
2. Confirm the current Sign in with ChatGPT integration eligibility and terms.
3. Use a stable Developer ID signing identity; configure hardened runtime,
   appropriate entitlements, notarization, and stapling as part of that release work.
4. Test first launch, Keychain upgrades, OAuth callback, real inference, logout,
   history recovery, and accessibility on a clean account/machine.
5. Update bundle version and changelog. Publish only the verified artifact and its hash.

`EZ_SIGNING_IDENTITY` changes the identity passed to the build script. That alone
does not implement notarization or make this project distribution-ready. No
auto-update endpoint, analytics, or telemetry service is configured.
