#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v uv >/dev/null; then
    printf 'Install uv for development hooks: brew install uv\n' >&2
    exit 1
fi
# Installed Git hooks reference this runner environment. Keep it outside .build
# so SwiftPM's clean command cannot remove the hook interpreter.
export UV_CACHE_DIR="$PWD/.cache/uv"
export UV_TOOL_DIR="$PWD/.cache/uv-tools"
export UV_PYTHON_INSTALL_DIR="$PWD/.cache/python"
export PRE_COMMIT_HOME="$PWD/.cache/pre-commit"
exec uv tool run --python 3.12 --from pre-commit==4.7.0 pre-commit "$@"
