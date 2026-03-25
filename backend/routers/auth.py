"""
backend/routers/auth.py — JWT Authentication endpoints

Endpoints:
  POST   /auth/register
  POST   /auth/login
  POST   /auth/refresh
  POST   /auth/forgot-password
  POST   /auth/reset-password
  GET    /auth/me
  POST   /auth/me/deactivate
  POST   /auth/2fa/setup
  POST   /auth/2fa/verify
  POST   /auth/2fa/disable
"""

import os
import re
import secrets
import threading

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.core.database import get_db, get_current_user
from backend.core.auth import (
    hash_password, verify_password, validate_password_strength,
    create_access_token, create_refresh_token,
    create_password_reset_token,
    decode_refresh_token, decode_reset_token,
)
from backend.services.email_service import (
    send_password_reset_email, send_2fa_code_email, send_welcome_email,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")


# ── Pydantic Models ────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email:    EmailStr
    password: str = Field(..., min_length=8)

    @field_validator("username")
    @classmethod
    def username_alphanumeric(cls, v: str) -> str:
        if not re.match(r"^[a-zA-Z0-9_]+$", v):
            raise ValueError("Username may only contain letters, numbers, and underscores.")
        return v.strip()

    @field_validator("password")
    @classmethod
    def password_strong_enough(cls, v: str) -> str:
        issues = validate_password_strength(v)
        if issues:
            raise ValueError(" ".join(issues))
        return v


class LoginRequest(BaseModel):
    email:    EmailStr
    password: str
    totp_code: str | None = Field(None, description="6-digit TOTP code (only if 2FA is enabled)")


class RefreshRequest(BaseModel):
    refresh_token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token:        str
    new_password: str = Field(..., min_length=8)

    @field_validator("new_password")
    @classmethod
    def password_strong_enough(cls, v: str) -> str:
        issues = validate_password_strength(v)
        if issues:
            raise ValueError(" ".join(issues))
        return v


class Enable2FARequest(BaseModel):
    totp_code: str = Field(..., description="6-digit code sent to your email")


class DeactivateRequest(BaseModel):
    password: str = Field(..., description="Your current password to confirm")


# ── POST /auth/register ────────────────────────────────────────────────────────

@router.post("/register", status_code=status.HTTP_201_CREATED,
             summary="Register a new Flicker account")
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    existing = db.execute(
        text("SELECT id FROM users WHERE LOWER(email) = LOWER(:email)"),
        {"email": payload.email}
    ).fetchone()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="An account with this email already exists.")

    existing_username = db.execute(
        text("SELECT id FROM users WHERE LOWER(username) = LOWER(:username)"),
        {"username": payload.username}
    ).fetchone()
    if existing_username:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="This username is already taken.")

    hashed = hash_password(payload.password)
    new_user = db.execute(
        text("""
            INSERT INTO users (email, username, hashed_password, role)
            VALUES (:email, :username, :hashed, 'user')
            RETURNING id, email, username, role
        """),
        {"email": payload.email, "username": payload.username, "hashed": hashed}
    ).fetchone()
    db.commit()

    threading.Thread(
        target=lambda: __import__('asyncio').run(
            send_welcome_email(new_user.email, new_user.username)
        ),
        daemon=True
    ).start()

    access_token  = create_access_token(new_user.id, new_user.email, new_user.role)
    refresh_token = create_refresh_token(new_user.id)

    return {
        "message":       "Account created successfully! Welcome to Flicker.",
        "access_token":  access_token,
        "refresh_token": refresh_token,
        "token_type":    "bearer",
        "user": {
            "id":       new_user.id,
            "email":    new_user.email,
            "username": new_user.username,
            "role":     new_user.role,
        }
    }


# ── POST /auth/login ───────────────────────────────────────────────────────────

@router.post("/login", summary="Log in and receive tokens")
def login(payload: LoginRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    try:
        user = db.execute(
            text("SELECT id, email, username, hashed_password, role, is_active, totp_enabled, totp_secret FROM users WHERE LOWER(email) = LOWER(:email)"),
            {"email": payload.email}
        ).fetchone()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error during login: {str(exc)}"
        )

    auth_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid email or password."
    )
    if not user:
        raise auth_error
    if not verify_password(payload.password, user.hashed_password):
        raise auth_error

    if bool(user.totp_enabled):
        if not payload.totp_code:
            new_code = "".join(secrets.choice("0123456789") for _ in range(6))
            db.execute(
                text("UPDATE users SET totp_secret = :code WHERE id = :uid"),
                {"code": new_code, "uid": user.id}
            )
            db.commit()
            threading.Thread(
                target=lambda: __import__('asyncio').run(
                    send_2fa_code_email(user.email, new_code)
                ),
                daemon=True
            ).start()
            raise HTTPException(status_code=status.HTTP_202_ACCEPTED, detail="2FA_REQUIRED")

        if payload.totp_code != user.totp_secret:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid 2FA code. Please try again or request a new one."
            )
        db.execute(text("UPDATE users SET totp_secret = NULL WHERE id = :uid"), {"uid": user.id})
        db.commit()

    if not user.is_active:
        db.execute(text("UPDATE users SET is_active = TRUE WHERE id = :uid"), {"uid": user.id})
        db.commit()

    access_token  = create_access_token(user.id, user.email, user.role)
    refresh_token = create_refresh_token(user.id)

    return {
        "access_token":  access_token,
        "refresh_token": refresh_token,
        "token_type":    "bearer",
        "user": {
            "id":           user.id,
            "email":        user.email,
            "username":     user.username,
            "role":         user.role,
            "totp_enabled": bool(user.totp_enabled),
        }
    }


# ── POST /auth/refresh ─────────────────────────────────────────────────────────

@router.post("/refresh", summary="Silently renew tokens")
def refresh_tokens(payload: RefreshRequest, db: Session = Depends(get_db)):
    token_data = decode_refresh_token(payload.refresh_token)
    if not token_data:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Invalid or expired refresh token. Please log in again.")

    user = db.execute(
        text("SELECT id, email, username, role, is_active FROM users WHERE id = :uid"),
        {"uid": int(token_data["sub"])}
    ).fetchone()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Account not found or has been deactivated.")

    return {
        "access_token":  create_access_token(user.id, user.email, user.role),
        "refresh_token": create_refresh_token(user.id),
        "token_type":    "bearer",
    }


# ── POST /auth/forgot-password ─────────────────────────────────────────────────

@router.post("/forgot-password", summary="Request a password reset email")
async def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)):
    user = db.execute(
        text("SELECT id, email FROM users WHERE LOWER(email) = LOWER(:email)"),
        {"email": payload.email}
    ).fetchone()

    if user:
        reset_token = create_password_reset_token(user.id, user.email)
        reset_link  = f"{FRONTEND_URL}/reset-password?token={reset_token}"
        try:
            await send_password_reset_email(user.email, reset_link)
        except Exception:
            pass

    return {"message": "If an account with that email exists, you will receive a password reset link shortly."}


# ── POST /auth/reset-password ──────────────────────────────────────────────────

@router.post("/reset-password", summary="Set a new password using reset token")
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    token_data = decode_reset_token(payload.token)
    if not token_data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="This password reset link is invalid or has expired.")

    new_hash = hash_password(payload.new_password)
    result = db.execute(
        text("UPDATE users SET hashed_password = :hashed WHERE id = :uid"),
        {"hashed": new_hash, "uid": int(token_data["sub"])}
    )
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found.")

    return {"message": "Password updated successfully. You can now log in with your new password."}


# ── GET /auth/me ───────────────────────────────────────────────────────────────

@router.get("/me", summary="Get current logged-in user info")
def get_me(current_user=Depends(get_current_user)):
    return {
        "id":           current_user.id,
        "email":        current_user.email,
        "username":     current_user.username,
        "role":         current_user.role,
        "totp_enabled": current_user.totp_enabled,
    }


# ── POST /auth/me/deactivate ───────────────────────────────────────────────────

@router.post("/me/deactivate", summary="Deactivate (soft-delete) your account")
def deactivate_account(
    payload: DeactivateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    row = db.execute(
        text("SELECT hashed_password FROM users WHERE id = :uid"),
        {"uid": current_user.id}
    ).fetchone()
    if not verify_password(payload.password, row.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password.")

    db.execute(
        text("UPDATE users SET is_active = FALSE WHERE id = :uid"),
        {"uid": current_user.id}
    )
    db.commit()
    return {"message": "Your account has been deactivated. You can restore it anytime by logging into /auth/login."}


# ── POST /auth/2fa/setup ───────────────────────────────────────────────────────

@router.post("/2fa/setup", summary="Initiate 2FA setup — sends code to email")
def setup_2fa(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    code = "".join(secrets.choice("0123456789") for _ in range(6))
    db.execute(
        text("UPDATE users SET totp_secret = :code WHERE id = :uid"),
        {"code": code, "uid": current_user.id}
    )
    db.commit()
    background_tasks.add_task(send_2fa_code_email, current_user.email, code)
    return {"message": "A 6-digit verification code has been sent to your email. Call POST /auth/2fa/verify to complete setup."}


# ── POST /auth/2fa/verify ──────────────────────────────────────────────────────

@router.post("/2fa/verify", summary="Confirm 2FA setup by verifying the email code")
def verify_2fa_setup(
    payload: Enable2FARequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    row = db.execute(
        text("SELECT totp_secret FROM users WHERE id = :uid"),
        {"uid": current_user.id}
    ).fetchone()
    if not row or not row.totp_secret:
        raise HTTPException(status_code=400, detail="No 2FA setup in progress. Call POST /auth/2fa/setup first.")
    if payload.totp_code != row.totp_secret:
        raise HTTPException(status_code=400, detail="Invalid code. Please check your email and try again.")

    db.execute(
        text("UPDATE users SET totp_enabled = TRUE, totp_secret = NULL WHERE id = :uid"),
        {"uid": current_user.id}
    )
    db.commit()
    return {"message": "2FA has been successfully enabled on your account! ✅"}


# ── POST /auth/2fa/disable ─────────────────────────────────────────────────────

@router.post("/2fa/disable", summary="Disable 2FA")
def disable_2fa(
    payload: DeactivateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    row = db.execute(
        text("SELECT hashed_password FROM users WHERE id = :uid"),
        {"uid": current_user.id}
    ).fetchone()
    if not verify_password(payload.password, row.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid password.")

    db.execute(
        text("UPDATE users SET totp_enabled = FALSE, totp_secret = NULL WHERE id = :uid"),
        {"uid": current_user.id}
    )
    db.commit()
    return {"message": "2FA has been successfully disabled."}
