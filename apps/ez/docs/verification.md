# Verification

## Repeatable offline gate

From `apps/ez`, run `make tools` once, then `make check`. The [Makefile](../Makefile)
owns gate membership; [CONTRIBUTING](../CONTRIBUTING.md#development-setup-and-gates)
explains tool setup, hooks and hosted execution. Tool versions and hashes live in
[bootstrap-tools.sh](../scripts/bootstrap-tools.sh). The gate does not open preview
windows or establish live-service behavior.

[Tests/README.md](../Tests/README.md) owns cases, filtering and fixture rules.
`make test` runs core and app-state suites even if one fails. The native
harnesses need no XCTest, Swift Testing or third-party framework.
The app and previews need SwiftUI's compiler plug-ins.
App suites use disposable storage, isolated HTTP handlers and synthetic credentials,
not live accounts, network or personal Keychain. Identity checks use generated RSA
keys and a fixed clock. Separate credential acceptance uses isolated test storage.

If SwiftPM’s nested manifest sandbox fails, use
`EZ_SWIFTPM_DISABLE_SANDBOX=1 make check`;
the outer sandbox stays active and caches stay in `.build/`. After `make clean`,
restore tools with `make tools`. Duplicate modules from differently capitalized
checkout paths require clearing generated state. Icon dimensions alone do not
prove `iconutil` packaging; report sandbox restrictions separately.

## Native and live acceptance

1. `make app`; quit older EZ, open `dist/EZ.app`, inspect main/panel/Settings.
2. Complete ChatGPT sign-in yourself; verify account, permission and model catalog.
3. Send a short Dictionary lookup on Standard: streamed text, terminal completion,
   and pending/completed SQLite snapshots under one UUID.
4. Send Spell Check with supported Fast; distinguish requested from returned tier.
5. Restart for account/history restoration. Check affected cancellation, search,
   Copy/Export and shortcuts. Logout explicitly ends the shared account session.
6. For Quick Lookup, check Esc focus return, fresh invocation, main handoff,
   minimum size, full-screen Spaces, multiple displays and shortcut-conflict fallback.
7. Replay affected [UI journeys](ui-qa.md). Offline previews do not establish
   installed selection/Services/Raycast delivery, hardware scrolling, system Reduce
   Motion, Keychain continuity, API access, real latency or billing.


## Dated evidence

### Installed baseline — 2026-11-04

- **Credentials:** Shared Saul owner installed in both apps; live model discovery
  passed across two changed signed builds and both clients retired old credentials.
  No live inference/image/speech request was made. API-key continuity used synthetic
  Keychain items. These results apply to that baseline, not later source.
- **Signing:** Personal Team certificate expires 2027-11-04; not Developer ID or
  notarization. Certificate, Team ID, ACL, OS or installation changes need renewed
  acceptance. Retain recovery bundles/previous pin until normal use is confirmed;
  review by 2026-12-04.
- **History:** Imported 74 EZ entries (three images), 16 Saul passages, 18 attempts
  and 17 summary batches. SQLite integrity/foreign keys passed; retired stores were
  removed after import. No provider request was sent.

### Lookup choosers and reader — 2026-11-16

Based on `42f092a`. 102 core, 65 state and 10 window-local checks passed.
Chooser search, Escape/focus, skipped unavailable rows and synthetic wheel
passed. Offline Surface Preview exercised both surfaces (including 420-point
Quick Lookup), Draw/Sketch/Research, active/failed Draw and an unsaved Write.
ScreenCaptureKit denied capture; view snapshots omit native compositing.
Physical wheel, VoiceOver, native dialogs, installed and live provider behavior
were not verified. Repeat through the [UI journeys](ui-qa.md).

### Make meme Sketch — 2026-11-11

`b14b7c2`: 101 core and 60 state checks passed. Verified stroke and caption
pixels, late-import rejection after removal, saved source before send,
editable draft after failure and exact frozen-source Reuse. Preview built and
launched; capture was denied. Physical gestures, Quick Lookup handoff,
minimum-size layout and live generation were not verified.
