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
source scripts/lib/swift-build.sh
ez_build_product EZ
ez_link_modules EZ EZCore SaulCredentialStorage
ez_application_sources
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
ez_compile_library "Tests/Previews/$kind.swift" "${ez_app_sources[@]}" "${ez_objects[@]}" \
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
