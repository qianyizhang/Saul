#!/bin/bash
# Installer rollback uses disposable files and signature stubs, never a real Keychain.
set -euo pipefail
cd "$(dirname "$0")/.."
fixture=$(mktemp -d "${TMPDIR:-/tmp}/saul-credential-install.XXXXXX")
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/scripts" "$fixture/bin"
cp scripts/install-credentials.sh "$fixture/scripts/"
cat > "$fixture/scripts/build-credentials.sh" <<'BUILD'
#!/bin/bash
set -eu
mkdir -p 'dist/Saul Credentials.app/Contents'
printf new > 'dist/Saul Credentials.app/marker'
plutil -create xml1 'dist/Saul Credentials.app/Contents/Info.plist'
plutil -insert SaulAllowedExtensionIDs -json '["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]' 'dist/Saul Credentials.app/Contents/Info.plist'
BUILD
cat > "$fixture/bin/codesign" <<'SIGN'
#!/bin/bash
[[ "${SAUL_TEST_VERIFY_FAIL:-0}" != 1 ]]
SIGN
cat > "$fixture/bin/ditto" <<'COPY'
#!/bin/bash
cp -R "$1" "$2"
COPY
cat > "$fixture/bin/mv" <<'MOVE'
#!/bin/bash
if [[ "$1" == */manifest.json && "${SAUL_TEST_MANIFEST_FAIL:-0}" == 1 ]]; then exit 1; fi
if [[ "$1" == */.upgrade.*/Saul.app ]]; then
    if [[ "${SAUL_TEST_RENAME_FAIL:-0}" == 1 ]]; then exit 1; fi
    if [[ "${SAUL_TEST_INTERRUPT:-0}" == 1 ]]; then kill -TERM "$PPID"; exit 1; fi
fi
exec /bin/mv "$@"
MOVE
chmod +x "$fixture/bin/"*
export PATH="$fixture/bin:$PATH"
export SAUL_CREDENTIALS_DIR="$fixture/Credentials"
export SAUL_NATIVE_MANIFEST_DIR="$fixture/Manifests"
cd "$fixture"
reset_install() {
    rm -rf "$SAUL_CREDENTIALS_DIR" "$SAUL_NATIVE_MANIFEST_DIR" dist
    mkdir -p "$SAUL_CREDENTIALS_DIR/Saul.app" "$SAUL_NATIVE_MANIFEST_DIR"
    printf old > "$SAUL_CREDENTIALS_DIR/Saul.app/marker"
    printf old-manifest > "$SAUL_NATIVE_MANIFEST_DIR/com.saul.credentials.json"
}
for failure in SAUL_TEST_VERIFY_FAIL SAUL_TEST_RENAME_FAIL SAUL_TEST_MANIFEST_FAIL SAUL_TEST_INTERRUPT; do
    reset_install
    if env "$failure=1" bash scripts/install-credentials.sh > result.log 2>&1; then cat result.log; exit 1; fi
    [[ "$(cat "$SAUL_CREDENTIALS_DIR/Saul.app/marker")" == old ]]
    [[ "$(cat "$SAUL_NATIVE_MANIFEST_DIR/com.saul.credentials.json")" == old-manifest ]]
done
reset_install
rm -rf "$SAUL_CREDENTIALS_DIR/Saul.app" "$SAUL_NATIVE_MANIFEST_DIR/com.saul.credentials.json"
if SAUL_TEST_MANIFEST_FAIL=1 bash scripts/install-credentials.sh > result.log 2>&1; then exit 1; fi
[[ ! -e "$SAUL_CREDENTIALS_DIR/Saul.app" && ! -e "$SAUL_NATIVE_MANIFEST_DIR/com.saul.credentials.json" ]]
reset_install
if ! bash scripts/install-credentials.sh > result.log 2>&1; then cat result.log >&2; exit 1; fi
[[ "$(cat "$SAUL_CREDENTIALS_DIR/Saul.app/marker")" == new ]]
plutil -extract name raw -o - "$SAUL_NATIVE_MANIFEST_DIR/com.saul.credentials.json" | /usr/bin/grep -Fx com.saul.credentials
printf 'Credential installer checks passed: signature, rename, signal and manifest rollback, first-install rollback and successful activation.\n'
