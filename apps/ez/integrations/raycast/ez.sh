#!/bin/bash

# @raycast.schemaVersion 1
# @raycast.title EZ Lookup
# @raycast.mode silent
# @raycast.packageName EZ
# @raycast.icon 📖
# @raycast.argument1 {"type":"text","placeholder":"A word, sentence, or question","percentEncoded":true}
# @raycast.description Submit a query using your current EZ settings and show its compact answer panel.

set -euo pipefail
if [[ $# -ne 1 || -z "$1" ]]; then
    printf 'Enter a query in Raycast.\n' >&2
    exit 1
fi
ez_app="$HOME/Applications/EZ.app"
if [[ ! -d "$ez_app" ]]; then
    printf 'Install EZ in ~/Applications/EZ.app first.\n' >&2
    exit 1
fi
# Raycast percent-encodes the argument. Quoting preserves it as data, never shell code.
# Pin the installed bundle even when Spotlight also indexes the development build.
/usr/bin/open -g -a "$ez_app" "ez://lookup?query=$1" --args --ez-launcher
