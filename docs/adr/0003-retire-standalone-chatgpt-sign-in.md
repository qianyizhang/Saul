# Use the signed owner for all ChatGPT sign-in

Accepted 2026-11-17. Supersedes the standalone sign-in and import paths in
[ADR 0002](0002-share-signed-credential-owner.md).

Saul's standalone Node helper and the signed owner offered separate ChatGPT
credential routes. A shared registration now has one owner for sign-in, token
refresh, account pause and plan generation. Retire the standalone route and the
old import and source cleanup. This removes the competing refresh path and
prevents an app upgrade from importing or removing legacy credentials.

Keep current shared registrations and pauses. Leave legacy records alone. If a
user only has an old standalone registration, they must sign in and choose a
connection explicitly. Existing saved requests retain their original route and
cannot switch on retry. The Node helper retains its installed identity and owns
history, configuration and presets. Browser-owned API connections still work
without the signed owner.

Use a new request envelope version so a new client cannot invoke an older
signed owner that can still import on account reads. The
[credential contract](../../contracts/credentials.md) owns compatibility and
current behavior.
