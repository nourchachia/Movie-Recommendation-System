"""
backend/routers/sessions.py — Watch Together swipe-to-match endpoints

Endpoints:
  POST   /api/sessions                     → Create a session (generates invite code)
  POST   /api/sessions/{code}/join         → Guest joins the session
  GET    /api/sessions/{code}              → Poll session state + get movie pool
  POST   /api/sessions/{code}/swipe        → Record a swipe; detects mutual matches
  GET    /api/sessions/{code}/matches      → Get all matched movies
  WS     /ws/sessions/{code}              → WebSocket room for real-time match events

Flow:
  1. User A  →  POST /api/sessions              → receives code e.g. "FILM4829"
  2. User A shares the code with User B
  3. User B  →  POST /api/sessions/FILM4829/join
  4. Both connect to WS /ws/sessions/FILM4829, then poll GET until status == "active"
  5. Both swipe via POST /api/sessions/FILM4829/swipe for each card
  6. When both swipe right on the same movie → WS broadcasts {"event":"match","movie_id":...}
     and the REST response also returns {"match": true}
  7. GET /api/sessions/FILM4829/matches returns the complete matched list
"""

import asyncio
import json
import random
import string

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.core.database import get_db, get_current_user
from backend.core.state import ml_artifacts

router = APIRouter(tags=["Watch Together"])


# ── WebSocket Session Manager ──────────────────────────────────────────────────

class SessionManager:
    """
    In-memory WebSocket room manager.

    Each Watch-Together session code maps to a list of connected WebSocket
    clients.  When a mutual right-swipe happens the swipe endpoint calls
    `broadcast_match` so *both* clients receive the match event in real time
    without polling.

    NOTE: this works perfectly for a single-server deployment (Render, Railway,
    etc.).  For multi-node deployments replace with a Redis pub/sub backend.
    """

    def __init__(self) -> None:
        self.rooms: dict[str, list[WebSocket]] = {}

    async def connect(self, code: str, ws: WebSocket) -> None:
        """Accept the WebSocket handshake and register it in the room."""
        await ws.accept()
        self.rooms.setdefault(code, []).append(ws)

    def disconnect(self, code: str, ws: WebSocket) -> None:
        """Remove a closed socket from the room (no-op if already gone)."""
        room = self.rooms.get(code, [])
        if ws in room:
            room.remove(ws)
        # Clean up empty rooms to avoid unbounded memory growth
        if not room:
            self.rooms.pop(code, None)

    async def broadcast_match(self, code: str, movie_id: int) -> None:
        """
        Broadcast a match event to every connected client in the room.
        Dead sockets are silently purged so one crashed tab doesn't block others.
        """
        payload = {"event": "match", "movie_id": movie_id}
        dead: list[WebSocket] = []
        for ws in list(self.rooms.get(code, [])):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(code, ws)

    async def broadcast_join(self, code: str) -> None:
        """
        Notify all clients that the session is now active (guest has joined).
        Lets the creator's UI transition from the waiting screen without polling.
        """
        payload = {"event": "session_active"}
        dead: list[WebSocket] = []
        for ws in list(self.rooms.get(code, [])):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(code, ws)


# Singleton shared across the whole process
manager = SessionManager()


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

    FIX #1: SVD model is optional — if unavailable, fallback to community
    ranking so the endpoint still works without ML.
    """
    svd = ml_artifacts.get("svd_model")
    # FIX #1: Don't hard-fail if SVD isn't loaded; use community score fallback instead
    # (previously raised 503 which blocked all Watch Together sessions when model was loading)

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

    # FIX #2: If pool is empty (new user with no ratings exclusions),
    # fall back to just the most popular movies to avoid returning an empty session
    if not pool_rows:
        pool_rows = db.execute(
            text("""
                SELECT m.movie_id, m.title, m.genres, m.tmdb_id
                FROM movies m
                JOIN ratings r ON m.movie_id = r.movie_id
                GROUP BY m.movie_id, m.title, m.genres, m.tmdb_id
                HAVING COUNT(r.rating) >= 20
                ORDER BY AVG(r.rating) DESC, COUNT(r.rating) DESC
                LIMIT :pool_size
            """),
            {"pool_size": pool_size * 3},
        ).fetchall()

    # SVD-score each candidate for the creator, take top pool_size
    scored = []
    for row in pool_rows:
        if svd:
            try:
                est = float(svd.predict(current_user.id, row.movie_id).est)
            except Exception:
                est = 2.5
        else:
            est = 2.5  # FIX #1: community-rank order already applied in SQL
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

    # FIX #3: Remove the `est` field before storing — it's an internal score,
    # not needed in the JSON pool (reduces payload size too)
    pool_to_store = [
        {k: v for k, v in m.items() if k != "est"} for m in pool
    ]

    # FIX #4 (already applied): use CAST(:pool AS jsonb) instead of :pool::jsonb
    # SQLAlchemy's text() parser interprets `:pool::jsonb` as two separate bind
    # parameters (`:pool` and `:jsonb`), causing a syntax error at runtime.
    db.execute(
        text("""
            INSERT INTO watch_sessions (code, creator_id, status, movie_pool)
            VALUES (:code, :creator_id, 'waiting', CAST(:pool AS jsonb))
        """),
        {"code": code, "creator_id": current_user.id, "pool": json.dumps(pool_to_store)},
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
async def join_session(
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

    # FIX #5: guest_id column may already have a value if a previous join attempt
    # partially succeeded — safe to overwrite since we already checked status == 'waiting'
    db.execute(
        text("""
            UPDATE watch_sessions
            SET guest_id = :guest_id, status = 'active'
            WHERE code = :code
        """),
        {"guest_id": current_user.id, "code": code},
    )
    db.commit()

    # Now that this is async def, we can directly await the broadcast
    await manager.broadcast_join(code)

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

    # FIX #7: When the session is still 'waiting', guest_id is NULL.
    # `current_user.id not in (session.creator_id, None)` always evaluates True
    # for the creator when guest_id is None, correctly passing them through.
    # However, a non-member with the code could poll the session while it's
    # waiting (guest_id is None). Only strictly enforce membership once active.
    if session.status == "active" and current_user.id not in (session.creator_id, session.guest_id):
        raise HTTPException(status_code=403, detail="You are not a member of this session.")
    elif session.status == "waiting" and current_user.id != session.creator_id:
        raise HTTPException(status_code=403, detail="You are not a member of this session.")

    # FIX #8: movie_pool from PostgreSQL JSONB comes back as a dict/list already
    # (psycopg2 deserialises JSONB automatically). Wrapping in json.loads() on a
    # dict raises TypeError. Use a type-safe conversion instead.
    raw_pool = session.movie_pool
    if isinstance(raw_pool, str):
        pool = json.loads(raw_pool)
    elif raw_pool is None:
        pool = []
    else:
        pool = raw_pool  # already a list (psycopg2 JSONB auto-deserialise)

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
async def record_swipe(
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

    # FIX #9: other_user_id can be None if guest_id is somehow NULL on an
    # 'active' session (data integrity issue). Guard against it explicitly.
    other_user_id = (
        session.guest_id if current_user.id == session.creator_id else session.creator_id
    )
    if other_user_id is None:
        raise HTTPException(status_code=409, detail="Session partner has not joined yet.")

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

            # Now that this is async def, we can directly await the broadcast
            await manager.broadcast_match(code, body.movie_id)

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
        **( {"matched_movie": movie_details} if is_match else {}),
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


# ── WebSocket /ws/sessions/{code} ─────────────────────────────────────────────

@router.websocket("/ws/sessions/{code}")
async def session_ws(code: str, ws: WebSocket):
    """
    WebSocket room for a Watch-Together session.

    Clients connect here immediately after creating or joining a session and
    stay connected for the lifetime of the swipe flow.  The server pushes two
    event types:

      {"event": "session_active"}          — guest just joined (creator sees this)
      {"event": "match", "movie_id": 123}  — mutual right-swipe detected

    Client-side keepalive:
      Browsers automatically handle the WS ping/pong at the transport level.
      The receive loop below also accepts any text frame (e.g. "ping") and
      echoes nothing — this is enough to satisfy proxy idle-timeout policies.

    FIX #10: Wrap the entire handler in a broad except so that any unexpected
    crash (e.g. uvicorn shutdown, network reset) still cleans up the room
    slot — prevents ghost sockets from accumulating in manager.rooms.
    """
    await manager.connect(code, ws)
    try:
        while True:
            # Receive and discard keepalive frames; real payloads come from
            # broadcast_match / broadcast_join called by the REST endpoints.
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(code, ws)
    except Exception:
        # FIX #10: Catch any other exception (e.g. ConnectionResetError) and
        # still clean up to avoid ghost socket entries.
        manager.disconnect(code, ws)
