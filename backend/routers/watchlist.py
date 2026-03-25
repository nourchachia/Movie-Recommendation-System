"""
backend/routers/watchlist.py — Watchlist management endpoints

Endpoints:
  POST   /api/watchlist
  GET    /api/watchlist
  DELETE /api/watchlist/{movie_id}
  PATCH  /api/watchlist/{movie_id}
"""

from fastapi import APIRouter, Body, Depends, HTTPException, Path, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.core.database import get_db, get_current_user

router = APIRouter(tags=["Watchlist"])


# ── Pydantic Models ────────────────────────────────────────────────────────────

class WatchlistAddRequest(BaseModel):
    movie_id: int  = Field(..., gt=0)
    note:     str | None = Field(None, max_length=300)


class WatchlistUpdateRequest(BaseModel):
    note: str | None = Field(None, max_length=300)


# ── POST /api/watchlist ────────────────────────────────────────────────────────

@router.post("/api/watchlist", status_code=status.HTTP_201_CREATED,
             summary="Add a movie to your watchlist")
def add_to_watchlist(
    payload: WatchlistAddRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    movie_row = db.execute(
        text("SELECT movie_id, title, genres, tmdb_id FROM movies WHERE movie_id = :mid"),
        {"mid": payload.movie_id}
    ).fetchone()
    if not movie_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Movie {payload.movie_id} not found in the database.")

    try:
        row = db.execute(
            text("""
                INSERT INTO watchlist (user_id, movie_id, note)
                VALUES (:uid, :mid, :note)
                RETURNING id, added_at
            """),
            {"uid": current_user.id, "mid": payload.movie_id, "note": payload.note}
        ).fetchone()
        db.commit()
    except Exception as exc:
        db.rollback()
        if "unique" in str(exc).lower() or "duplicate" in str(exc).lower():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail=f"'{movie_row.title}' is already in your watchlist.")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"Database error: {str(exc)}")

    return {
        "status":  "added",
        "message": f"'{movie_row.title}' has been added to your watchlist! 🎬",
        "entry": {
            "id":       row.id,
            "movie_id": movie_row.movie_id,
            "title":    movie_row.title,
            "genres":   movie_row.genres.split("|") if movie_row.genres else [],
            "tmdb_id":  movie_row.tmdb_id,
            "note":     payload.note,
            "added_at": str(row.added_at),
        }
    }


# ── GET /api/watchlist ─────────────────────────────────────────────────────────

@router.get("/api/watchlist", summary="Get your full watchlist")
def get_watchlist(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    rows = db.execute(
        text("""
            SELECT w.id, w.movie_id, m.title, m.genres, m.tmdb_id, w.note, w.added_at
            FROM watchlist w
            JOIN movies m ON m.movie_id = w.movie_id
            WHERE w.user_id = :uid
            ORDER BY w.added_at DESC
        """),
        {"uid": current_user.id}
    ).fetchall()

    return {
        "user_id":  current_user.id,
        "total":    len(rows),
        "watchlist": [
            {
                "id":       r.id,
                "movie_id": r.movie_id,
                "title":    r.title,
                "genres":   r.genres.split("|") if r.genres else [],
                "tmdb_id":  r.tmdb_id,
                "note":     r.note,
                "added_at": str(r.added_at),
            }
            for r in rows
        ]
    }


# ── DELETE /api/watchlist/{movie_id} ──────────────────────────────────────────

@router.delete("/api/watchlist/{movie_id}", status_code=200,
               summary="Remove a movie from your watchlist")
def remove_from_watchlist(
    movie_id: int = Path(..., gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    result = db.execute(
        text("DELETE FROM watchlist WHERE user_id = :uid AND movie_id = :mid"),
        {"uid": current_user.id, "mid": movie_id}
    )
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Movie {movie_id} is not in your watchlist.")
    return {"status": "removed", "message": f"Movie {movie_id} removed from your watchlist."}


# ── PATCH /api/watchlist/{movie_id} ───────────────────────────────────────────

@router.patch("/api/watchlist/{movie_id}", status_code=200,
              summary="Update the note on a watchlist entry")
def update_watchlist_note(
    movie_id: int = Path(..., gt=0),
    payload: WatchlistUpdateRequest = Body(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    result = db.execute(
        text("UPDATE watchlist SET note = :note WHERE user_id = :uid AND movie_id = :mid"),
        {"note": payload.note, "uid": current_user.id, "mid": movie_id}
    )
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Movie {movie_id} is not in your watchlist.")
    return {"status": "updated", "message": f"Note for movie {movie_id} updated.", "note": payload.note}
