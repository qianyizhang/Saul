# Keychain access

EZ uses macOS Keychain to keep you signed in between launches. The macOS access
prompt protects the saved credential item; it is separate from the browser page
where you grant EZ permission to use your ChatGPT plan.

Credential restoration runs away from the UI actor, so the window and local
history remain responsive while macOS waits for access. No account state is
replaced until the complete read succeeds; cancelling startup discards a late result.

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

Without local signing setup, `make app` is ad-hoc signed. Inspection with
`codesign -d -r- dist/EZ.app` shows a designated requirement based on the binary's
code hash. When code changes, that identity can change too, so an earlier
permission may not recognize the rebuilt executable. Keeping the same filename
or bundle ID alone does not establish signing continuity.

For personal use, create a persistent self-signed code-signing identity, pin it
with `make signing-setup`, and use `make install` for upgrades. Configured builds
reuse that certificate; a missing identity stops installation rather than silently
switching to ad-hoc signing. See [local signing setup](releasing.md#local-signing-and-installation).
This establishes a stable designated requirement, but it does **not** establish
prompt-free Keychain upgrades. The file-based Keychain also enforces a partition
policy. Apple's Security implementation uses a stable `teamid:` partition for
recognized Apple-issued developer signing and falls back to `cdhash:` for other
signed code, including this self-signed build. A changed binary has a changed code
hash even when its certificate and designated requirement stay the same.

The Oct 16 installed upgrade reproduced a prompt. Read-only metadata inspection of
EZ's single item found a `cdhash:` partition matching the new executable and five
trusted-app records, including the installed path. The previous executable used
the same certificate/designated requirement but a different code hash. This
explains why a remembered app entry alone is insufficient here; **Always Allow**
does not establish recognition of future changed hashes. No item permissions or
credentials were changed during the inspection.

Apple-issued development or Developer ID signing with a stable Team ID is the
appropriate route to test for prompt-free upgrades. It is a separate signing setup,
not implemented by the local self-signed certificate. Do not remove partition
checks or allow all applications to work around this behavior. A same-build restart
and a changed-build upgrade are separate acceptance checks.
See Apple's [code-signing and Keychain requirements](https://developer.apple.com/library/archive/technotes/tn2206/)
and [partition selection implementation](https://github.com/apple-oss-distributions/Security/blob/main/securityd/src/clientid.cpp).

## History and sign-out

Queries and answers live separately in the local plaintext `history.jsonl`; they
are not in Keychain. Signing out clears the selected account's tokens after
attempting remote revocation. EZ retains registration metadata for future sign-in
and does not delete your history. If revocation cannot be confirmed, EZ shows it.
