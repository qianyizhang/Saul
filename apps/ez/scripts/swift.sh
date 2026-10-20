#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export CLANG_MODULE_CACHE_PATH="$PWD/.build/module-cache"
export SWIFTPM_MODULECACHE_OVERRIDE="$PWD/.build/module-cache"
command="$1"
shift
flags=(--cache-path "$PWD/.build/cache")
case "$command" in
    build|run|test) flags+=(-Xswiftc -warnings-as-errors -Xswiftc -strict-concurrency=complete) ;;
esac
# Nested sandbox-exec fails inside some agent sandboxes. This only disables
# SwiftPM's manifest sandbox; the outer execution sandbox remains enforced.
if [[ "${EZ_SWIFTPM_DISABLE_SANDBOX:-0}" == 1 ]]; then flags+=(--disable-sandbox); fi
exec swift "$command" "${flags[@]}" "$@"
