#!/usr/bin/env bash
set -euo pipefail

fail() { printf 'Model Tides: %s\n' "$1" >&2; exit 1; }

if (( $# > 1 )) || [[ $# -eq 1 && "$1" != upload ]]; then
    fail 'Usage: install.sh [upload]'
fi
if [[ "${1:-}" = upload && ! -t 2 ]]; then
    fail 'The upload flow needs an interactive terminal. Run model-tides upload after installing.'
fi

case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) fail 'This installer supports Linux and macOS. Use npm for other systems.' ;;
esac

case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) fail 'This processor is not supported by the standalone binary.' ;;
esac

version="${MODEL_TIDES_VERSION:-latest}"
if [[ "$version" != latest && ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
    fail 'MODEL_TIDES_VERSION must be a release version such as 1.2.3.'
fi

install_dir="${MODEL_TIDES_INSTALL_DIR:-${HOME:-}/.local/bin}"
[[ "$install_dir" = /* ]] || fail 'MODEL_TIDES_INSTALL_DIR must be an absolute path.'

if [[ "$version" = latest ]]; then
    release='https://github.com/BYK/model-tides/releases/latest/download'
else
    release="https://github.com/BYK/model-tides/releases/download/$version"
fi
binary="model-tides-$os-$arch"
temp_dir="$(mktemp -d)"
staged=''
cleanup() {
    [[ -z "$staged" ]] || rm -f -- "$staged"
    rm -rf -- "$temp_dir"
}
trap cleanup EXIT

curl -fsSL --retry 3 "$release/SHA256SUMS" -o "$temp_dir/SHA256SUMS"
curl -fsSL --retry 3 "$release/$binary" -o "$temp_dir/$binary"

expected=''
while read -r digest filename; do
    if [[ "$filename" = "$binary" ]]; then expected="$digest"; fi
done < "$temp_dir/SHA256SUMS"
[[ "$expected" =~ ^[[:xdigit:]]{64}$ ]] || fail "No valid checksum was published for $binary."

if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$temp_dir/$binary")"
elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$temp_dir/$binary")"
else
    fail 'A SHA-256 checksum tool (sha256sum or shasum) is required.'
fi
actual="${actual%% *}"
[[ "${actual,,}" = "${expected,,}" ]] || fail "Checksum mismatch for $binary; nothing was installed."

mkdir -p -- "$install_dir"
staged="$(mktemp "$install_dir/.model-tides.XXXXXXXX")"
install -m 755 "$temp_dir/$binary" "$staged"
mv -f -- "$staged" "$install_dir/model-tides"
staged=''
printf 'Installed Model Tides at %s/model-tides\n' "$install_dir"
case ":${PATH:-}:" in
    *":$install_dir:"*) ;;
    *) printf 'Add %s to your PATH to run model-tides.\n' "$install_dir" ;;
esac
if [[ "${1:-}" = upload ]]; then
    "$install_dir/model-tides" upload </dev/tty
fi
