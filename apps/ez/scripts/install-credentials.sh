#!/bin/bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
bash scripts/build-credentials.sh
root="${SAUL_CREDENTIALS_DIR:-$HOME/Library/Application Support/Little Clarity/Credentials}"
manifest_dir="${SAUL_NATIVE_MANIFEST_DIR:-$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts}"
for path in "$root" "$manifest_dir"; do
    if [[ -L "$path" || ( -e "$path" && ! -d "$path" ) ]]; then
        printf 'Refusing unsafe credential installation directory: %s\n' "$path" >&2
        exit 1
    fi
done
mkdir -p "$root" "$manifest_dir"
chmod 700 "$root"
app="$root/Saul.app"
manifest="$manifest_dir/com.saul.credentials.json"
if [[ -L "$app" || ( -e "$app" && ! -d "$app" ) || -L "$manifest" ]]; then
    printf 'Refusing a symlink or non-directory at the installed credential owner.\n' >&2
    exit 1
fi
staging=$(mktemp -d "$root/.upgrade.XXXXXX")
activated=0
app_replaced=0
manifest_replaced=0
cleanup() {
    if [[ "$activated" != 1 ]]; then
        if [[ "$manifest_replaced" == 1 ]]; then
            if [[ -f "$staging/previous-manifest.json" ]]; then
                cp "$staging/previous-manifest.json" "$manifest" || return 1
            else
                rm -f "$manifest"
            fi
        fi
        if [[ "$app_replaced" == 1 && -d "$app" ]]; then mv "$app" "$staging/failed.app" || return 1; fi
        if [[ -d "$staging/previous.app" ]]; then mv "$staging/previous.app" "$app" || return 1; fi
    fi
    if [[ "$activated" == 1 && -d "$staging/previous.app" ]]; then
        printf 'Previous credential owner retained at %s\n' "$staging/previous.app"
    else
        rm -rf "$staging"
    fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
ditto 'dist/Saul Credentials.app' "$staging/Saul.app"
codesign --verify --strict "$staging/Saul.app"
extension_id=$(plutil -extract SaulAllowedExtensionIDs.0 raw -o - "$staging/Saul.app/Contents/Info.plist" 2>/dev/null || true)
if [[ -n "$extension_id" ]]; then
    plutil -create xml1 "$staging/manifest.json"
    plutil -insert name -string com.saul.credentials "$staging/manifest.json"
    plutil -insert description -string 'Saul shared Keychain credentials' "$staging/manifest.json"
    plutil -insert path -string "$app/Contents/MacOS/Saul" "$staging/manifest.json"
    plutil -insert type -string stdio "$staging/manifest.json"
    plutil -insert allowed_origins -json '[]' "$staging/manifest.json"
    plutil -insert allowed_origins.0 -string "chrome-extension://$extension_id/" "$staging/manifest.json"
    plutil -convert json "$staging/manifest.json"
fi
if [[ -d "$app" ]]; then mv "$app" "$staging/previous.app"; fi
mv "$staging/Saul.app" "$app"
app_replaced=1
if [[ -f "$staging/manifest.json" ]]; then
    # Registration is the final activation step; existing Chrome connections retain their process.
    if [[ -f "$manifest" ]]; then cp "$manifest" "$staging/previous-manifest.json"; fi
    manifest_replaced=1
    mv "$staging/manifest.json" "$manifest"
fi
activated=1
printf 'Installed %s\n' "$app"
