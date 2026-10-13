#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/swift.sh build -c release --product EZ
bin_dir=$(./scripts/swift.sh build -c release --show-bin-path)
app="$PWD/dist/EZ.app"
mkdir -p dist
staging=$(mktemp -d "$PWD/dist/.ez-build.XXXXXX")
staged_app="$staging/EZ.app"
cleanup() {
    # Restore the previous bundle if replacement was interrupted.
    if [[ -e "$staging/previous.app" && ! -e "$app" ]]; then
        if ! mv "$staging/previous.app" "$app"; then
            printf 'Previous app preserved at %s\n' "$staging/previous.app" >&2
            return 1
        fi
    fi
    rm -rf "$staging"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p "$staged_app/Contents/MacOS" "$staged_app/Contents/Resources"
cp "$bin_dir/EZ" "$staged_app/Contents/MacOS/EZ"
cp Resources/Info.plist "$staged_app/Contents/Info.plist"
CLANG_MODULE_CACHE_PATH="$PWD/.build/module-cache" swift scripts/icon.swift "$PWD/.build/EZ.iconset"
iconutil -c icns .build/EZ.iconset -o "$staged_app/Contents/Resources/EZ.icns"
# Ad-hoc signing is for local development. Distribution requires a stable
# Developer ID identity and notarization; see docs/releasing.md.
codesign --force --sign "${EZ_SIGNING_IDENTITY:--}" "$staged_app"
codesign --verify --strict "$staged_app"
if [[ -e "$app" ]]; then mv "$app" "$staging/previous.app"; fi
mv "$staged_app" "$app"
printf 'Built %s\n' "$app"
