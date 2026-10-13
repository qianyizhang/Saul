#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/swift.sh build -c release --product EZ
bin_dir=$(./scripts/swift.sh build -c release --show-bin-path)
app="$PWD/dist/EZ.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$bin_dir/EZ" "$app/Contents/MacOS/EZ"
cp Resources/Info.plist "$app/Contents/Info.plist"
CLANG_MODULE_CACHE_PATH="$PWD/.build/module-cache" swift scripts/icon.swift "$PWD/.build/EZ.iconset"
iconutil -c icns .build/EZ.iconset -o "$app/Contents/Resources/EZ.icns"
# Ad-hoc signing is for local development. Distribution requires a stable
# Developer ID identity and notarization; see docs/releasing.md.
codesign --force --sign "${EZ_SIGNING_IDENTITY:--}" "$app"
codesign --verify --strict "$app"
printf 'Built %s\n' "$app"
