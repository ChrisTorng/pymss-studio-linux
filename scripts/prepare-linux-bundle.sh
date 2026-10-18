#!/usr/bin/env bash
# Linux-specific, online/bootstrap build: bundle Python 3.12 and worker sources,
# but install Torch inference environments and models on first use.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:?Usage: bash scripts/prepare-linux-bundle.sh X.Y.Z}"
PBS_TAG="${PBS_TAG:-20260602}"
PBS_PYTHON_VERSION="${PBS_PYTHON_VERSION:-3.12.13}"
PBS_PYTHON_SHA256="${PBS_PYTHON_SHA256:-191b5188b42886fb8a14968d714571e8f3d1cef92ac7ad4c7e24cc4d0929b194}"
RESOURCES="$ROOT/src-tauri/resources"
ARCHIVE="cpython-${PBS_PYTHON_VERSION}+${PBS_TAG}-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz"
URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/${ARCHIVE/+/%2B}"

if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  echo "This build currently targets Linux x86_64 only" >&2
  exit 1
fi
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Expected an app version X.Y.Z, got: $VERSION" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$RESOURCES"
rm -rf "$RESOURCES/python" "$RESOURCES/python-runtime"
mkdir -p "$RESOURCES/python"
cp -a "$ROOT/python/." "$RESOURCES/python/"
find "$RESOURCES/python" -type d -name __pycache__ -prune -exec rm -rf {} +
find "$RESOURCES/python" -type f -name '*.pyc' -delete

echo "Preparing relocatable Python $PBS_PYTHON_VERSION ($PBS_TAG)"
curl --fail --location --retry 3 --retry-delay 3 --output "$TMP/python.tar.gz" "$URL"
printf '%s  %s\n' "$PBS_PYTHON_SHA256" "$TMP/python.tar.gz" | sha256sum --check
tar -xzf "$TMP/python.tar.gz" -C "$TMP"
test -x "$TMP/python/bin/python3"
mv "$TMP/python" "$RESOURCES/python-runtime"

PY="$RESOURCES/python-runtime/bin/python3"
"$PY" -m ensurepip --upgrade
"$PY" -m pip install --no-cache-dir --disable-pip-version-check "requests[socks]>=2.32,<3"
PYTHONDONTWRITEBYTECODE=1 "$PY" -c 'import sys, requests, socks; assert sys.version_info[:2] == (3, 12); print("Bundled Python:", sys.version); print("requests:", requests.__version__)'

# Overlay only the package version and bundled resources. Leave upstream's
# tauri.conf.json, app identifier, Windows/macOS build scripts unchanged.
python3 - "$ROOT" "$VERSION" <<'PY'
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
version = sys.argv[2]
resources = root / "src-tauri" / "resources"
config = {
    "version": version,
    "bundle": {
        "targets": ["deb"],
        "resources": {
            str((resources / "python").resolve()): "python",
            str((resources / "python-runtime").resolve()): "python-runtime",
        },
        "linux": {
            "deb": {
                "depends": [
                    "libwebkit2gtk-4.1-0",
                    "libgtk-3-0 | libgtk-3-0t64",
                    "ffmpeg",
                    "aria2",
                ]
            }
        },
    },
}
output = root / "src-tauri" / "tauri.linux-ci.json"
output.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
print("Generated Tauri Linux bundle config:", output)
PY
