#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/signing.sh

if [[ ! -f "$ez_signing_file" ]]; then
    printf 'Run make signing-setup first; installation requires a persistent signing identity.\n' >&2
    exit 1
fi
pinned=$(ez_read_signing_identity)
if [[ -n "${EZ_SIGNING_IDENTITY:-}" && "$EZ_SIGNING_IDENTITY" != "$pinned" ]]; then
    printf 'Installation must use the pinned fingerprint; omit EZ_SIGNING_IDENTITY.\n' >&2
    exit 1
fi
export EZ_SIGNING_IDENTITY="$pinned"
ez_require_signing_identity "$pinned"

require_stopped() {
    local status
    if pgrep -x EZ >/dev/null; then
        printf 'Quit EZ before installing; the existing app has not been replaced.\n' >&2
        return 1
    else
        status=$?
        if [[ "$status" != 1 ]]; then
            printf 'Could not check whether EZ is running; refusing replacement.\n' >&2
            return 1
        fi
    fi
}
require_stopped
bash scripts/build-app.sh
source_app="$PWD/dist/EZ.app"
applications="${EZ_APPLICATIONS_DIR:-$HOME/Applications}"
app="$applications/EZ.app"
mkdir -p "$applications"
if [[ -L "$app" || ( -e "$app" && ! -d "$app" ) ]]; then
    printf 'Refusing to replace a symlink or non-directory at %s\n' "$app" >&2
    exit 1
fi
staging=$(mktemp -d "$applications/.ez-upgrade.XXXXXX")
cleanup() {
    if [[ -e "$staging/previous.app" && ! -e "$app" ]]; then
        if ! mv "$staging/previous.app" "$app"; then
            printf 'Restore the previous app from %s\n' "$staging/previous.app" >&2
            return 1
        fi
    fi
    if [[ ! -e "$staging/previous.app" ]]; then rm -rf "$staging"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
ditto "$source_app" "$staging/EZ.app"
codesign --verify --strict "$staging/EZ.app"
identity_requirement="=identifier \"local.ez.app\" and certificate leaf = H\"$pinned\""
codesign --verify -R "$identity_requirement" "$staging/EZ.app"

# If the installed app already uses this certificate, verify that the new app
# satisfies its saved identity requirement before replacing it.
if [[ -d "$app" ]]; then
    if codesign --verify -R "$identity_requirement" "$app" >/dev/null 2>&1; then
        codesign -d -r- "$app" > "$staging/previous-requirement.txt" 2>&1
        sed -n 's/^#\{0,1\} *designated => //p' "$staging/previous-requirement.txt" > "$staging/previous.req"
        if [[ ! -s "$staging/previous.req" ]]; then
            printf 'Could not read the installed app identity; refusing replacement.\n' >&2
            exit 1
        fi
        codesign --verify -R "$staging/previous.req" "$staging/EZ.app"
        printf 'Verified update against the installed app identity.\n'
    else
        printf 'Switching the installed app to the pinned certificate; macOS may request Keychain access once.\n'
    fi
fi
require_stopped
if [[ -e "$app" ]]; then mv "$app" "$staging/previous.app"; fi
mv "$staging/EZ.app" "$app"
printf 'Installed %s\nSigning identity: %s\n' "$app" "$pinned"
if [[ -e "$staging/previous.app" ]]; then
    printf 'Previous app retained at %s\n' "$staging/previous.app"
fi
printf 'Open it with: open "%s"\n' "$app"
