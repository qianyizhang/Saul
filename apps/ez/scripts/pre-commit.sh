#!/bin/bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/../../.." && pwd)
exec bash "$repo/scripts/pre-commit.sh" "$@"
