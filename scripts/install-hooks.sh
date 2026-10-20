#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Keep pre-commit's generated runner and legacy-hook handling.
bash scripts/pre-commit.sh install
hook_dir=$(git rev-parse --git-path hooks)
temporary=""
trap 'if [[ -n "$temporary" ]]; then rm -f "$temporary"; fi' EXIT
for hook_type in pre-commit pre-push; do
    temporary=$(mktemp "$hook_dir/.workspace-hook.XXXXXX")
    {
        IFS= read -r shebang
        printf '%s\n' "$shebang"
        # Resolve the cache from the repository at hook runtime.
        # shellcheck disable=SC2016
        printf '%s\n' 'export PRE_COMMIT_HOME="$(git rev-parse --show-toplevel)/.cache/pre-commit"'
        cat
    } < "$hook_dir/$hook_type" > "$temporary"
    chmod +x "$temporary"
    mv "$temporary" "$hook_dir/$hook_type"
done
