#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/signing.sh

replace=""
if [[ $# != 0 ]]; then
    if [[ $# != 2 || "$1" != --replace-pinned || ! "$2" =~ ^[[:xdigit:]]{40}$ ]]; then
        printf 'Usage: configure-signing.sh [--replace-pinned EXPECTED_CURRENT_FINGERPRINT]\n' >&2
        exit 1
    fi
    replace="$2"
fi

if [[ -f "$ez_signing_file" ]]; then
    pinned=$(ez_read_signing_identity)
    if [[ -n "$replace" && "$replace" != "$pinned" ]]; then
        printf 'The signing pin changed. No identity was replaced.\n' >&2
        exit 1
    fi
    if [[ -z "${EZ_SIGNING_IDENTITY:-}" || "$EZ_SIGNING_IDENTITY" == "$pinned" ]]; then
        ez_require_signing_identity "$pinned"
        printf 'Reusing pinned signing identity %s\n' "$pinned"
        exit 0
    fi
fi
if [[ -n "$replace" && -z "${pinned:-}" ]]; then
    printf 'There is no existing signing pin to replace.\n' >&2
    exit 1
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
if [[ -n "${pinned:-}" && "$matches" != "$pinned" && -z "$replace" ]]; then
    printf 'A different identity is already pinned. Restore it rather than silently rotating the signing identity.\n' >&2
    exit 1
fi
umask 077
mkdir -p .local
if [[ -n "$replace" ]]; then
    backup="$PWD/.local/signing-identity.previous-$pinned"
    if [[ -e "$backup" ]]; then
        if [[ -L "$backup" || "$(cat "$backup")" != "$pinned" ]]; then
            printf 'Existing signing recovery file differs; no pin was changed.\n' >&2
            exit 1
        fi
    else
        printf '%s\n' "$pinned" > "$backup"
    fi
    printf 'Previous signing fingerprint retained at %s\n' "$backup"
fi
temporary=$(mktemp "$PWD/.local/.signing-identity.XXXXXX")
trap 'rm -f "$temporary"' EXIT
printf '%s\n' "$matches" > "$temporary"
mv "$temporary" "$ez_signing_file"
printf 'Pinned local signing identity %s in %s\n' "$matches" "$ez_signing_file"
