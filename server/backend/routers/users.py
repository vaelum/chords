from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..schemas import UserOut, UserCreate, UserUpdate, PasswordChange, LoginRequest, TokenResponse
from ..auth import (
    hash_password, verify_password, create_token,
    get_current_user, require_admin, verify_admin_passcode,
)
from ..secrets_store import ADMIN_HANDLE

router = APIRouter(prefix="/users", tags=["users"])
auth_router = APIRouter(prefix="/auth", tags=["auth"])


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

@auth_router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = (
        db.query(User)
        .filter((User.handle == body.handle) | (User.email == body.handle))
        .first()
    )
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    # The bootstrap admin's passcode lives in secrets.json (not the DB) so the
    # operator can rotate it by editing the file.
    if user.handle == ADMIN_HANDLE:
        ok = verify_admin_passcode(body.password)
    else:
        ok = verify_password(body.password, user.password_hash)

    if not ok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    return TokenResponse(
        access_token=create_token(user.id),
        user=UserOut.model_validate(user),
    )


@auth_router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return UserOut.model_validate(current_user)


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

@router.get("", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return [UserOut.model_validate(u) for u in db.query(User).all()]


@router.get("/{user_id}", response_model=UserOut)
def get_user(
    user_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    return UserOut.model_validate(user)




@router.put("/me", response_model=UserOut)
def update_me(
    body: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if body.handle and body.handle != current_user.handle:
        if current_user.handle == ADMIN_HANDLE:
            raise HTTPException(403, "The admin handle is fixed and cannot be changed")
        if db.query(User).filter(User.handle == body.handle).first():
            raise HTTPException(409, "Handle already taken")
    if body.email and body.email != current_user.email:
        if db.query(User).filter(User.email == body.email).first():
            raise HTTPException(409, "Email already registered")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(current_user, field, value)
    db.commit()
    db.refresh(current_user)
    return UserOut.model_validate(current_user)


@router.put("/me/password", status_code=204)
def change_password(
    body: PasswordChange,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.handle == ADMIN_HANDLE:
        raise HTTPException(
            403,
            "The admin passcode is managed via secrets.json — edit that file to change it",
        )
    if not verify_password(body.current_password, current_user.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    current_user.password_hash = hash_password(body.new_password)
    db.commit()
