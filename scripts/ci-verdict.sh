#!/bin/bash
set -euo pipefail

check_result() {
    local job="$1" selected="$2" result="$3"
    case "$selected:$result" in
        true:success) printf '%s: passed\n' "$job" ;;
        false:skipped) printf '%s: skipped (outside PR scope)\n' "$job" ;;
        *)
            printf '%s: expected selected=%s to match result=%s\n' "$job" "$selected" "$result" >&2
            return 1
            ;;
    esac
}

status=0
check_result 'Scope' true "${SCOPE_RESULT:-missing}" || status=1
check_result 'Linux checks' true "${CHECKS_RESULT:-missing}" || status=1
check_result 'Browser smoke' "${SMOKE_SELECTED:-missing}" "${SMOKE_RESULT:-missing}" || status=1
check_result 'macOS checks' "${NATIVE_SELECTED:-missing}" "${NATIVE_RESULT:-missing}" || status=1
exit "$status"
