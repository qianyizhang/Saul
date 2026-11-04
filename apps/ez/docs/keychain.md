# Keychain access

The signed **Saul** native owner holds shared ChatGPT sign-ins and the official
OpenAI API key for Saul in Chrome and EZ. Apps request operations through a
validated native connection; long-lived keys and tokens never enter their UI.
Custom OpenAI-compatible browser connections remain local to Saul in Chrome.
See the [credential contract](../../../contracts/credentials.md).

## What Saul stores and reads

Two file-based Keychain generic-password records remain separate:

| Service | Account | Contents |
| --- | --- | --- |
| `com.saul.credentials.chatgpt` | `accounts` | Original Saul registrations, host ID, identity and rotating OAuth tokens |
| `com.saul.credentials.openai` | `api-key` | Official OpenAI API key |

Availability checks request attributes without decrypting unused provider secrets.
The owner reads a secret only for the requested operation. OAuth reads run off the
UI actor. A kernel lock serializes refresh and writes across owner processes;
process death releases it. A missing helper blocks explicitly without local fallback.
No app receives the Mac login password; enter it only in a system Keychain dialog.

Migration preserves Saul's original registrations. It discards EZ duplicates after
both clients verify the owner. Verified writes precede source retirement. Denied
access, malformed sources and changed sources are reported and retained. The
owner's private `migration.json` contains verification metadata, never tokens.

## The permission choices

For a prompt identifying Saul and its credential item:

| Choice | Effect |
| --- | --- |
| Allow Once / Allow | Permit this access; later accesses can ask again. |
| Always Allow | Remember access for this app and item. This is not blanket permission for all apps or all Keychain items. |
| Deny | Prevent this access. Saul cannot restore the saved login; local history remains available. |

Labels can vary by macOS version. See Apple's
[Keychain access explanation](https://support.apple.com/guide/keychain-access/kyca1243/mac).
EZ does not change item permissions to allow all applications or bypass the prompt.

## Why a rebuild can ask again

Without local signing setup, `make app` is ad-hoc signed. Inspection with
`codesign -d -r- dist/EZ.app` shows a designated requirement based on the binary's
code hash. When code changes, that identity can change too, so an earlier
permission may not recognize the rebuilt executable. Keeping the same filename
or bundle ID alone does not establish signing continuity.

For this shared owner, use an Apple Development certificate from Xcode’s free Personal Team, pin it
with `make signing-setup`, and use `make install` for upgrades. Legacy self-signed
certificates remain usable only for old app builds and offline development. Configured builds
reuse that certificate; a missing identity stops installation rather than silently
switching to ad-hoc signing. See [local signing setup](releasing.md#local-signing-and-installation).
This establishes a stable designated requirement, but it does **not** establish
prompt-free Keychain upgrades. The file-based Keychain also enforces a partition
policy. Apple's Security implementation uses a stable `teamid:` partition for
recognized Apple-issued developer signing and falls back to `cdhash:` for other
signed code, including the former self-signed build. A changed binary has a changed code
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
not supplied by a self-signed certificate. The two changed standalone probes passed
on 2026-11-04; installed owner acceptance is recorded separately. Do not remove partition
checks or allow all applications to work around this behavior. A same-build restart
and a changed-build upgrade are separate acceptance checks.
See Apple's [code-signing and Keychain requirements](https://developer.apple.com/library/archive/technotes/tn2206/)
and [partition selection implementation](https://github.com/apple-oss-distributions/Security/blob/main/securityd/src/clientid.cpp).

## History and sign-out

Queries, answers and image blobs live in the shared local `Little Clarity/history.sqlite3`; they
are not in Keychain. Signing out clears the selected account's tokens after
attempting remote revocation. Saul retains registration metadata for future sign-in
and does not delete your history. If revocation cannot be confirmed, the requesting app shows it. Sign-out affects both apps;
Disconnect app keeps the shared connection and only removes that app’s binding.
