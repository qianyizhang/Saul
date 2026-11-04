#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/lib/swift-build.sh
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
bin="$fixture/build with spaces"
mkdir -p "$bin/Modules" "$bin/EZChecks.product" "$bin/EZCore.build" "$bin/EZChecks.build"
touch "$bin/EZCore.build/first.o" "$bin/EZCore.build/second.o" "$bin/EZChecks.build/main.o"
printf '%s\n' "$bin/EZCore.build/first.o" "$bin/EZChecks.build/main.o" "$bin/EZCore.build/second.o" \
    > "$bin/EZChecks.product/Objects.LinkFileList"
ez_use_build_directory "$bin"
ez_link_modules EZChecks EZCore
[[ ${#ez_objects[@]} == 2 && "${ez_objects[0]}" == "$bin/EZCore.build/first.o" ]]
[[ ${#ez_include_flags[@]} == 4 && "${ez_include_flags[3]}" == "$bin/Modules" ]]
rm "$bin/EZCore.build/second.o"
if ez_link_modules EZChecks EZCore 2> "$fixture/error"; then exit 1; fi
[[ "$(cat "$fixture/error")" == *'Missing Swift object:'* ]]
rm -rf "$bin/Modules" "$bin/EZChecks.product"
touch "$bin/EZCore.o" "$bin/EZCheckSupport.o"
ez_use_build_directory "$bin"
ez_link_modules EZChecks EZCore EZCheckSupport
[[ ${#ez_objects[@]} == 2 && "${ez_objects[1]}" == "$bin/EZCheckSupport.o" ]]
[[ ${#ez_include_flags[@]} == 2 ]]
if ez_link_modules EZChecks Missing 2> "$fixture/error"; then exit 1; fi
[[ "$(cat "$fixture/error")" == *'Missing compiled Swift module Missing'* ]]
if bash scripts/check.sh unknown 2> "$fixture/error"; then exit 1; fi
[[ "$(cat "$fixture/error")" == 'Usage:'* ]]
# A failed build or path query must keep its status, even inside a conditional.
mkdir -p "$fixture/scripts"
cat > "$fixture/scripts/swift.sh" <<'SH'
#!/bin/bash
root=$(cd "$(dirname "$0")/.." && pwd)
if [[ -f "$root/fail-build" ]]; then exit 73; fi
if [[ "$*" == 'build --show-bin-path' ]]; then exit 74; fi
SH
chmod +x "$fixture/scripts/swift.sh"
ez_app_root="$fixture"
if ez_build_product EZ; then exit 1; else result=$?; fi
[[ "$result" == 74 ]]
touch "$fixture/fail-build"
if ez_build_product EZ; then exit 1; else result=$?; fi
[[ "$result" == 73 ]]
printf 'Swift build tooling checks passed: both layouts, spaces, object filtering, missing modules and build/discovery failures.\n'
