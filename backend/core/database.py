"""
backend/database.py — Shared database engine, session factory, and dependencies.

Every router imports from here:
    from backend.database import get_db, get_current_user
"""

import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import NullPool
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from backend.core.auth import decode_access_token

load_dotenv()

# ── Engine ─────────────────────────────────────────────────────────────────────
DB_URL = os.getenv("DATABASE_URL")
if not DB_URL:
    raise ValueError("CRITICAL: DATABASE_URL is missing from environment variables!")

# Reverted from NullPool: Re-enabling SQLAlchemy's default QueuePool is critical for WSL.
# Creating a new TCP connection on every request (NullPool) takes 15s+ due to WSL IPv6 resolution delays.
# pool_pre_ping=True ensures idle connections dropped by Neon are silently recreated.
engine = create_engine(
    DB_URL,
    pool_pre_ping=True,
    connect_args={"connect_timeout": 15},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


# ── Session Dependency ─────────────────────────────────────────────────────────
def get_db():
    """Yield a fresh SQLAlchemy session for every request, closing it after."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Auth Dependency ────────────────────────────────────────────────────────────
# HTTPBearer tells FastAPI to look for "Authorization: Bearer <token>".
# It also makes Swagger UI show a text box where users can paste their JWT.
security_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(security_scheme),
    db: Session = Depends(get_db),
):
    """FastAPI dependency: validates the Bearer token and returns the user row.

    Inject into any endpoint requiring authentication:
        @router.post("/api/ratings")
        def submit_rating(..., current_user = Depends(get_current_user)):
            # current_user.id, .email, .role, .username are available
    """
    # Defensive parsing: remove quotes if the user accidentally pasted them
    token = creds.credentials.strip("\"'") if creds else None

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated. Please log in.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = db.execute(
        text(
            "SELECT id, email, username, role, is_active, totp_enabled "
            "FROM users WHERE id = :uid"
        ),
        {"uid": int(payload["sub"])},
    ).fetchone()
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account not found or has been deactivated.",
        )
    return user