import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas, auth

router = APIRouter(prefix="/invites", tags=["invites"])


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    """SQLite may hand back naive datetimes; treat them as UTC for comparison."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _status(invite: models.Invite) -> str:
    if invite.used_at is not None:
        return "used"
    exp = _aware(invite.expires_at)
    if exp is not None and exp < _now_utc():
        return "expired"
    return "active"


def _link(request: Request, token: str) -> str:
    # base_url already ends with "/", e.g. "https://host/"
    return f"{str(request.base_url)}?invite={token}"


def _serialize(invite: models.Invite, request: Request) -> dict:
    return {
        "id": invite.id,
        "token": invite.token,
        "url": _link(request, invite.token),
        "email": invite.email,
        "created_at": invite.created_at,
        "expires_at": invite.expires_at,
        "used_at": invite.used_at,
        "used_by_handle": invite.redeemer.handle if invite.redeemer else None,
        "status": _status(invite),
    }


def _initials(name: str) -> str:
    parts = name.split()
    if not parts:
        return "??"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[1][0]).upper()


# ---------- Admin: manage invites ----------
@router.get("", response_model=list[schemas.InviteOut])
def list_invites(
    request: Request,
    admin: models.User = Depends(auth.require_admin),
    db: Session = Depends(get_db),
):
    invites = db.query(models.Invite).order_by(models.Invite.created_at.desc()).all()
    return [_serialize(i, request) for i in invites]


@router.post("", response_model=schemas.InviteOut, status_code=status.HTTP_201_CREATED)
def create_invite(
    payload: schemas.InviteCreate,
    request: Request,
    admin: models.User = Depends(auth.require_admin),
    db: Session = Depends(get_db),
):
    if payload.email and db.query(models.User).filter(models.User.email == payload.email).first():
        raise HTTPException(status_code=400, detail="A user with that email already exists")

    expires_at = None
    if payload.expires_in_days and payload.expires_in_days > 0:
        expires_at = _now_utc() + timedelta(days=payload.expires_in_days)

    invite = models.Invite(
        token=secrets.token_urlsafe(32),
        created_by=admin.id,
        email=payload.email,
        expires_at=expires_at,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return _serialize(invite, request)


@router.delete("/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_invite(
    invite_id: str,
    admin: models.User = Depends(auth.require_admin),
    db: Session = Depends(get_db),
):
    invite = db.query(models.Invite).filter(models.Invite.id == invite_id).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    db.delete(invite)
    db.commit()
    return None


# ---------- Public: open & redeem an invite ----------
@router.get("/{token}", response_model=schemas.InviteInfo)
def get_invite(token: str, db: Session = Depends(get_db)):
    invite = db.query(models.Invite).filter(models.Invite.token == token).first()
    if not invite:
        return schemas.InviteInfo(valid=False, reason="This invite link is invalid.")
    st = _status(invite)
    if st == "used":
        return schemas.InviteInfo(valid=False, reason="This invite link has already been used.")
    if st == "expired":
        return schemas.InviteInfo(valid=False, reason="This invite link has expired.")
    return schemas.InviteInfo(valid=True, email=invite.email)


@router.post("/{token}/accept", response_model=schemas.TokenResponse, status_code=status.HTTP_201_CREATED)
def accept_invite(token: str, payload: schemas.AcceptInviteRequest, db: Session = Depends(get_db)):
    invite = db.query(models.Invite).filter(models.Invite.token == token).first()
    if not invite or _status(invite) != "active":
        raise HTTPException(status_code=400, detail="This invite link is no longer valid.")

    # If the invite was addressed to a specific email, it governs the account email.
    email = invite.email or payload.email
    if not email:
        raise HTTPException(status_code=400, detail="Email is required.")
    if invite.email and payload.email and payload.email.lower() != invite.email.lower():
        raise HTTPException(status_code=400, detail="This invite is for a different email address.")

    existing = db.query(models.User).filter(
        (models.User.email == email) | (models.User.handle == payload.handle)
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email or handle already taken")

    user = models.User(
        name=payload.name,
        handle=payload.handle,
        email=email,
        password_hash=auth.hash_password(payload.password),
        color=payload.color or "av-1",
        initials=_initials(payload.name),
    )
    db.add(user)
    db.flush()  # assign user.id before marking the invite consumed

    invite.used_at = _now_utc()
    invite.used_by = user.id
    db.add(invite)
    db.commit()
    db.refresh(user)

    return schemas.TokenResponse(
        access_token=auth.create_token(user.id),
        user=schemas.UserOut.model_validate(user),
    )
