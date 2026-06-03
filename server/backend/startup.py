from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from .database import engine, SessionLocal, DATA_DIR
from .models import Base, User
from .secrets_store import get_secrets, SECRETS_FILE, ADMIN_HANDLE


def _run_migrations() -> None:
    """Apply additive schema changes that create_all won't handle on existing DBs."""
    with engine.begin() as conn:
        for stmt in [
            "ALTER TABLE songs ADD COLUMN scroll_speed REAL DEFAULT 1.0",
            "ALTER TABLE inbox_items ADD COLUMN playlist_snapshot TEXT",
            "ALTER TABLE inbox_items ADD COLUMN playlist_id TEXT",
            "ALTER TABLE playlists ADD COLUMN public_token TEXT",
        ]:
            try:
                conn.execute(text(stmt))
            except Exception:
                pass  # column already exists


def init_db() -> None:
    Path(DATA_DIR).mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    _run_migrations()


def init_secrets() -> None:
    """Ensure secrets.json exists with a JWT secret and an admin passcode."""
    get_secrets()  # has the side effect of creating the file if missing
    print(f"[chords] Secrets file: {SECRETS_FILE}")

    # Remove the legacy admin-password.txt if it's still hanging around.
    legacy = Path(DATA_DIR) / "admin-password.txt"
    if legacy.exists():
        legacy.unlink()


def create_admin_if_needed() -> None:
    """Create the bootstrap admin user if it doesn't exist yet. The admin's
    passcode is verified against secrets.json at login, not against the DB,
    so the password_hash here is just a sentinel."""
    db: Session = SessionLocal()
    try:
        existing = db.query(User).filter(User.handle == ADMIN_HANDLE).first()
        if existing:
            return

        admin = User(
            name="Admin",
            handle=ADMIN_HANDLE,
            email="admin@chords.local",
            password_hash="!",  # never matched — admin auth uses secrets.json
            color="av-1",
            initials="AD",
            is_admin=True,
        )
        db.add(admin)
        db.commit()
        print(f"[chords] Admin user created. Passcode is in {SECRETS_FILE}")
    finally:
        db.close()
