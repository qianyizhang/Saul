# Building and releasing

`make app` generates `dist/EZ.app` from the Swift package and `Resources/Info.plist`.
The default signature is ad-hoc, suitable for this Mac. Open the app from the same
path between runs. macOS may request Keychain access again after an ad-hoc rebuild.

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
auto-update endpoint, analytics, telemetry service, or remote repository is configured.
