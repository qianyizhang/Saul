#!/bin/bash
# Shared by packaging, local signing setup, and installation. Never source the
# identity file as shell code: it contains only a certificate fingerprint.
ez_signing_file="$PWD/.local/signing-identity"

ez_read_signing_identity() {
    local identity
    identity=$(cat "$ez_signing_file")
    if [[ ! "$identity" =~ ^[[:xdigit:]]{40}$ ]]; then
        printf 'Invalid signing fingerprint in %s\n' "$ez_signing_file" >&2
        return 1
    fi
    printf '%s\n' "$identity"
}

ez_require_signing_identity() {
    local identities
    identities=$(security find-identity -v -p codesigning)
    if ! awk -v selector="$1" '
        $2 == selector || substr($0, index($0, "\"")) == "\"" selector "\"" { found++ }
        END { exit found != 1 }
    ' <<< "$identities"; then
        printf 'Signing identity %s is unavailable. Restore its certificate/private key in Keychain; refusing an ad-hoc fallback.\n' "$1" >&2
        return 1
    fi
}

ez_resolve_signing_identity() {
    if [[ -n "${EZ_SIGNING_IDENTITY:-}" ]]; then
        ez_signing_identity="$EZ_SIGNING_IDENTITY"
    elif [[ -f "$ez_signing_file" ]]; then
        ez_signing_identity=$(ez_read_signing_identity) || return
    else
        ez_signing_identity="-"
    fi
    if [[ "$ez_signing_identity" != "-" ]]; then
        ez_require_signing_identity "$ez_signing_identity"
    fi
}
