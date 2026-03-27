"""
backend/auth.py — Flicker Authentication Engine
================================================
Handles ALL auth logic: password hashing, JWT creation/verification,
TOTP (2FA) generation and verification.

Intentionally framework-agnostic: no FastAPI imports here so this
module can be unit-tested independently of HTTP machinery.
"""

import os
import secrets
import base64
import io
from datetime import datetime, timedelta, timezone
from typing import Optional

import pyotp
import qrcode
import bcrypt
from jose import JWTError, jwt
from dotenv import load_dotenv

load_dotenv()

# ── JWT Configuration ──────────────────────────────────────────────────────────
SECRET_KEY     = os.getenv("JWT_SECRET_KEY", "CHANGE_ME_IN_PRODUCTION_MIN_32_CHARS")
ALGORITHM      = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_EXPIRE  = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
REFRESH_EXPIRE = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "30"))

# Password hashing configuration - bcrypt handles salts and hashing in one call.
# bcrypt 4.0+ is modern and thread-safe.


# ═══════════════════════════════════════════════════════════════
# PASSWORD UTILITIES
# ═══════════════════════════════════════════════════════════════

def hash_password(plain_password: str) -> str:
    """Hash a plain-text password using bcrypt. Store this — never the original."""
    # bcrypt requires bytes, not string.
    pwd_bytes = plain_password.encode('utf-8')
    # Generate salt and hash the password.
    hashed_password = bcrypt.hashpw(pwd_bytes, bcrypt.gensalt())
    # Return as string for database storage.
    return hashed_password.decode('utf-8')


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Compare a plain input to a stored bcrypt hash. Returns True on match."""
    # Encode both to bytes.
    password_byte_enc = plain_password.encode('utf-8')
    hashed_password_byte_enc = hashed_password.encode('utf-8')
    # Use bcrypt's checkpw for safe comparison.
    return bcrypt.checkpw(password_byte_enc, hashed_password_byte_enc)


def validate_password_strength(password: str) -> list[str]:
    """Return a list of failed requirements. Empty list = password is strong enough."""
    issues = []
    if len(password) < 8:
        issues.append("Must be at least 8 characters long.")
    if not any(c.isupper() for c in password):
        issues.append("Must contain at least one uppercase letter.")
    if not any(c.isdigit() for c in password):
        issues.append("Must contain at least one number.")
    return issues


# ═══════════════════════════════════════════════════════════════
# JWT TOKEN UTILITIES
# ═══════════════════════════════════════════════════════════════

def create_access_token(user_id: int, email: str, role: str) -> str:
    """Create a short-lived access token (expires ACCESS_EXPIRE minutes from now).
    
    This is the token sent as a Bearer header on every API call.
    Short expiry limits damage if a token is intercepted.
    
    Payload:
        sub   → user's DB id (the JWT 'subject')
        email → avoid a DB lookup just for display
        role  → 'user' | 'admin' — checked by protected endpoints
        type  → 'access' — prevents a refresh token being used here
        exp   → Jose validates this automatically on decode
    """
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_EXPIRE)
    payload = {
        "sub":   str(user_id),
        "email": email,
        "role":  role,
        "type":  "access",
        "exp":   expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(user_id: int) -> str:
    """Create a long-lived refresh token (expires REFRESH_EXPIRE days from now).
    
    This is stored by the browser and sent ONLY to POST /auth/refresh.
    It is never sent on normal API calls.
    Contains only the user ID — minimal data in case it is ever decoded.
    """
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_EXPIRE)
    payload = {
        "sub":  str(user_id),
        "type": "refresh",
        "exp":  expire,
        # Random jti prevents a stolen refresh token from being valid after rotation
        "jti":  secrets.token_hex(16),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def create_password_reset_token(user_id: int, email: str) -> str:
    """Create a short-lived (15 minute) token for password resets.
    
    This is embedded in the reset link sent to the user's email.
    Type='reset' prevents it from being used as an access or refresh token.
    """
    expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    payload = {
        "sub":   str(user_id),
        "email": email,
        "type":  "reset",
        "exp":   expire,
        "jti":   secrets.token_hex(16),  # Unique per-link, invalidated once used
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    """Decode and verify a JWT signature + expiry. Returns payload or None."""
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None


def decode_access_token(token: str) -> Optional[dict]:
    """Decode specifically an ACCESS token. Rejects refresh and reset tokens."""
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        return None
    return payload


def decode_refresh_token(token: str) -> Optional[dict]:
    """Decode specifically a REFRESH token. Rejects access and reset tokens."""
    payload = decode_token(token)
    if not payload or payload.get("type") != "refresh":
        return None
    return payload


def decode_reset_token(token: str) -> Optional[dict]:
    """Decode specifically a PASSWORD RESET token. Rejects all other types."""
    payload = decode_token(token)
    if not payload or payload.get("type") != "reset":
        return None
    return payload


# ═══════════════════════════════════════════════════════════════
# 2FA — TOTP (Time-Based One-Time Passwords)
# ═══════════════════════════════════════════════════════════════

def generate_totp_secret() -> str:
    """Generate a new random TOTP secret for a user enabling 2FA.
    
    Store this (encrypted if possible) in the users table.
    It is the seed that both your app and Google Authenticator use
    to generate the matching 6-digit codes.
    """
    return pyotp.random_base32()


def get_totp_uri(secret: str, email: str) -> str:
    """Return the OTPAuth URI used to generate the QR code.
    
    Scanning this URI with Google Authenticator adds the account.
    Format: otpauth://totp/Flicker:user@email.com?secret=XXXX&issuer=Flicker
    """
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=email, issuer_name="Flicker")


def generate_totp_qr_base64(secret: str, email: str) -> str:
    """Generate a QR code image as a base64 string for the frontend to display.
    
    The frontend can render this as: <img src="data:image/png;base64,{result}">
    """
    uri = get_totp_uri(secret, email)
    qr = qrcode.QRCode(box_size=10, border=4)
    qr.add_data(uri)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def verify_totp_code(secret: str, code: str) -> bool:
    """Verify a 6-digit TOTP code against the stored secret.
    
    valid_window=1 allows 1 time-step tolerance (+/- 30 seconds)
    to account for clock drift between the user's phone and server.
    """
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=1)
