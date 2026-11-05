# Keychain access

The signed **Saul** owner holds shared ChatGPT sign-ins and the official OpenAI API
key for Chrome and EZ. Validated native connections request operations; long-lived
secrets never enter the UI. Custom browser endpoints remain Saul-local.
The [credential contract](../../../contracts/credentials.md) owns protocol,
migration, caller checks and failure handling.

## Stored items

| Generic-password service       | Account    | Contents                                                                 |
| ------------------------------ | ---------- | ------------------------------------------------------------------------ |
| `com.saul.credentials.chatgpt` | `accounts` | Original Saul registrations, host ID, identity and rotating OAuth tokens |
| `com.saul.credentials.openai`  | `api-key`  | Official OpenAI API key                                                  |

Availability checks read attributes, not unused secrets. OAuth secret reads run off
the UI actor; a kernel lock serializes refresh/writes across owner processes.
Missing owner blocks without local fallback. No app receives your Mac login
password; enter it only in a system Keychain dialog.

Migration preserves Saul registrations and retires EZ duplicates only after both
clients verify the owner. Writes are verified before source removal; denied,
malformed or changed sources remain with an error. Private `migration.json` holds
verification metadata, never tokens.

## Permission choices

For a system prompt naming Saul and its item (labels vary by macOS):

| Choice             | Effect                                                      |
| ------------------ | ----------------------------------------------------------- |
| Allow Once / Allow | Permit this access; later access may ask again.             |
| Always Allow       | Remember this app/item, not all apps or all Keychain items. |
| Deny               | Block saved-login access; local history remains available.  |

See [Apple's explanation](https://support.apple.com/guide/keychain-access/kyca1243/mac).
Do not allow all applications or bypass partition checks to suppress prompts.

## Why a rebuild can ask again

Ad-hoc signatures can change identity with the executable hash. Filename/bundle ID
alone does not preserve access. Legacy self-signed builds also encountered a
separate file-based Keychain partition policy: `cdhash:` changes even with the same
certificate/designated requirement. The Oct 16 upgrade reproduced a prompt;
read-only inspection found the current hash partition and five trusted-app records.
No permissions or credentials were changed. Always Allow for that build did not
prove future-build recognition.

Recognized Apple-issued developer signing uses a stable `teamid:` partition.
Use the [Apple Development signing setup](releasing.md#local-signing-and-installation)
and pinned `make install` upgrades. Legacy self-signing is for old/offline builds.
Same-build restart, standalone probe and installed changed-build acceptance are
separate checks. Two changed probes passed on 2026-11-04; installed results and
certificate/OS limits live in [verification](verification.md).
See [Apple's requirements](https://developer.apple.com/library/archive/technotes/tn2206/)
and [partition selection](https://github.com/apple-oss-distributions/Security/blob/main/securityd/src/clientid.cpp).

## History and sign-out

History/image blobs live in shared `Little Clarity/history.sqlite3`, outside
Keychain. Sign-out attempts revocation, clears the selected account's tokens and
affects both apps; unconfirmed revocation is shown. Registration/host metadata and
history remain. Disconnect app removes only that app's binding to the owner.
