#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${ACTIVITY_CMS_PSD_VENV:-"$SCRIPT_DIR/.venv"}"

find_python() {
  if [[ -n "${PYTHON:-}" ]]; then
    command -v "$PYTHON"
    return
  fi

  for candidate in python3.14 python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
      "$candidate" - <<'PY' >/dev/null 2>&1 && { command -v "$candidate"; return; }
import sys
raise SystemExit(0 if sys.version_info >= (3, 10) else 1)
PY
    fi
  done
}

PYTHON_BIN="$(find_python || true)"

if [[ -z "$PYTHON_BIN" ]]; then
  cat >&2 <<'EOF'
Python 3.10+ was not found.

Please install Python 3.10+ first, then rerun:
  ./install.sh

On macOS with Homebrew:
  brew install python
EOF
  exit 1
fi

"$PYTHON_BIN" - <<'PY'
import sys
if sys.version_info < (3, 10):
    raise SystemExit("Python 3.10+ is required.")
PY

"$PYTHON_BIN" -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/python" -m pip install -r "$SCRIPT_DIR/requirements.txt"

"$VENV_DIR/bin/python" - <<'PY'
from PIL import Image
import psd_tools
import tinify
print("Python dependencies OK")
PY

cat <<EOF

activity-cms-psd is ready.

Virtual environment:
  $VENV_DIR

Run:
  ./activity-cms-psd /path/to/activity.psd --out /path/to/output
EOF
