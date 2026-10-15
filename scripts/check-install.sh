#!/bin/bash
# Disposable packaging checks: no personal app, Keychain, or signing key is used.
set -euo pipefail
cd "$(dirname "$0")/.."
fixture=$(mktemp -d "${TMPDIR:-/tmp}/ez-install-check.XXXXXX")
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/scripts" "$fixture/bin"
cp scripts/{signing,configure-signing,install-app}.sh "$fixture/scripts/"
fingerprint=1111111111111111111111111111111111111111
cat > "$fixture/scripts/build-app.sh" <<'SH'
#!/bin/bash
set -eu
mkdir -p dist/EZ.app
printf new > dist/EZ.app/marker
SH
cat > "$fixture/bin/security" <<'SH'
#!/bin/bash
if [[ "${EZ_TEST_DUPLICATE_IDENTITY:-0}" == 1 ]]; then
    printf '  2) 2222222222222222222222222222222222222222 "EZ Local Signing"\n'
fi
if [[ "${EZ_TEST_MISSING_IDENTITY:-0}" == 1 ]]; then exit 0; fi
printf '  1) 1111111111111111111111111111111111111111 "EZ Local Signing"\n'
SH
cat > "$fixture/bin/pgrep" <<'SH'
#!/bin/bash
if [[ "${EZ_TEST_PROCESS_ERROR:-0}" == 1 ]]; then exit 2; fi
[[ "${EZ_TEST_RUNNING:-0}" == 1 ]]
SH
cat > "$fixture/bin/ditto" <<'SH'
#!/bin/bash
if [[ "${EZ_TEST_COPY_FAIL:-0}" == 1 ]]; then
    printf 'fixture: staging copy rejected\n' >&2
    exit 1
fi
cp -R "$1" "$2"
SH
cat > "$fixture/bin/codesign" <<'SH'
#!/bin/bash
if [[ "$1" == -d ]]; then
    printf 'designated => identifier "local.ez.app"\n' >&2
    exit 0
fi
if [[ "${2:-}" == -R && "$3" != =* && ! -s "$3" ]]; then exit 1; fi
if [[ "${2:-}" == -R && "$3" != =* && "${EZ_TEST_REQUIREMENT_FAIL:-0}" == 1 ]]; then
    printf 'fixture: installed identity requirement rejected\n' >&2
    exit 1
fi
if [[ "${EZ_TEST_VERIFY_FAIL:-0}" == 1 ]]; then
    printf 'fixture: signature verification rejected\n' >&2
    exit 1
fi
SH
cat > "$fixture/bin/mv" <<'SH'
#!/bin/bash
if [[ "$1" == */.ez-upgrade.*/EZ.app ]]; then
    if [[ "${EZ_TEST_RENAME_FAIL:-0}" == 1 ]]; then
        printf 'fixture: final rename rejected\n' >&2
        exit 1
    fi
    if [[ "${EZ_TEST_INTERRUPT:-0}" == 1 ]]; then
        kill -TERM "$PPID"
        exit 1
    fi
fi
exec /bin/mv "$@"
SH
chmod +x "$fixture/bin/"*
export PATH="$fixture/bin:$PATH"
export EZ_APPLICATIONS_DIR="$fixture/Applications"
unset EZ_SIGNING_IDENTITY
cd "$fixture"

reset_install() {
    rm -rf .local dist "$EZ_APPLICATIONS_DIR"
    mkdir -p .local "$EZ_APPLICATIONS_DIR/EZ.app"
    printf '%s\n' "$fingerprint" > .local/signing-identity
    printf old > "$EZ_APPLICATIONS_DIR/EZ.app/marker"
}
expect_failure() {
    local message="$1" expected_status="$2" actual_status
    shift 2
    if "$@" > result.log 2>&1; then
        printf 'Expected failure: %s\n' "$*" >&2
        exit 1
    else
        actual_status=$?
    fi
    [[ "$actual_status" == "$expected_status" ]]
    if ! /usr/bin/grep -Fq -- "$message" result.log; then cat result.log >&2; exit 1; fi
    [[ "$(cat "$EZ_APPLICATIONS_DIR/EZ.app/marker")" == old ]]
}

reset_install
rm .local/signing-identity
expect_failure 'Run make signing-setup first' 1 bash scripts/install-app.sh
[[ ! -e dist ]]

reset_install
expect_failure 'is unavailable' 1 env EZ_TEST_MISSING_IDENTITY=1 bash scripts/install-app.sh
[[ ! -e dist ]]

reset_install
expect_failure 'Installation must use the pinned fingerprint' 1 env EZ_SIGNING_IDENTITY=- bash scripts/install-app.sh
[[ ! -e dist ]]

reset_install
expect_failure 'Quit EZ before installing' 1 env EZ_TEST_RUNNING=1 bash scripts/install-app.sh
[[ ! -e dist ]]

reset_install
expect_failure 'Could not check whether EZ is running' 1 env EZ_TEST_PROCESS_ERROR=1 bash scripts/install-app.sh
[[ ! -e dist ]]

reset_install
expect_failure 'fixture: signature verification rejected' 1 env EZ_TEST_VERIFY_FAIL=1 bash scripts/install-app.sh

reset_install
expect_failure 'fixture: installed identity requirement rejected' 1 env EZ_TEST_REQUIREMENT_FAIL=1 bash scripts/install-app.sh

reset_install
expect_failure 'fixture: staging copy rejected' 1 env EZ_TEST_COPY_FAIL=1 bash scripts/install-app.sh

reset_install
expect_failure 'fixture: final rename rejected' 1 env EZ_TEST_RENAME_FAIL=1 bash scripts/install-app.sh

reset_install
expect_failure '' 143 env EZ_TEST_INTERRUPT=1 bash scripts/install-app.sh

reset_install
bash scripts/install-app.sh > result.log 2>&1
[[ "$(cat "$EZ_APPLICATIONS_DIR/EZ.app/marker")" == new ]]
backups=("$EZ_APPLICATIONS_DIR"/.ez-upgrade.*/previous.app)
[[ ${#backups[@]} == 1 && "$(cat "${backups[0]}/marker")" == old ]]

# Initial setup and repeated setup pin the same existing identity.
rm .local/signing-identity
bash scripts/configure-signing.sh > result.log
[[ "$(cat .local/signing-identity)" == "$fingerprint" ]]
bash scripts/configure-signing.sh > result.log
[[ "$(cat .local/signing-identity)" == "$fingerprint" ]]
# Ambiguous certificates cannot establish a new pin.
rm .local/signing-identity
if EZ_TEST_DUPLICATE_IDENTITY=1 bash scripts/configure-signing.sh > result.log 2>&1; then exit 1; fi
/usr/bin/grep -Fq 'Expected exactly one valid code-signing identity' result.log
[[ ! -e .local/signing-identity ]]
printf '%s\n' "$fingerprint" > .local/signing-identity
# Setup rejects identity rotation and reads data rather than code.
if EZ_SIGNING_IDENTITY=other bash scripts/configure-signing.sh > result.log 2>&1; then exit 1; fi
[[ "$(cat .local/signing-identity)" == "$fingerprint" ]]
printf 'touch SHOULD_NOT_EXIST\n' > .local/signing-identity
if bash scripts/configure-signing.sh > result.log 2>&1; then exit 1; fi
[[ ! -e SHOULD_NOT_EXIST ]]
printf 'Install checks passed (identity guards, process checks, verification/copy failures, rename/signal recovery, backup, setup safety).\n'
