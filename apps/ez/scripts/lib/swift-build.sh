#!/bin/bash
# Shared compiler/layout setup for native checks and disposable previews.
ez_app_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

ez_use_build_directory() {
    ez_bin_dir="$1"
    ez_swift_flags=(-swift-version 5 -warnings-as-errors -strict-concurrency=complete
        -target "$(uname -m)-apple-macos14.0" -module-cache-path "$ez_app_root/.build/module-cache")
    ez_include_flags=(-I "$ez_bin_dir")
    if [[ -d "$ez_bin_dir/Modules" ]]; then ez_include_flags+=(-I "$ez_bin_dir/Modules"); fi
}

ez_build_product() {
    local bin
    "$ez_app_root/scripts/swift.sh" build --product "$1" || return
    bin=$("$ez_app_root/scripts/swift.sh" build --show-bin-path) || return
    if [[ -z "$bin" ]]; then
        printf 'Swift build directory is empty.\n' >&2
        return 1
    fi
    ez_use_build_directory "$bin"
}

ez_link_modules() {
    local product="$1" module file found
    shift
    ez_objects=()
    for module in "$@"; do
        found=0
        if [[ -f "$ez_bin_dir/$product.product/Objects.LinkFileList" ]]; then
            while IFS= read -r file; do
                case "$file" in
                    */"$module".build/*.o)
                        if [[ ! -f "$file" ]]; then
                            printf 'Missing Swift object: %s\n' "$file" >&2
                            return 1
                        fi
                        ez_objects+=("$file")
                        found=1
                        ;;
                esac
            done < "$ez_bin_dir/$product.product/Objects.LinkFileList"
        fi
        # Xcode's SwiftPM layout emits one object per module beside its modules.
        if [[ "$found" == 0 && -f "$ez_bin_dir/$module.o" ]]; then
            ez_objects+=("$ez_bin_dir/$module.o")
            found=1
        fi
        if [[ "$found" == 0 ]]; then
            printf 'Missing compiled Swift module %s in %s\n' "$module" "$ez_bin_dir" >&2
            return 1
        fi
    done
}

ez_application_sources() {
    local file
    ez_app_sources=()
    for file in "$ez_app_root"/Sources/EZ/*.swift; do
        case "$file" in */EZApp.swift) ;; *) ez_app_sources+=("$file");; esac
    done
}

ez_compile_library() {
    xcrun swiftc "${ez_swift_flags[@]}" -parse-as-library "${ez_include_flags[@]}" \
        -I "$ez_app_root/Sources/CSQLite" -lsqlite3 "$@"
}
