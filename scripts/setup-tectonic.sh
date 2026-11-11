#!/usr/bin/env bash
# Download a pinned Tectonic binary into tools/tectonic.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/tools/tectonic"
VERSION="0.17.0"

if [[ -x "$DEST" ]]; then
  echo "Tectonic already installed: $("$DEST" --version)"
  exit 0
fi

os="$(uname -s)"
arch="$(uname -m)"
case "${os}-${arch}" in
  Linux-x86_64) asset="tectonic-${VERSION}-x86_64-unknown-linux-gnu.tar.gz" ;;
  Linux-aarch64) asset="tectonic-${VERSION}-aarch64-unknown-linux-musl.tar.gz" ;;
  Darwin-x86_64) asset="tectonic-${VERSION}-x86_64-apple-darwin.tar.gz" ;;
  Darwin-arm64) asset="tectonic-${VERSION}-aarch64-apple-darwin.tar.gz" ;;
  *)
    echo "No pinned Tectonic build for ${os} ${arch}. Install tectonic yourself and set TECTONIC_BIN." >&2
    exit 1
    ;;
esac

url="https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${VERSION}/${asset}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading ${asset}"
curl -fL --retry 3 -o "$tmp/tectonic.tgz" "$url"
tar -xzf "$tmp/tectonic.tgz" -C "$tmp"
mkdir -p "$ROOT/tools"
install -m 755 "$tmp/tectonic" "$DEST"
"$DEST" --version
echo "Cache directory will be created on first compile under data/tectonic-cache."
