#!/usr/bin/env bash
# Keep the app's upstream version; give APT a monotonic Linux package revision.
set -euo pipefail
if [[ "$#" -ne 4 ]]; then
  echo "Usage: bash finalize-linux-deb.sh INPUT.deb OUTPUT_DIR X.Y.Z REVISION" >&2
  exit 2
fi
deb="$1"
output_dir="$2"
version="$3"
revision="$4"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ || ! "$revision" =~ ^[1-9][0-9]*$ ]]; then
  echo "Expected an upstream X.Y.Z version and a positive Debian revision." >&2
  exit 2
fi
[[ "$(dpkg-deb --field "$deb" Package)" == pymss-studio ]]
[[ "$(dpkg-deb --field "$deb" Architecture)" == amd64 ]]
[[ "$(dpkg-deb --field "$deb" Version)" == "$version" ]]
mkdir -p "$output_dir"
tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
dpkg-deb --raw-extract "$deb" "$tmp/root"
python3 - "$tmp/root/DEBIAN/control" "$version-$revision" <<'PY'
from pathlib import Path
import re
import sys

control = Path(sys.argv[1])
text, count = re.subn(r"(?m)^Version: .*$", "Version: " + sys.argv[2], control.read_text())
if count != 1:
    raise SystemExit("Expected exactly one DEB Version field")
control.write_text(text)
PY
output="$output_dir/pymss-studio_${version}-${revision}_amd64.deb"
dpkg-deb --root-owner-group -Zxz --build "$tmp/root" "$output"
[[ "$(dpkg-deb --field "$output" Version)" == "$version-$revision" ]]
echo "Linux package version: $version-$revision; upstream app version: $version"
