#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/signing.sh
ez_resolve_signing_identity
if [[ "$ez_signing_identity" == - ]]; then
    printf 'Saul credentials require a pinned Apple-issued signing identity.\n' >&2
    exit 1
fi
extension_id="${SAUL_EXTENSION_ID:-}"
legacy_manifest="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.saul.chatgpt.json"
if [[ -z "$extension_id" && -f "$legacy_manifest" ]]; then
    origin=$(plutil -extract allowed_origins.0 raw -o - "$legacy_manifest")
    if [[ "$origin" =~ ^chrome-extension://([a-p]{32})/$ ]]; then extension_id="${BASH_REMATCH[1]}"; fi
fi
if [[ -n "$extension_id" && ! "$extension_id" =~ ^[a-p]{32}$ ]]; then
    printf 'Invalid Saul extension ID.\n' >&2
    exit 1
fi
./scripts/swift.sh build -c release --product SaulCredentials
bin_dir=$(./scripts/swift.sh build -c release --show-bin-path)
mkdir -p dist
staging=$(mktemp -d "$PWD/dist/.saul-credentials-build.XXXXXX")
trap 'rm -rf "$staging"' EXIT
app="$staging/Saul.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$bin_dir/SaulCredentials" "$app/Contents/MacOS/Saul"
cp -R "$bin_dir/EZ_EZCore.bundle" "$app/Contents/Resources/"
info="$app/Contents/Info.plist"
plutil -create xml1 "$info"
plutil -insert CFBundleIdentifier -string local.saul.credentials "$info"
plutil -insert CFBundleName -string Saul "$info"
plutil -insert CFBundleDisplayName -string Saul "$info"
plutil -insert CFBundleExecutable -string Saul "$info"
plutil -insert CFBundlePackageType -string APPL "$info"
plutil -insert CFBundleVersion -string 1 "$info"
plutil -insert CFBundleShortVersionString -string 0.1.0 "$info"
plutil -insert LSMinimumSystemVersion -string 14.0 "$info"
plutil -insert LSUIElement -bool YES "$info"
plutil -insert SaulAllowedExtensionIDs -json '[]' "$info"
if [[ -n "$extension_id" ]]; then plutil -insert SaulAllowedExtensionIDs.0 -string "$extension_id" "$info"; fi
plutil -insert SaulLegacyAccountsPath -string "${SAUL_LEGACY_ACCOUNTS_PATH:-$HOME/.saul/chatgpt/accounts.json}" "$info"
codesign --force --sign "$ez_signing_identity" --options runtime --timestamp=none "$app"
codesign --verify --strict "$app"
team=$(codesign -dv --verbose=4 "$app" 2>&1 | sed -n 's/^TeamIdentifier=//p')
if [[ ! "$team" =~ ^[A-Z0-9]{10}$ ]]; then
    printf 'Saul credentials require Apple-issued signing with a Team ID.\n' >&2
    exit 1
fi
codesign --verify -R "=anchor apple generic and identifier \"local.saul.credentials\" and certificate leaf[subject.OU] = \"$team\"" "$app"
target="$PWD/dist/Saul Credentials.app"
if [[ -e "$target" ]]; then mv "$target" "$staging/previous.app"; fi
if ! mv "$app" "$target"; then
    if [[ -e "$staging/previous.app" ]]; then mv "$staging/previous.app" "$target"; fi
    exit 1
fi
printf 'Built %s\n' "$target"
