"""
backend/routers/ratings.py — Rating submission endpoints

Endpoints:
  POST   /api/ratings
  DELETE /api/ratings/{movie_id}
  POST   /api/retrain
  GET    /api/retrain/status
"""

import os
import sys
import math
import pickle
import threading

from fastapi import APIRouter, Depends, Header, HTTPException, Path, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.core.database import get_db, get_current_user

router = APIRouter(tags=["Ratings"])

# Shared state for the background retraining job
retrain_status: dict = {"state": "idle", "message": "No retraining has been triggered yet."}


# ── Pydantic Models ────────────────────────────────────────────────────────────

class RatingSubmission(BaseModel):
    movie_id:  int   = Field(..., gt=0)
    rating:    float = Field(..., ge=0.5, le=5.0)
    timestamp: int | None = Field(None)

    @field_validator("rating")
    @classmethod
    def rating_must_be_half_step(cls, v: float) -> float:
        if not math.isclose(round(v * 2) / 2, v, abs_tol=1e-6):
            raise ValueError("Rating must be a multiple of 0.5 (e.g. 1.0, 1.5 ... 5.0)")
        return round(v * 2) / 2


# ── POST /api/ratings ──────────────────────────────────────────────────────────

@router.post("/api/ratings", status_code=status.HTTP_201_CREATED)
def submit_rating(
    payload: RatingSubmission,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    movie_row = db.execute(
        text("SELECT title FROM movies WHERE movie_id = :mid"),
        {"mid": payload.movie_id}
    ).fetchone()
    if not movie_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Movie {payload.movie_id} not found.")

    try:
        db.execute(
            text("""
                INSERT INTO ratings (user_id, movie_id, rating, timestamp)
                VALUES (
                    :uid, :mid, :rating,
                    COALESCE(CAST(:ts AS BIGINT), EXTRACT(EPOCH FROM NOW())::BIGINT)
                )
                ON CONFLICT (user_id, movie_id)
                DO UPDATE SET rating = EXCLUDED.rating, timestamp = EXCLUDED.timestamp
            """),
            {"uid": current_user.id, "mid": payload.movie_id,
             "rating": payload.rating, "ts": payload.timestamp}
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        if "unique constraint" in str(exc).lower() or "duplicate key" in str(exc).lower():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="Duplicate rating — UNIQUE constraint may be missing.")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"Database error: {str(exc)}")

    # Auto-remove from watchlist when rated
    try:
        db.execute(
            text("DELETE FROM watchlist WHERE user_id = :uid AND movie_id = :mid"),
            {"uid": current_user.id, "mid": payload.movie_id}
        )
        db.commit()
    except Exception:
        pass

    return {
        "status": "success",
        "message": "Rating saved! Removed from watchlist if it was there. 🎬",
        "user_id": current_user.id,
        "movie_id": payload.movie_id,
        "movie_title": movie_row.title,
        "rating": payload.rating,
        "removed_from_watchlist": True,
    }


# ── DELETE /api/ratings/{movie_id} ────────────────────────────────────────────

@router.delete("/api/ratings/{movie_id}", status_code=200)
def delete_rating(
    movie_id: int = Path(..., gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    result = db.execute(
        text("DELETE FROM ratings WHERE user_id = :uid AND movie_id = :mid"),
        {"uid": current_user.id, "mid": movie_id}
    )
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"No rating found for movie {movie_id} to delete.")
    return {"status": "success", "message": f"Rating for movie {movie_id} has been deleted."}


# ── POST /api/retrain ──────────────────────────────────────────────────────────

def _retrain_worker():
    global retrain_status
    retrain_status = {"state": "running", "message": "Training in progress..."}
    try:
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
        from src.train import run_training_pipeline
        model_path = run_training_pipeline(source="postgres")
        with open(model_path, "rb") as f:
            new_model = pickle.load(f)
        from backend.core.state import ml_artifacts as _state
        _state["svd_model"] = new_model
        retrain_status = {"state": "idle", "message": "Retraining completed. New model is live."}
    except Exception as exc:
        retrain_status = {"state": "error", "message": f"Retraining failed: {exc}. Previous model still active."}


@router.post("/api/retrain", status_code=status.HTTP_202_ACCEPTED)
def trigger_retrain(x_admin_secret: str | None = Header(default=None)):
    expected_secret = os.getenv("ADMIN_SECRET")
    if not expected_secret:
        raise HTTPException(status_code=503, detail="Retraining disabled: ADMIN_SECRET not configured.")
    if x_admin_secret != expected_secret:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Admin-Secret header.")
    if retrain_status["state"] == "running":
        raise HTTPException(status_code=409, detail="A retraining job is already running.")
    threading.Thread(target=_retrain_worker, daemon=True).start()
    return {"status": "accepted", "message": "Retraining started. Poll GET /api/retrain/status to track progress."}


@router.get("/api/retrain/status")
def get_retrain_status():
    return retrain_status
