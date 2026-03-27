"""
backend/routers/sessions.py — Watch Together swipe-to-match endpoints

Endpoints:
  POST   /api/sessions                     → Create a session (generates invite code)
  POST   /api/sessions/{code}/join         → Guest joins the session
  GET    /api/sessions/{code}              → Poll session state + get movie pool
  POST   /api/sessions/{code}/swipe        → Record a swipe; detects mutual matches
  GET    /api/sessions/{code}/matches      → Get all matched movies

Flow:
  1. User A  →  POST /api/sessions              → receives code e.g. "FILM4829"
  2. User A shares the code with User B
  3. User B  →  POST /api/sessions/FILM4829/join
  4. Both poll GET /api/sessions/FILM4829 until status == "active"
  5. Both swipe via POST /api/sessions/FILM4829/swipe for each card
  6. When both swipe right on the same movie → {"match": true} → "IT'S A MATCH!" UI
  7. GET /api/sessions/FILM4829/matches returns the complete matched list
"""

import json
import random
import string

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.core.database import get_db, get_current_user
from backend.core.state import ml_artifacts

router = APIRouter(tags=["Watch Together"])


# ── Helper ─────────────────────────────────────────────────────────────────────

def _generate_session_code(length: int = 8) -> str:
    """Generate a human-friendly invite code, e.g. 'FILM4829'."""
    chars = string.ascii_uppercase + string.digits
    return "".join(random.choices(chars, k=length))


# ── Pydantic Models ────────────────────────────────────────────────────────────

class SwipeRequest(BaseModel):
    movie_id:  int = Field(..., gt=0)
    direction: str = Field(..., pattern="^(left|right)$")


# ── POST /api/sessions ─────────────────────────────────────────────────────────

@router.post("/api/sessions", summary="Create a Watch-Together session")
def create_session(
    pool_size: int = Query(30, ge=5, le=100,
                           description="Number of movies to pre-load into the card stack"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Creates a new Watch-Together session for the authenticated user.

    SVD-scores a pool of unseen movies for the creator and stores them in the
    session so both users see exactly the same card stack.
    Returns the invite code that User B needs to join.
    """
    svd = ml_artifacts.get("svd_model")
    if not svd:
        raise HTTPException(status_code=503, detail="ML model unavailable — try again later.")

    # Fetch high-quality candidates the creator hasn't rated yet
    pool_rows = db.execute(
        text("""
            SELECT m.movie_id, m.title, m.genres, m.tmdb_id
            FROM movies m
            JOIN ratings r ON m.movie_id = r.movie_id
            WHERE m.movie_id NOT IN (
                SELECT movie_id FROM ratings WHERE user_id = :uid
            )
            GROUP BY m.movie_id, m.title, m.genres, m.tmdb_id
            HAVING COUNT(r.rating) >= 20
            ORDER BY AVG(r.rating) DESC, COUNT(r.rating) DESC
            LIMIT :pool_size
        """),
        {"uid": current_user.id, "pool_size": pool_size * 3},
    ).fetchall()

    # SVD-score each candidate for the creator, take top pool_size
    scored = []
    for row in pool_rows:
        try:
            est = float(svd.predict(current_user.id, row.movie_id).est)
        except Exception:
            est = 2.5
        scored.append({
            "movie_id": row.movie_id,
            "title":    row.title,
            "genres":   row.genres.split("|") if row.genres else [],
            "tmdb_id":  row.tmdb_id,
            "est":      est,
        })
    scored.sort(key=lambda x: x["est"], reverse=True)
    pool = scored[:pool_size]

    # Generate a unique invite code (retry on collision — astronomically rare)
    for _ in range(5):
        code = _generate_session_code()
        if not db.execute(
            text("SELECT id FROM watch_sessions WHERE code = :code"), {"code": code}
        ).fetchone():
            break
    else:
        raise HTTPException(status_code=500, detail="Could not generate a unique session code.")

    db.execute(
        text("""
            INSERT INTO watch_sessions (code, creator_id, status, movie_pool)
            VALUES (:code, :creator_id, 'waiting', :pool::jsonb)
        """),
        {"code": code, "creator_id": current_user.id, "pool": json.dumps(pool)},
    )
    db.commit()

    return {
        "code":      code,
        "status":    "waiting",
        "pool_size": len(pool),
        "message":   f"Session created! Share code '{code}' with your watch-buddy.",
    }


# ── POST /api/sessions/{code}/join ─────────────────────────────────────────────

@router.post("/api/sessions/{code}/join",
             summary="Join an existing Watch-Together session")
def join_session(
    code: str = Path(..., min_length=1),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Lets a second user join a waiting session.
    Status switches 'waiting' → 'active', which both clients detect via polling.
    """
    session = db.execute(
        text("SELECT id, creator_id, guest_id, status FROM watch_sessions WHERE code = :code"),
        {"code": code},
    ).fetchone()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found. Check the code and try again.")
    if session.status != "waiting":
        raise HTTPException(status_code=409, detail="This session is already active or has ended.")
    if session.creator_id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot join your own session.")

    db.execute(
        text("""
            UPDATE watch_sessions
            SET guest_id = :guest_id, status = 'active'
            WHERE code = :code
        """),
        {"guest_id": current_user.id, "code": code},
    )
    db.commit()

    return {
        "code":    code,
        "status":  "active",
        "message": "You have joined the session! Start swiping 🎬",
    }


# ── GET /api/sessions/{code} ───────────────────────────────────────────────────

@router.get("/api/sessions/{code}",
            summary="Poll session status and get the movie pool")
def get_session(
    code: str = Path(..., min_length=1),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Returns the current session state and the full movie pool.
    Poll every 2-3 s while status == 'waiting'.
    Once status == 'active', both clients start the swipe UI.
    """
    session = db.execute(
        text("""
            SELECT id, code, creator_id, guest_id, status,
                   movie_pool, created_at, expires_at
            FROM watch_sessions WHERE code = :code
        """),
        {"code": code},
    ).fetchone()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    if current_user.id not in (session.creator_id, session.guest_id):
        raise HTTPException(status_code=403, detail="You are not a member of this session.")

    pool = json.loads(session.movie_pool) if session.movie_pool else []

    return {
        "code":       session.code,
        "status":     session.status,
        "creator_id": session.creator_id,
        "guest_id":   session.guest_id,
        "movie_pool": pool,
        "expires_at": str(session.expires_at),
    }


# ── POST /api/sessions/{code}/swipe ───────────────────────────────────────────

@router.post("/api/sessions/{code}/swipe",
             summary="Record a swipe and detect mutual matches")
def record_swipe(
    code: str = Path(..., min_length=1),
    body: SwipeRequest = Body(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Records a left or right swipe for the authenticated user on a given movie.

    **Match detection** — if direction is 'right' and the other member already
    swiped 'right' on the same movie, a match row is inserted and
    `{"match": true}` is returned so the frontend can fire the animation.

    Idempotent — duplicate swipes are silently ignored.
    """
    session = db.execute(
        text("SELECT id, creator_id, guest_id, status FROM watch_sessions WHERE code = :code"),
        {"code": code},
    ).fetchone()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    if session.status != "active":
        raise HTTPException(status_code=409, detail="Session is not active yet.")
    if current_user.id not in (session.creator_id, session.guest_id):
        raise HTTPException(status_code=403, detail="You are not a member of this session.")

    other_user_id = (
        session.guest_id if current_user.id == session.creator_id else session.creator_id
    )

    # Insert swipe — ON CONFLICT DO NOTHING makes this safe to retry
    db.execute(
        text("""
            INSERT INTO session_swipes (session_id, user_id, movie_id, direction)
            VALUES (:sid, :uid, :mid, :dir)
            ON CONFLICT (session_id, user_id, movie_id) DO NOTHING
        """),
        {"sid": session.id, "uid": current_user.id,
         "mid": body.movie_id, "dir": body.direction},
    )

    is_match = False
    movie_details = None

    if body.direction == "right":
        other_swipe = db.execute(
            text("""
                SELECT 1 FROM session_swipes
                WHERE session_id = :sid
                  AND movie_id   = :mid
                  AND user_id    = :other_uid
                  AND direction  = 'right'
            """),
            {"sid": session.id, "mid": body.movie_id, "other_uid": other_user_id},
        ).fetchone()

        if other_swipe:
            # IT'S A MATCH
            db.execute(
                text("""
                    INSERT INTO session_matches (session_id, movie_id)
                    VALUES (:sid, :mid)
                    ON CONFLICT (session_id, movie_id) DO NOTHING
                """),
                {"sid": session.id, "mid": body.movie_id},
            )
            is_match = True

            movie_row = db.execute(
                text("SELECT title, genres, tmdb_id FROM movies WHERE movie_id = :mid"),
                {"mid": body.movie_id},
            ).fetchone()
            if movie_row:
                movie_details = {
                    "movie_id": body.movie_id,
                    "title":    movie_row.title,
                    "genres":   movie_row.genres.split("|") if movie_row.genres else [],
                    "tmdb_id":  movie_row.tmdb_id,
                }

    db.commit()

    return {
        "match":     is_match,
        "movie_id":  body.movie_id,
        "direction": body.direction,
        **({"matched_movie": movie_details} if is_match else {}),
    }


# ── GET /api/sessions/{code}/matches ──────────────────────────────────────────

@router.get("/api/sessions/{code}/matches",
            summary="Get all matched movies in a session")
def get_session_matches(
    code: str = Path(..., min_length=1),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Returns every movie both users swiped right on.
    Use this to build a shared watchlist at the end of the swipe session.
    """
    session = db.execute(
        text("SELECT id, creator_id, guest_id FROM watch_sessions WHERE code = :code"),
        {"code": code},
    ).fetchone()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    if current_user.id not in (session.creator_id, session.guest_id):
        raise HTTPException(status_code=403, detail="You are not a member of this session.")

    rows = db.execute(
        text("""
            SELECT sm.movie_id, m.title, m.genres, m.tmdb_id, sm.matched_at
            FROM session_matches sm
            JOIN movies m ON m.movie_id = sm.movie_id
            WHERE sm.session_id = :sid
            ORDER BY sm.matched_at ASC
        """),
        {"sid": session.id},
    ).fetchall()

    return {
        "code":          code,
        "total_matches": len(rows),
        "matches": [
            {
                "movie_id":   r.movie_id,
                "title":      r.title,
                "genres":     r.genres.split("|") if r.genres else [],
                "tmdb_id":    r.tmdb_id,
                "matched_at": str(r.matched_at),
            }
            for r in rows
        ],
    }
