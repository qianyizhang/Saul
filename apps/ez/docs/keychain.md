# Keychain access

The signed **Saul** owner holds shared ChatGPT sign-ins and the official OpenAI API
key for Chrome and EZ. Validated native connections request operations. Custom
endpoints added through the signed owner have their own connection-bound keys.
Legacy browser-only profiles stay local until explicitly replaced.
The [credential contract](../../../contracts/credentials.md) owns protocol,
retirement, caller checks and failure handling.

## Stored items

| Generic-password service       | Account    | Contents                                                                 |
| ------------------------------ | ---------- | ------------------------------------------------------------------------ |
| `com.saul.credentials.chatgpt` | `accounts` | Shared Saul registrations, host ID, identity and rotating OAuth tokens |
| `com.saul.credentials.openai`  | `api-key`  | Official OpenAI API key                                                  |
| `com.saul.credentials.connections` | `api-key` | Keys bound to managed custom connections |

Availability checks read attributes, not unused secrets. OAuth secret reads run off
the UI actor; a kernel lock serializes refresh/writes across owner processes.
Missing owner blocks without local fallback. No app receives your Mac login
password; enter it only in a system Keychain dialog.

The owner leaves legacy credential records untouched. Current shared
registrations and account pauses are retained; if there is no shared sign-in,
connect explicitly. Private `migration.json` retains prior verification metadata
and account pauses, never tokens.

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
certificate/designated requirement. Accepting one build's prompt gives evidence
for that build only.

Recognized Apple-issued developer signing uses a stable `teamid:` partition.
Use the [Apple Development signing setup](releasing.md#local-signing-and-installation)
and pinned `make install` upgrades. Legacy self-signing is for old/offline builds.
Same-build restart, standalone probe and installed changed-build acceptance are
separate checks. See the [dated installed baseline](verification.md#installed-baseline--2026-11-04).
See [Apple's requirements](https://developer.apple.com/library/archive/technotes/tn2206/)
and [partition selection](https://github.com/apple-oss-distributions/Security/blob/main/securityd/src/clientid.cpp).

## History and sign-out

See the [credential contract](../../../contracts/credentials.md#retirement-and-removal)
for the scope of Sign out and Disconnect app. The [shared History store](../../../contracts/history.md)
holds history and image blobs separately from the Keychain.
