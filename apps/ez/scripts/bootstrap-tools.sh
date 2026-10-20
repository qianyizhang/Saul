#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Development tools only; nothing here is bundled into EZ.app. Release archive
# hashes come from the publishers' GitHub release asset metadata.
case "$(uname -s)/$(uname -m)" in
    Darwin/arm64)
        action_arch=arm64
        action_sha=aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f
        shell_arch=aarch64
        shell_sha=339b930feb1ea764467013cc1f72d09cd6b869ebf1013296ba9055ab2ffbd26f
        ;;
    Darwin/x86_64)
        action_arch=amd64
        action_sha=5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644
        shell_arch=x86_64
        shell_sha=c2c15e08df0e8fbc374c335b230a7ee958c313fa5714817a59aa59f1aa594f51
        ;;
    *) printf 'EZ development tools require macOS (arm64 or x86_64).\n' >&2; exit 1 ;;
esac

tools="$PWD/.build/tools"
mkdir -p "$tools"
staging=$(mktemp -d "$tools/.install.XXXXXX")
trap 'rm -rf "$staging"' EXIT

download() {
    local url="$1" sha="$2" destination="$3"
    curl --fail --location --silent --show-error --retry 3 "$url" -o "$destination"
    printf '%s  %s\n' "$sha" "$destination" | shasum -a 256 --check
}

if [[ ! -x "$tools/swiftlint" ]] || [[ "$("$tools/swiftlint" version)" != 0.65.1 ]]; then
    download https://github.com/realm/SwiftLint/releases/download/0.65.1/portable_swiftlint.zip \
        c1e429b0599cf1b516f369a2d9ec04eaf0e436f3c12b637df8851fa52ff694d0 "$staging/swiftlint.zip"
    unzip -q "$staging/swiftlint.zip" -d "$staging/swiftlint"
    chmod +x "$staging/swiftlint/swiftlint"
    # The portable archive also carries runtime libraries and its license.
    cp -R "$staging/swiftlint/." "$tools/"
fi
if [[ ! -x "$tools/actionlint" ]] || ! "$tools/actionlint" -version | head -1 | grep -qx 1.7.12; then
    download "https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_darwin_$action_arch.tar.gz" \
        "$action_sha" "$staging/actionlint.tar.gz"
    tar -xzf "$staging/actionlint.tar.gz" -C "$staging" actionlint
    mv "$staging/actionlint" "$tools/actionlint"
fi
if [[ ! -x "$tools/shellcheck" ]] || ! "$tools/shellcheck" --version | grep -qx 'version: 0.11.0'; then
    download "https://github.com/koalaman/shellcheck/releases/download/v0.11.0/shellcheck-v0.11.0.darwin.$shell_arch.tar.gz" \
        "$shell_sha" "$staging/shellcheck.tar.gz"
    tar -xzf "$staging/shellcheck.tar.gz" -C "$staging"
    mv "$staging/shellcheck-v0.11.0/shellcheck" "$tools/shellcheck"
fi
"$tools/swiftlint" version
"$tools/actionlint" -version
"$tools/shellcheck" --version
