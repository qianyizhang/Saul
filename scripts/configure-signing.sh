#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/signing.sh

if [[ -f "$ez_signing_file" ]]; then
    pinned=$(ez_read_signing_identity)
    if [[ -z "${EZ_SIGNING_IDENTITY:-}" || "$EZ_SIGNING_IDENTITY" == "$pinned" ]]; then
        ez_require_signing_identity "$pinned"
        printf 'Reusing pinned signing identity %s\n' "$pinned"
        exit 0
    fi
fi

selector="${EZ_SIGNING_IDENTITY:-EZ Local Signing}"
identities=$(security find-identity -v -p codesigning)
matches=$(awk -v selector="$selector" '
    $2 == selector || substr($0, index($0, "\"")) == "\"" selector "\"" { print $2 }
' <<< "$identities")
if [[ -z "$matches" || "$matches" == *$'\n'* ]]; then
    printf 'Expected exactly one valid code-signing identity named %s (or supply its fingerprint).\n' "$selector" >&2
    printf 'Create it in Keychain Access first; see docs/releasing.md. No identity was changed.\n' >&2
    exit 1
fi
if [[ -n "${pinned:-}" && "$matches" != "$pinned" ]]; then
    printf 'A different identity is already pinned. Restore it rather than silently rotating the signing identity.\n' >&2
    exit 1
fi
umask 077
mkdir -p .local
temporary=$(mktemp "$PWD/.local/.signing-identity.XXXXXX")
trap 'rm -f "$temporary"' EXIT
printf '%s\n' "$matches" > "$temporary"
mv "$temporary" "$ez_signing_file"
printf 'Pinned local signing identity %s in %s\n' "$matches" "$ez_signing_file"
