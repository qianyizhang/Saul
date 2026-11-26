# Verification

## Repeatable offline gate

- **Run** — [Toolchain and commands](../CONTRIBUTING.md#development-setup-and-gates). Gate membership lives in the [Makefile](../Makefile).
- **Evidence** — [Offline cases and filters](../Tests/README.md). Core and app-state suites both run even if one fails. Fixtures use disposable storage, isolated HTTP, synthetic credentials and fixed-clock identity checks.
- **SwiftPM** — Use `EZ_SWIFTPM_DISABLE_SANDBOX=1 make check` if nested manifest sandboxing fails. The outer sandbox stays active. Differently capitalized checkout paths can require clearing generated state.
- **Packaging** — Validate the bundle through [the release guide](releasing.md). Icon dimensions alone cannot establish `iconutil` success.

## Recently deleted · 2026-11-26

The isolated Surface Preview restored a saved lookup with its original answer, moved it back
to Recently deleted, and permanently removed it after confirmation. The other deleted lookup
remained available. Dark Standard mode exposed both actions. Down selected a row and Escape
returned to the Library. [Preview journey](ui-qa.md#recently-deleted)

## Native and live acceptance

| Goal                                | Evidence                                                                                                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run the candidate                   | `make app`. Quit the older instance and open `dist/EZ.app`. Inspect the main window, Quick Lookup and Settings.                                                                        |
| Verify access                       | Complete sign-in as the account holder. Confirm selected account, permission and catalog.                                                                                              |
| Verify inference and save           | Standard Dictionary yields streamed text, completion and pending/completed SQLite snapshots under one UUID. Supported Fast Spell Check records requested and returned tier separately. |
| Verify restart and failure recovery | Account and history restore. Check affected cancellation, search, Copy/Export and shortcuts. [Sign-out scope](keychain.md#history-and-sign-out)                                        |
| Verify Quick Lookup                 | Esc focus return, fresh invocation, main handoff, minimum size, full-screen Spaces, multiple displays and shortcut-conflict fallback.                                                  |
| Verify real native conditions       | [UI journeys](ui-qa.md). Use the installed app for selection, Services, Raycast, hardware scrolling, system Reduce Motion and changed-build Keychain access.                           |
| Verify live service behavior        | Record access, inference, real latency and billing separately from offline previews.                                                                                                   |

## Dated evidence

- **Scope** — Results apply only to the recorded baseline.

### Installed baseline — 2026-11-04

- **Credentials** — Shared owner installed in both apps. Live model discovery passed across two changed signed builds. Both clients retired old credentials. API-key continuity used synthetic Keychain items. No live inference, image or speech request.
- **Signing** — Personal Team certificate expires 2027-11-04. Developer ID and notarization were outside scope. Certificate, Team ID, ACL, OS or installation changes need renewed acceptance. Retain recovery bundles and previous pin until normal use is confirmed. Review by 2026-12-04.
- **History** — Imported 74 EZ entries (three images), 16 Saul passages, 18 attempts and 17 summary batches. Integrity and foreign-key checks passed. Retired stores were removed after import. No provider request.

### Lookup choosers and reader — 2026-11-16

- **At `42f092a`** — 102 core, 65 state and 10 window-local checks passed. Verified chooser search, Escape/focus, unavailable rows and synthetic wheel.
- **Preview** — Both surfaces including 420-point Quick Lookup, Draw/Sketch/Research, active/failed Draw and an unsaved Write.
- **Limits** — ScreenCaptureKit denied capture. View snapshots omit native compositing. Physical wheel, VoiceOver, native dialogs, installed and live provider behavior were outside verification. [UI journeys](ui-qa.md)

### Make meme Sketch — 2026-11-11

- **At `b14b7c2`** — 101 core and 60 state checks passed. Verified stroke and caption pixels, late-import rejection after removal, saved source before send, editable draft after failure and exact frozen-source Reuse.
- **Limits** — Preview launched and capture was denied. Physical gestures, Quick Lookup handoff, minimum-size layout and live generation were outside verification.
