#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../../../native/credentials"
export CLANG_MODULE_CACHE_PATH="$PWD/.build/module-cache"
export SWIFTPM_MODULECACHE_OVERRIDE="$PWD/.build/module-cache"
command="$1"
shift
flags=(--cache-path "$PWD/.build/cache")
case "$command" in
    build|run|test) flags+=(-Xswiftc -warnings-as-errors -Xswiftc -strict-concurrency=complete) ;;
esac
if [[ "${EZ_SWIFTPM_DISABLE_SANDBOX:-0}" == 1 ]]; then flags+=(--disable-sandbox); fi
exec swift "$command" "${flags[@]}" "$@"
