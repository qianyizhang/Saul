#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export CLANG_MODULE_CACHE_PATH="$PWD/.build/module-cache"
./scripts/swift.sh build --product EZ
./scripts/swift.sh build --product EZChecks
bin_dir=$(./scripts/swift.sh build --show-bin-path)
objects=()
while IFS= read -r file; do
    case "$file" in */EZCore.build/*.o|*/EZCheckSupport.build/*.o) objects+=("$file");; esac
done < "$bin_dir/EZChecks.product/Objects.LinkFileList"
xcrun swiftc -parse-as-library -target "$(uname -m)-apple-macos14.0" -module-cache-path "$CLANG_MODULE_CACHE_PATH" \
    -I "$bin_dir/Modules" Sources/EZ/AppModel.swift Tests/EZStateChecks/*.swift \
    "${objects[@]}" -o "$bin_dir/EZStateChecks"
"$bin_dir/EZStateChecks" "$@"
