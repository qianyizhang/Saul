#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export CLANG_MODULE_CACHE_PATH="$PWD/.build/module-cache"
bin_dir=$(./scripts/swift.sh build --show-bin-path)
flags=(-swift-version 5 -warnings-as-errors -strict-concurrency=complete
    -target "$(uname -m)-apple-macos14.0" -module-cache-path "$CLANG_MODULE_CACHE_PATH")
xcrun swiftc -typecheck "${flags[@]}" scripts/icon.swift
sources=()
for file in Sources/EZ/*.swift; do
    case "$file" in */EZApp.swift) ;; *) sources+=("$file");; esac
done
for script in scripts/*-preview.swift; do
    xcrun swiftc -typecheck -parse-as-library "${flags[@]}" -I "$bin_dir/Modules" \
        "$script" "${sources[@]}"
done
