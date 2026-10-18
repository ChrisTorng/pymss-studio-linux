#!/usr/bin/env bash
# Use upstream's runtime worker on Linux, where the GUI manager is read-only.
set -euo pipefail

backend="${1:-cuda}"
if [[ "$#" -gt 2 || ! "$backend" =~ ^(cpu|cuda)$ || ( "$#" -eq 2 && "$2" != "--reinstall" ) ]]; then
  echo "Usage: bash setup-linux-runtime.sh [cuda|cpu] [--reinstall]" >&2
  exit 2
fi
python="$(dpkg-query -L pymss-studio | awk '/\/python-runtime\/bin\/python3$/ {print}')"
worker="$(dpkg-query -L pymss-studio | awk '/\/python\/worker.py$/ {print}')"
if [[ ! -x "$python" || ! -f "$worker" ]]; then
  echo "Install the Pymss Studio DEB before configuring its runtime." >&2
  exit 1
fi
export PYMSS_STUDIO_DATA_ROOT="${PYMSS_STUDIO_DATA_ROOT:-$HOME/.pymss-studio}"
mkdir -p "$PYMSS_STUDIO_DATA_ROOT"
export PYMSS_STUDIO_DATA_ROOT="$(realpath -- "$PYMSS_STUDIO_DATA_ROOT")"
export PYMSS_STUDIO_RUNTIME_ENVS_DIR="$PYMSS_STUDIO_DATA_ROOT/runtime-envs"
export PYMSS_STUDIO_ACTIVE_RUNTIME_FILE="$PYMSS_STUDIO_RUNTIME_ENVS_DIR/active-runtime.json"
export PYTHONDONTWRITEBYTECODE=1
echo "Close Pymss Studio before installing, switching, or repairing a runtime."
"$python" - "$worker" "$backend" "${2:-}" <<'PY'
import json
import os
from pathlib import Path
import subprocess
import sys

worker, backend, option = sys.argv[1:]
state = Path(os.environ["PYMSS_STUDIO_RUNTIME_ENVS_DIR"]) / backend / "pymss-runtime-state.json"
command = "activate_runtime" if state.is_file() and option != "--reinstall" else "install_runtime"
payload = json.dumps({"backend": backend, "mirror": "pypi", "locale": "en"})
print(f"{'Activating' if command == 'activate_runtime' else 'Installing'} {backend} runtime...", flush=True)
process = subprocess.Popen(
    [sys.executable, worker, command, "--payload", payload],
    stdout=subprocess.PIPE, text=True, encoding="utf-8", errors="replace",
)
completed = False
assert process.stdout is not None
for line in process.stdout:
    try:
        event = json.loads(line)
    except ValueError:
        print(line.rstrip(), flush=True)
        continue
    kind = event.get("type")
    data = event.get("payload") or {}
    if kind == "runtime_install_log":
        print(data.get("message", ""), flush=True)
    elif kind == "runtime_install_stage":
        print(f"== {data.get('stage', 'runtime')} ==", flush=True)
    elif kind in {"runtime_install_finished", "runtime_activated"}:
        completed = True
        state = data.get("state") or data
        print(f"Runtime ready: {backend}; PyTorch {state.get('torchVersion', 'configured')}", flush=True)
    elif kind == "error":
        print(f"{data.get('code', 'ERROR')}: {data.get('message', '')}", file=sys.stderr, flush=True)
code = process.wait()
if code or not completed:
    print("Runtime setup failed. To rebuild an incomplete environment, rerun with --reinstall.", file=sys.stderr)
    raise SystemExit(code or 1)
print("Start Pymss Studio from the desktop launcher.")
PY
