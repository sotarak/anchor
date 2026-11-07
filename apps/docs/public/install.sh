#!/bin/sh
# Install the Anchor CLI (https://sotarak.github.io/anchor/) on macOS or Linux.
#
#   curl -fsSL https://sotarak.github.io/anchor/install.sh | sh
#
# Downloads the release binary for this platform, verifies it against the release's SHA256SUMS,
# and installs it as `anchor` (plus an `anchor-secrets` alias). Nothing is installed if the
# checksum does not match. It never calls sudo. Read it before piping it to sh.
#
# Environment:
#   ANCHOR_VERSION        version to install: `0.2.0`, `v0.2.0` or `latest` (default)
#   ANCHOR_INSTALL_DIR    target directory (default: $HOME/.local/bin)
#   ANCHOR_DOWNLOAD_BASE  release base URL (default: https://github.com/sotarak/anchor/releases)
set -eu

base=${ANCHOR_DOWNLOAD_BASE:-https://github.com/sotarak/anchor/releases}
dir=${ANCHOR_INSTALL_DIR:-${HOME:?HOME is not set}/.local/bin}
version=${ANCHOR_VERSION:-latest}

fail() {
  printf 'anchor install: %s\n' "$1" >&2
  exit 1
}

is_digits() {
  case $1 in '' | *[!0-9]*) return 1 ;; esac
}

# --- platform -----------------------------------------------------------------------------
os_name=$(uname -s)
case $os_name in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  MINGW* | MSYS* | CYGWIN*) os=windows ;;
  *) fail "Unsupported OS: $os_name. Install with npm: npm install -g @anchor-secrets/cli" ;;
esac
arch_name=$(uname -m)
case $arch_name in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "Unsupported architecture: $arch_name. Install with npm: npm install -g @anchor-secrets/cli" ;;
esac
asset=anchor-$os-$arch
exe=anchor
if [ "$os" = windows ]; then
  [ "$arch" = x64 ] || fail "Windows on $arch_name has no release binary. Install with npm: npm install -g @anchor-secrets/cli"
  asset=$asset.exe
  exe=anchor.exe
fi

# --- version ------------------------------------------------------------------------------
if [ "$version" = latest ]; then
  url=$base/latest/download
else
  version=${version#v}
  core=${version%%-*}
  major=${core%%.*}
  rest=${core#*.}
  minor=${rest%%.*}
  patch=${rest#*.}
  valid=1
  # Exactly three dot-separated numbers: "0.2" or "1" would otherwise parse as 0.2.2 or 1.1.1.
  case $core in *.*.*.* | *..*) valid=0 ;; *.*.*) ;; *) valid=0 ;; esac
  is_digits "$major" && is_digits "$minor" && is_digits "$patch" || valid=0
  case $version in *[!0-9A-Za-z.-]*) valid=0 ;; esac
  case $version in *-*) [ -n "${version#*-}" ] || valid=0 ;; esac
  [ "$valid" = 1 ] || fail "ANCHOR_VERSION must look like 0.2.0 or v0.2.0, got: ${ANCHOR_VERSION}"
  url=$base/download/v$version
fi

# --- download and verify ------------------------------------------------------------------
command -v curl >/dev/null 2>&1 || fail "curl is required"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL -o "$tmp/$asset" "$url/$asset" || fail "download failed: $url/$asset"
curl -fsSL -o "$tmp/SHA256SUMS" "$url/SHA256SUMS" || fail "download failed: $url/SHA256SUMS"

expected=
while read -r sum name; do
  if [ "${name#\*}" = "$asset" ]; then
    expected=$sum
    break
  fi
done <"$tmp/SHA256SUMS"
[ -n "$expected" ] || fail "$asset is not listed in SHA256SUMS"

if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$tmp/$asset")
elif command -v shasum >/dev/null 2>&1; then
  actual=$(shasum -a 256 "$tmp/$asset")
else
  fail "sha256sum or shasum is required to verify the download"
fi
actual=${actual%% *}
[ "$actual" = "$expected" ] || fail "checksum mismatch for $asset; nothing was installed"

# --- install ------------------------------------------------------------------------------
mkdir -p "$dir"
staged=$dir/.anchor.tmp.$$
trap 'rm -rf "$tmp"; rm -f "$staged"' EXIT
cp "$tmp/$asset" "$staged"
chmod 755 "$staged"
mv -f "$staged" "$dir/$exe"
if [ "$os" != windows ]; then
  ln -sf anchor "$dir/anchor-secrets"
fi

installed=$("$dir/$exe" --version)
printf 'Installed anchor %s to %s\n' "$installed" "$dir" >&2
case ":$PATH:" in
  *":$dir:"*) ;;
  *) printf 'Add it to your PATH: export PATH="%s:$PATH"\n' "$dir" >&2 ;;
esac
