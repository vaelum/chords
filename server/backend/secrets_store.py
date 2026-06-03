"""Manages chords-data/secrets.json — JWT signing key and admin passcode.

Both values are auto-generated on first run and persisted to the data directory.
The admin passcode is read fresh from the file on every admin login, so the
operator can change it by editing the file directly.
"""

import json
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
