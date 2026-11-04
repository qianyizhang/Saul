#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
root="$PWD/native/credentials"
export CLANG_MODULE_CACHE_PATH="$root/.build/module-cache"
export SWIFTPM_MODULECACHE_OVERRIDE="$root/.build/module-cache"
flags=(--package-path "$root" --cache-path "$root/.build/cache")
if [[ "${EZ_SWIFTPM_DISABLE_SANDBOX:-0}" == 1 ]]; then flags+=(--disable-sandbox); fi
swift run "${flags[@]}" -Xswiftc -warnings-as-errors -Xswiftc -strict-concurrency=complete CredentialChecks
