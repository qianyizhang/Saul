#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export CLANG_MODULE_CACHE_PATH="$PWD/.build/module-cache"
./scripts/swift.sh build --product EZ
bin_dir=$(./scripts/swift.sh build --show-bin-path)
preview="$PWD/dist/EZ Design Preview.app"
mkdir -p "$preview/Contents/MacOS"
# Link only objects listed by the current EZCore build, excluding stale removed sources.
objects=()
while IFS= read -r file; do
    case "$file" in */EZCore.build/*.o) objects+=("$file");; esac
done < "$bin_dir/EZ.product/Objects.LinkFileList"
# Use the current view set; a clean checkout needs no optional Quick Lookup files.
views=()
for file in Sources/EZ/*.swift; do
    case "$file" in */EZApp.swift) continue;; esac
    views+=("$file")
done
xcrun swiftc -parse-as-library -target "$(uname -m)-apple-macos14.0" -module-cache-path "$CLANG_MODULE_CACHE_PATH" -I "$bin_dir/Modules" \
    scripts/design-preview.swift "${views[@]}" \
    "${objects[@]}" -o "$preview/Contents/MacOS/EZDesignPreview"
cat > "$preview/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>EZ Design Preview</string>
<key>CFBundleIdentifier</key><string>local.ez.design-preview</string>
<key>CFBundleExecutable</key><string>EZDesignPreview</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
</dict></plist>
PLIST
codesign --force --sign - "$preview"
printf 'Built offline preview: %s\n' "$preview"
