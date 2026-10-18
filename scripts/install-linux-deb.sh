#!/usr/bin/env bash
# Install the Linux DEB without making APT fall back from its _apt sandbox.
set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  echo "Usage: bash scripts/install-linux-deb.sh /path/to/pymss-studio.deb" >&2
  exit 2
fi
deb="$(realpath -- "$1")"
if [[ ! -f "$deb" || ! -r "$deb" ]]; then
  echo "Package is not a readable file: $deb" >&2
  exit 1
fi
if [[ "$(dpkg-deb --field "$deb" Package)" != "pymss-studio" ]]; then
  echo "Expected a pymss-studio DEB: $deb" >&2
  exit 1
fi

# A private home/Downloads directory can prevent _apt from traversing the source
# path even when the DEB itself is readable. Stage only this package, leaving the
# user's home permissions unchanged. APT can traverse /var/tmp and this directory.
stage="$(mktemp -d /var/tmp/pymss-studio-install.XXXXXX)"
staged="$stage/pymss-studio.deb"
trap 'rm -f -- "$staged"; rmdir -- "$stage"' EXIT
chmod 0755 "$stage"
install -m 0644 -- "$deb" "$staged"

echo "Installing $(basename -- "$deb") using APT."
sudo apt update
sudo apt install "$staged"
dpkg-query --show --showformat='${Package} ${Version}\n' pymss-studio
