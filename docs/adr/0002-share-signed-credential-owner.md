# Give shared connections one signed credential owner

Accepted 2026-11-04; implemented in `7ea6793`.

Use one independently installed signed macOS executable for opted-in Saul and
EZ connections. Sharing tokens between app-owned clients would leave two refresh
writers and ambiguous account ownership. A signed Keychain identity lets the
owner serialize refresh and serve explicit account operations without handing
long-lived secrets to Chrome or EZ. Keep standalone browser connections
independent; shared mode adds a signing and caller-validation requirement and
loses access when its owner is unavailable. The migration adopts Saul's
existing connections; EZ's duplicate registrations and keys are not merged.

The [credential contract](../../contracts/credentials.md) owns current behavior.
