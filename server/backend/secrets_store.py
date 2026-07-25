"""Manages chords-data/secrets.json — JWT signing key, admin passcode, and the
OpenRouter API key used by the AI import pipeline.

The JWT secret and admin passcode are auto-generated on first run and persisted
to the data directory. The OpenRouter key is *not* generated — it's supplied by
the operator (`python butler.py server key --openrouter-key …`, or the
OPENROUTER_API_KEY environment variable).

The passcode and the OpenRouter key are read fresh from the file on every use,
so the operator can rotate either by editing the file directly.
"""

import json
import os
import secrets
import string
from pathlib import Path

from .database import DATA_DIR

SECRETS_FILE = Path(DATA_DIR) / "secrets.json"

ADMIN_HANDLE = "admin"


def _generate_passcode(length: int = 20) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _generate_jwt_secret() -> str:
    return secrets.token_urlsafe(48)


def _write(data: dict) -> None:
    SECRETS_FILE.write_text(json.dumps(data, indent=2))
    SECRETS_FILE.chmod(0o600)


def get_secrets() -> dict:
    """Read secrets.json. Auto-generate any missing keys so the file can be
    safely hand-edited (e.g. to rotate the admin passcode)."""
    Path(DATA_DIR).mkdir(parents=True, exist_ok=True)

    try:
        data = json.loads(SECRETS_FILE.read_text())
        if not isinstance(data, dict):
            data = {}
    except (FileNotFoundError, json.JSONDecodeError):
        data = {}

    changed = False
    if not data.get("jwt_secret"):
        data["jwt_secret"] = _generate_jwt_secret()
        changed = True
    if not data.get("admin_passcode"):
        data["admin_passcode"] = _generate_passcode()
        changed = True

    if changed:
        _write(data)

    return data


def get_jwt_secret() -> str:
    return get_secrets()["jwt_secret"]


def get_admin_passcode() -> str:
    """Read fresh from disk so edits to secrets.json take effect immediately."""
    return get_secrets()["admin_passcode"]


def get_openrouter_key() -> str:
    """OpenRouter API key for the AI import pipeline, or "" if none is set.

    The environment wins over secrets.json so a container can be handed a key
    without writing it into the data volume. Read fresh on every call, so
    rotating the key needs no restart."""
    env = (os.environ.get("OPENROUTER_API_KEY") or "").strip()
    if env:
        return env
    return (get_secrets().get("openrouter_api_key") or "").strip()


def set_openrouter_key(key: str) -> None:
    """Persist (or, with an empty value, remove) the OpenRouter API key."""
    data = get_secrets()
    key = (key or "").strip()
    if key:
        data["openrouter_api_key"] = key
    else:
        data.pop("openrouter_api_key", None)
    _write(data)
