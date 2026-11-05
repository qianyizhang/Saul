#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/swift-build.sh
kind="${1:-all}"
if [[ $# -gt 0 ]]; then shift; fi
case "$kind" in
    all)
        status=0
        if ! bash scripts/check.sh core "$@"; then status=1; fi
        if ! bash scripts/check.sh state "$@"; then status=1; fi
        exit "$status"
        ;;
    core) exec ./scripts/swift.sh run EZChecks "$@" ;;
    state)
        ./scripts/swift.sh build --product EZ
        ez_build_product EZChecks
        ez_link_modules EZChecks EZCore SaulCredentialStorage EZCheckSupport
        ez_compile_library Sources/EZ/AppModel.swift Sources/EZ/GenerationState.swift Sources/EZ/ConnectionState.swift \
            Tests/EZStateChecks/*.swift "${ez_objects[@]}" -o "$ez_bin_dir/EZStateChecks"
        exec "$ez_bin_dir/EZStateChecks" "$@"
        ;;
    services)
        ez_build_product EZChecks
        ez_link_modules EZChecks EZCore SaulCredentialStorage EZCheckSupport
        ez_compile_library Sources/EZ/AppModel.swift Sources/EZ/GenerationState.swift Sources/EZ/ConnectionState.swift \
            Sources/EZ/SelectedTextService.swift Tests/EZStateChecks/StateFixture.swift \
            Tests/Services/check.swift "${ez_objects[@]}" -o "$ez_bin_dir/EZServicesChecks"
        exec "$ez_bin_dir/EZServicesChecks" "$@"
        ;;
    ui)
        ez_build_product EZChecks
        ez_link_modules EZChecks EZCheckSupport
        ez_compile_library Sources/EZ/AppStyle.swift Sources/EZ/DesignTokens.swift \
            Tests/EZUIChecks/*.swift "${ez_objects[@]}" -o "$ez_bin_dir/EZUIChecks"
        exec "$ez_bin_dir/EZUIChecks" "$@"
        ;;
    scripts)
        if [[ $# -ne 0 ]]; then printf 'Script checks take no arguments.\n' >&2; exit 1; fi
        ez_build_product EZ
        xcrun swiftc -typecheck "${ez_swift_flags[@]}" scripts/icon.swift
        xcrun swiftc -typecheck "${ez_swift_flags[@]}" scripts/build-identity.swift
        ez_application_sources
        for preview in Tests/Previews/*.swift; do
            ez_compile_library -typecheck "$preview" "${ez_app_sources[@]}"
        done
        ;;
    *) printf 'Usage: bash scripts/check.sh {all|core|state|services|ui|scripts} [check arguments]\n' >&2; exit 1 ;;
esac
