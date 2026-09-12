"""Shared test setup.

The backend package is `server/backend`, so tests import it as `backend.*` with
`server/` on the path. Both suites here run standalone (`python tests/…`) as well
as under pytest, so neither depends on pytest being installed.
"""

import json
import os
import sys
import tempfile
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = SERVER_DIR.parent

if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))


def use_temp_data_dir() -> str:
    """Point the backend at a throwaway data directory.

    Must run before `backend.database` is imported — it reads CHORDS_DATA_DIR at
    import time, and everything else (secrets.json included) hangs off that. This
    keeps tests away from a real ~/.chords."""
    if "backend.database" in sys.modules:
        raise RuntimeError("call use_temp_data_dir() before importing backend modules")
    tmp = tempfile.mkdtemp(prefix="chords-test-")
    os.environ["CHORDS_DATA_DIR"] = tmp
    return tmp


def find_api_key() -> str:
    """The OpenRouter key for live tests, or "" if there isn't one.

    Looked up in the order a developer would expect:
      1. $OPENROUTER_API_KEY
      2. <repo>/.secrets — either a bare key or KEY=VALUE lines
      3. ~/.chords/secrets.json (or $CHORDS_DATA_DIR/secrets.json)
    """
    env = (os.environ.get("OPENROUTER_API_KEY") or "").strip()
    if env:
        return env

    secrets_file = REPO_ROOT / ".secrets"
    if secrets_file.is_file():
        for line in secrets_file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                name, _, value = line.partition("=")
                if name.strip().upper() in ("OPENROUTER_API_KEY", "OPENROUTER_KEY"):
                    return value.strip().strip("'\"")
            elif line.startswith("sk-"):
                return line  # bare key on its own line

    # Whatever the server itself would use. Read directly rather than through
    # backend.secrets_store, so this works before CHORDS_DATA_DIR is redirected
    # at a temp dir (and never creates files as a side effect).
    data_dir = os.environ.get("CHORDS_DATA_DIR") or (Path.home() / ".chords")
    try:
        stored = json.loads((Path(data_dir) / "secrets.json").read_text())
        return (stored.get("openrouter_api_key") or "").strip()
    except (OSError, ValueError):
        return ""
