#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
case "${1:-}" in
    design) label="EZ Design Preview"; executable="EZDesignPreview";;
    configuration) label="EZ Configuration Preview"; executable="EZConfigurationPreview";;
    surface) label="EZ Surface Preview"; executable="EZSurfacePreview";;
    *) printf 'Usage: bash scripts/preview.sh design|configuration|surface\n' >&2; exit 1;;
esac
kind="$1"
export CLANG_MODULE_CACHE_PATH="$PWD/.build/module-cache"
./scripts/swift.sh build --product EZ
bin_dir=$(./scripts/swift.sh build --show-bin-path)
objects=()
while IFS= read -r file; do
    case "$file" in */EZCore.build/*.o) objects+=("$file");; esac
done < "$bin_dir/EZ.product/Objects.LinkFileList"
sources=()
for file in Sources/EZ/*.swift; do
    case "$file" in */EZApp.swift) ;; *) sources+=("$file");; esac
done
mkdir -p dist
preview="$PWD/dist/$label.app"
staging=$(mktemp -d "$PWD/dist/.ez-preview.XXXXXX")
staged_app="$staging/$label.app"
cleanup() {
    if [[ -e "$staging/previous.app" && ! -e "$preview" ]]; then
        if ! mv "$staging/previous.app" "$preview"; then
            printf 'Previous preview preserved at %s\n' "$staging/previous.app" >&2
            return 1
        fi
    fi
    rm -rf "$staging"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p "$staged_app/Contents/MacOS"
xcrun swiftc -parse-as-library -target "$(uname -m)-apple-macos14.0" -module-cache-path "$CLANG_MODULE_CACHE_PATH" \
    -I "$bin_dir/Modules" "scripts/$kind-preview.swift" "${sources[@]}" "${objects[@]}" \
    -o "$staged_app/Contents/MacOS/$executable"
cat > "$staged_app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>$label</string>
<key>CFBundleIdentifier</key><string>local.ez.$kind-preview</string>
<key>CFBundleExecutable</key><string>$executable</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
</dict></plist>
PLIST
codesign --force --sign - "$staged_app"
codesign --verify --strict "$staged_app"
if [[ -e "$preview" ]]; then mv "$preview" "$staging/previous.app"; fi
mv "$staged_app" "$preview"
printf 'Built offline preview: %s\n' "$preview"
