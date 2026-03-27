"""
backend/routers/users.py — User profile endpoints

Endpoints:
  GET /api/users/me/ratings
  GET /api/users/{user_id}/ratings
  GET /api/users/{user_id}/profile
"""

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.core.database import get_db, get_current_user

router = APIRouter(tags=["Users"])


@router.get("/api/users/me/ratings")
def get_my_ratings(
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    rows = db.execute(
        text("""
            SELECT m.movie_id, m.title, m.genres, m.tmdb_id, r.rating,
                   to_timestamp(r.timestamp) AS rated_at
            FROM ratings r
            JOIN movies m ON m.movie_id = r.movie_id
            WHERE r.user_id = :uid
            ORDER BY r.timestamp DESC
            LIMIT :limit
        """),
        {"uid": current_user.id, "limit": limit}
    ).fetchall()
    return {
        "user_id": current_user.id,
        "total":   len(rows),
        "ratings": [
            {
                "movie_id": r.movie_id, "title":    r.title,
                "genres":   r.genres.split("|") if r.genres else [],
                "tmdb_id":  r.tmdb_id,  "rating":   float(r.rating),
                "rated_at": str(r.rated_at) if r.rated_at else None,
            }
            for r in rows
        ]
    }


@router.get("/api/users/{user_id}/ratings")
def get_user_ratings(
    user_id: int = Path(..., gt=0),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    rows = db.execute(
        text("""
            SELECT m.movie_id, m.title, m.genres, m.tmdb_id, r.rating,
                   to_timestamp(r.timestamp) AS rated_at
            FROM ratings r
            JOIN movies m ON m.movie_id = r.movie_id
            WHERE r.user_id = :uid
            ORDER BY r.timestamp DESC
            LIMIT :limit
        """),
        {"uid": user_id, "limit": limit}
    ).fetchall()
    return {
        "user_id": user_id,
        "total":   len(rows),
        "ratings": [
            {
                "movie_id": r.movie_id, "title":    r.title,
                "genres":   r.genres.split("|") if r.genres else [],
                "tmdb_id":  r.tmdb_id,  "rating":   float(r.rating),
                "rated_at": str(r.rated_at) if r.rated_at else None,
            }
            for r in rows
        ]
    }


@router.get("/api/users/{user_id}/profile")
def get_user_profile(
    user_id: int = Path(..., gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    stats = db.execute(
        text("""
            SELECT
                COUNT(*)                                             AS total_ratings,
                ROUND(AVG(rating)::numeric, 2)                       AS average_rating,
                COUNT(*) FILTER (WHERE rating <= 1.5)                AS stars_1,
                COUNT(*) FILTER (WHERE rating BETWEEN 1.6 AND 2.5)  AS stars_2,
                COUNT(*) FILTER (WHERE rating BETWEEN 2.6 AND 3.5)  AS stars_3,
                COUNT(*) FILTER (WHERE rating BETWEEN 3.6 AND 4.5)  AS stars_4,
                COUNT(*) FILTER (WHERE rating > 4.5)                 AS stars_5
            FROM ratings WHERE user_id = :uid
        """),
        {"uid": user_id}
    ).fetchone()

    if not stats or stats.total_ratings == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"User {user_id} not found or has no ratings yet.")

    fav_rows = db.execute(
        text("""
            SELECT m.movie_id, m.title, m.genres, m.tmdb_id, r.rating
            FROM movies m JOIN ratings r ON m.movie_id = r.movie_id
            WHERE r.user_id = :uid AND r.rating >= 4.0
            ORDER BY r.rating DESC, m.title ASC
        """),
        {"uid": user_id}
    ).fetchall()

    favorites = []
    genre_freq: dict[str, int] = {}
    for row in fav_rows:
        genres = row.genres.split("|") if row.genres else []
        favorites.append({
            "movie_id": row.movie_id, "title":   row.title,
            "genres":   genres,        "tmdb_id": row.tmdb_id,
            "rating":   float(row.rating),
        })
        for g in genres:
            genre_freq[g] = genre_freq.get(g, 0) + 1

    top_genres = [g for g, _ in sorted(genre_freq.items(), key=lambda x: x[1], reverse=True)[:3]]

    return {
        "user_id":        user_id,
        "total_ratings":  int(stats.total_ratings),
        "average_rating": float(stats.average_rating),
        "rating_breakdown": {
            "1_star":  int(stats.stars_1), "2_stars": int(stats.stars_2),
            "3_stars": int(stats.stars_3), "4_stars": int(stats.stars_4),
            "5_stars": int(stats.stars_5),
        },
        "top_genres": top_genres,
        "favorites":  favorites,
    }