# Keychain access

EZ uses macOS Keychain to keep you signed in between launches. The macOS access
prompt protects the saved credential item; it is separate from the browser page
where you grant EZ permission to use your ChatGPT plan.

## What EZ stores and reads

`KeychainStore` queries one generic-password item with service
`local.ez.app.chatgpt` and account `accounts`. That item contains EZ's account
profiles, OAuth access/refresh/identity tokens, granted scopes, expiration times,
issued client IDs, and installation host ID. Refresh tokens let EZ renew an
expired session without another browser login.

EZ does not receive or store your ChatGPT password. Its code does not enumerate
your Keychain or query other apps' passwords. This describes the implementation,
not an operating-system sandbox guarantee: the current development app is not
App Sandbox enabled. Keychain still enforces its own item access controls.

If macOS asks for a password in the Keychain dialog, it is the Keychain password
(usually your Mac login password), not your ChatGPT password. Enter it only into
the system dialog. EZ receives the allowed item's contents, not that password.

## The permission choices

For a prompt identifying EZ and its credential item:

| Choice | Effect |
| --- | --- |
| Allow Once / Allow | Permit this access; later accesses can ask again. |
| Always Allow | Remember access for this app and item. This is not blanket permission for all apps or all Keychain items. |
| Deny | Prevent this access. EZ cannot restore the saved login; local history remains available. |

Labels can vary by macOS version. See Apple's
[Keychain access explanation](https://support.apple.com/guide/keychain-access/kyca1243/mac).
EZ does not change item permissions to allow all applications or bypass the prompt.

## Why a rebuild can ask again

The default `make app` build is ad-hoc signed. Inspection with
`codesign -d -r- dist/EZ.app` shows a designated requirement based on the binary's
code hash. When code changes, that identity can change too, so an earlier
permission may not recognize the rebuilt executable. Keeping the same filename
or bundle ID alone does not establish signing continuity.

A stable signing identity is part of the [release plan](releasing.md). It helps
macOS recognize updates, but cannot guarantee the absence of all Keychain prompts.
See Apple's [code-signing and Keychain requirements](https://developer.apple.com/library/archive/technotes/tn2206/).

## History and sign-out

Queries and answers live separately in the local plaintext `history.jsonl`; they
are not in Keychain. Signing out clears the selected account's tokens after
attempting remote revocation. EZ retains registration metadata for future sign-in
and does not delete your history. If revocation cannot be confirmed, EZ shows it.
