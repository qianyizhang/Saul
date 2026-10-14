#!/bin/bash
set -uo pipefail
cd "$(dirname "$0")/.."
status=0
if ! ./scripts/swift.sh run EZChecks "$@"; then status=1; fi
if ! bash scripts/state-checks.sh "$@"; then status=1; fi
exit "$status"
