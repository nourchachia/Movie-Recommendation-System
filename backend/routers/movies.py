"""
backend/routers/movies.py — Movie discovery endpoints

Endpoints:
  GET /api/movies (was /api/users/{user_id}/favorites)
  GET /api/search
  GET /api/trending
  GET /api/recommendations/top-picks
  GET /api/recommendations/because-you-liked
  GET /api/recommendations/merge
"""

import json
import random
import numpy as np

from fastapi import APIRouter, Depends, HTTPException, Query, Path, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.core.database import get_db, get_current_user
from backend.core.state import ml_artifacts

router = APIRouter(tags=["Movies"])


# ── MOOD / GENRE CONSTANTS ─────────────────────────────────────────────────────

MOOD_MAP: dict[str, list[str]] = {
    "romcom":      ["Romance", "Comedy"],
    "rom-com":     ["Romance", "Comedy"],
    "rom com":     ["Romance", "Comedy"],
    "romantic comedy": ["Romance", "Comedy"],
    "chick flick": ["Romance", "Comedy"],
    "scifi":       ["Sci-Fi"],
    "sci fi":      ["Sci-Fi"],
    "sci-fi":      ["Sci-Fi"],
    "kung fu":     ["Action"],
    "superhero":   ["Action", "Adventure"],
    "anime":       ["Animation"],
    "kids":        ["Children", "Animation"],
    "cartoon":     ["Animation", "Children"],
    "dark":        ["Crime", "Thriller", "Film-Noir"],
    "gritty":      ["Crime", "Thriller"],
    "noir":        ["Film-Noir", "Crime"],
    "funny":       ["Comedy"],
    "laugh":       ["Comedy"],
    "hilarious":   ["Comedy"],
    "romantic":    ["Romance"],
    "love story":  ["Romance", "Drama"],
    "scary":       ["Horror"],
    "spooky":      ["Horror", "Thriller"],
    "suspense":    ["Thriller", "Mystery"],
    "whodunit":    ["Mystery", "Crime"],
    "space":       ["Sci-Fi"],
    "future":      ["Sci-Fi"],
    "robot":       ["Sci-Fi"],
    "alien":       ["Sci-Fi"],
    "cowboy":      ["Western"],
    "true story":  ["Documentary", "Drama"],
    "family":      ["Children", "Animation", "Comedy"],
    "magic":       ["Fantasy"],
    "historical":  ["Drama", "War"],
    "feel good":   ["Comedy", "Romance"],
    "tearjerker":  ["Drama", "Romance"],
    "crime":       ["Crime", "Thriller"],
    "war film":    ["War"],
    "war movie":   ["War"],
    "documentary": ["Documentary"],
    "doc":         ["Documentary"],
    "musical":     ["Musical"],
}

DIRECT_GENRES = [
    "Action", "Adventure", "Animation", "Children", "Comedy", "Crime",
    "Documentary", "Drama", "Fantasy", "Film-Noir", "Horror", "IMAX",
    "Musical", "Mystery", "Romance", "Sci-Fi", "Thriller", "War", "Western"
]

ALLOWED_GENRES = set(DIRECT_GENRES)

TITLE_KEYWORDS_MAP: dict[str, list[str]] = {
    "superhero": [
        "spider-man", "batman", "superman", "avengers", "x-men",
        "iron man", "hulk", "thor", "captain america", "deadpool",
        "black panther", "aquaman", "wonder woman", "justice league",
        "guardians of the galaxy", "ant-man",
    ],
    "anime": [
        "spirited away", "princess mononoke", "akira", "ghost in the shell",
        "howl's moving castle", "my neighbor totoro",
        "grave of the fireflies", "perfect blue", "paprika",
    ],
    "kung fu": [
        "kung fu", "martial arts", "shaolin", "bruce lee", "jackie chan",
        "jet li", "enter the dragon", "drunken master", "crouching tiger",
        "ip man",
    ],
}


# ── GET /api/users/{user_id}/favorites ────────────────────────────────────────

@router.get("/api/users/{user_id}/favorites")
def get_user_favorites(
    user_id: int = Path(..., gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    rows = db.execute(
        text("""
            SELECT m.movie_id, m.title, m.genres, m.tmdb_id, r.rating
            FROM movies m
            JOIN ratings r ON m.movie_id = r.movie_id
            WHERE r.user_id = :uid AND r.rating >= 4.0
            ORDER BY r.rating DESC
        """),
        {"uid": user_id}
    ).fetchall()
    return [
        {
            "movie_id": r.movie_id,
            "title":    r.title,
            "genres":   r.genres.split("|") if r.genres else [],
            "tmdb_id":  r.tmdb_id,
            "rating":   float(r.rating),
        }
        for r in rows
    ]


# ── GET /api/search ────────────────────────────────────────────────────────────

@router.get("/api/search")
def semantic_search(
    q: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db)
):
    # Step 1: Title keyword match
    title_rows = db.execute(
        text("""
            SELECT movie_id, title, genres, tmdb_id
            FROM movies WHERE LOWER(title) LIKE LOWER(:pattern) LIMIT :limit
        """),
        {"pattern": f"%{q}%", "limit": limit}
    ).fetchall()
    if title_rows:
        return {
            "query": q, "search_type": "title_match",
            "movies": [
                {
                    "movie_id":   r.movie_id, "title": r.title,
                    "genres":     r.genres.split("|") if r.genres else [],
                    "tmdb_id":    r.tmdb_id, "match_score": 100,
                    "reason":     f"Title match for '{q}'"
                }
                for r in title_rows
            ]
        }

    # Step 2: Genre/mood match
    query_lower = q.lower()
    matched_genres: list[str] = []
    for keyword, genres in MOOD_MAP.items():
        if keyword in query_lower:
            for g in genres:
                if g not in matched_genres:
                    matched_genres.append(g)
    for genre in DIRECT_GENRES:
        if genre.lower() in query_lower and genre not in matched_genres:
            matched_genres.append(genre)

    if matched_genres:
        conditions = " AND ".join([f"genres ILIKE '%{g}%'" for g in matched_genres])
        genre_rows = db.execute(
            text(f"""
                SELECT m.movie_id, m.title, m.genres, m.tmdb_id,
                       COUNT(r.rating) * AVG(r.rating) AS quality_score
                FROM movies m
                LEFT JOIN ratings r ON m.movie_id = r.movie_id
                WHERE {conditions}
                GROUP BY m.movie_id, m.title, m.genres, m.tmdb_id
                ORDER BY quality_score DESC NULLS LAST
                LIMIT :limit
            """),
            {"limit": limit}
        ).fetchall()
        if genre_rows:
            return {
                "query": q, "search_type": "genre_match",
                "matched_genres": matched_genres,
                "movies": [
                    {
                        "movie_id":   r.movie_id, "title": r.title,
                        "genres":     r.genres.split("|") if r.genres else [],
                        "tmdb_id":    r.tmdb_id, "match_score": 95,
                        "reason":     f"Best rated {' & '.join(matched_genres)} movies"
                    }
                    for r in genre_rows
                ]
            }

    # Step 3: Fallback to top-rated
    fallback_rows = db.execute(
        text("""
            SELECT m.movie_id, m.title, m.genres, m.tmdb_id,
                   COUNT(r.rating) * AVG(r.rating) AS quality_score
            FROM movies m
            LEFT JOIN ratings r ON m.movie_id = r.movie_id
            GROUP BY m.movie_id, m.title, m.genres, m.tmdb_id
            ORDER BY quality_score DESC NULLS LAST
            LIMIT :limit
        """),
        {"limit": limit}
    ).fetchall()
    return {
        "query": q, "search_type": "fallback_top_rated",
        "movies": [
            {
                "movie_id": r.movie_id, "title": r.title,
                "genres":   r.genres.split("|") if r.genres else [],
                "tmdb_id":  r.tmdb_id, "match_score": 70,
                "reason":   f"No exact match found for '{q}' — showing top rated movies"
            }
            for r in fallback_rows
        ]
    }


# ── GET /api/trending ──────────────────────────────────────────────────────────

@router.get("/api/trending")
def get_trending(
    mode: str = Query("combined", pattern="^(count|mean|combined)$"),
    limit: int = Query(10, ge=1, le=50),
    category: str = None,
    db: Session = Depends(get_db)
):
    resolved_genres: list[str] = []
    resolved_title_keywords: list[str] = []
    row_title = "Trending Now"

    if category:
        cat_lower = category.strip().lower()
        for keyword, titles in TITLE_KEYWORDS_MAP.items():
            if keyword in cat_lower:
                resolved_title_keywords = titles
                row_title = f"Trending in {category.title()}"
                break
        if not resolved_title_keywords:
            for keyword, genres in MOOD_MAP.items():
                if keyword in cat_lower:
                    for g in genres:
                        if g not in resolved_genres:
                            resolved_genres.append(g)
            for genre in DIRECT_GENRES:
                if genre.lower() in cat_lower and genre not in resolved_genres:
                    resolved_genres.append(genre)
            if not resolved_genres:
                resolved_genres = [category]
            row_title = f"Trending in {category.title()}"

    # NOTE: `max_ts.max_ts` is used in the decay function, so we must CROSS JOIN
    # the max timestamp subquery to define `max_ts` in SQL.
    sql_query = """
        SELECT m.movie_id, m.title, m.genres, m.tmdb_id,
               SUM(r.rating * EXP(-0.03 * (max_ts.max_ts - r.timestamp) / 86400.0)) AS trending_score
        FROM movies m
        JOIN ratings r ON m.movie_id = r.movie_id
        CROSS JOIN (SELECT MAX(timestamp) AS max_ts FROM ratings) max_ts
    """
    params: dict = {"limit": limit}

    if resolved_title_keywords:
        title_conditions = " OR ".join(
            f"LOWER(m.title) ILIKE :tk_{i}" for i in range(len(resolved_title_keywords))
        )
        sql_query += f" WHERE ({title_conditions})"
        for i, kw in enumerate(resolved_title_keywords):
            params[f"tk_{i}"] = f"%{kw}%"
    elif resolved_genres:
        genre_conditions = " AND ".join(
            f"m.genres ILIKE :genre_{i}" for i in range(len(resolved_genres))
        )
        sql_query += f" WHERE ({genre_conditions})"
        for i, genre in enumerate(resolved_genres):
            params[f"genre_{i}"] = f"%{genre}%"

    sql_query += " GROUP BY m.movie_id, m.title, m.genres, m.tmdb_id ORDER BY trending_score DESC LIMIT :limit"

    rows = db.execute(text(sql_query), params).fetchall()

    # UI contract: `MovieRow` expects `match_score` (0–100) for the badge.
    # This endpoint returns `trending_score`, so we normalize it into a
    # percentage-like value for consistent rendering.
    scores: list[float] = []
    for r in rows:
        if r.trending_score is None:
            continue
        scores.append(float(r.trending_score))

    min_score = min(scores) if scores else 0.0
    max_score = max(scores) if scores else 0.0
    range_score = max(max_score - min_score, 0.0001)

    def normalize_to_match_score(trending_score: float | None) -> int:
        if trending_score is None:
            return 0
        # Map into [55, 95] so it visually matches the other UI rows.
        raw = 55 + ((trending_score - min_score) / range_score) * 40
        val = int(round(raw))
        if val < 0:
            return 0
        if val > 100:
            return 100
        return val

    return {
        "row_title": row_title,
        "movies": [
            {
                "movie_id": r.movie_id,
                "title": r.title,
                "genres": r.genres.split("|") if r.genres else [],
                "tmdb_id": r.tmdb_id,
                "trending_score": round(float(r.trending_score), 2) if r.trending_score is not None else 0.0,
                "match_score": normalize_to_match_score(float(r.trending_score) if r.trending_score is not None else None),
            }
            for r in rows
        ],
    }


# ── GET /api/recommendations/top-picks ────────────────────────────────────────

@router.get("/api/recommendations/top-picks")
def get_top_picks(
    limit: int = Query(10, ge=1, le=50),
    alpha: float = Query(0.7, ge=0.0, le=1.0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    user_id = current_user.id
    svd = ml_artifacts.get("svd_model")
    if not svd:
        raise HTTPException(status_code=503, detail="Service temporarily unavailable.")

    profile_rows = db.execute(
        text("""
            SELECT m.genres, m.embedding
            FROM ratings r JOIN movies m USING (movie_id)
            WHERE r.user_id = :uid AND r.rating >= 4.0
            ORDER BY r.rating DESC LIMIT 30
        """),
        {"uid": user_id}
    ).fetchall()

    genre_freq: dict = {}
    embeddings_for_centroid = []
    for pr in profile_rows:
        for g in (pr.genres or "").split("|"):
            g = g.strip()
            if g and g != "(no genres listed)":
                genre_freq[g] = genre_freq.get(g, 0) + 1
        if pr.embedding:
            embeddings_for_centroid.append(np.array(json.loads(pr.embedding)))

    top_genres = sorted(genre_freq, key=genre_freq.get, reverse=True)[:3] if genre_freq else ["Drama"]

    if embeddings_for_centroid:
        centroid = np.mean(embeddings_for_centroid, axis=0)
        centroid_str = "[" + ",".join(map(str, centroid)) + "]"
        has_centroid = True
    else:
        centroid_str = None
        has_centroid = False

    SERENDIPITY_SLOTS = 2
    genre_slots = limit - SERENDIPITY_SLOTS
    total_freq = sum(genre_freq.get(g, 1) for g in top_genres) or 1
    raw_slots = [round(genre_slots * genre_freq.get(g, 1) / total_freq) for g in top_genres]
    diff = genre_slots - sum(raw_slots)
    raw_slots[0] += diff
    genre_slot_map = {g: max(s, 1) for g, s in zip(top_genres, raw_slots)}

    already_used: set = set()
    genre_picks = []

    for genre, n_slots in genre_slot_map.items():
        pool_size = n_slots * 3
        if has_centroid:
            g_rows = db.execute(
                text("""
                    SELECT m.movie_id, m.title, m.genres, m.tmdb_id,
                           (1 - (m.embedding <=> :centroid)) * 0.6
                           + (AVG(r.rating) / 5.0) * 0.4 AS content_score
                    FROM movies m
                    LEFT JOIN ratings r ON m.movie_id = r.movie_id
                    WHERE m.genres ILIKE :genre_pat
                      AND m.movie_id NOT IN (SELECT movie_id FROM ratings WHERE user_id = :uid)
                    GROUP BY m.movie_id, m.title, m.genres, m.tmdb_id, m.embedding
                    HAVING COUNT(r.rating) > 5
                    ORDER BY content_score DESC NULLS LAST
                    LIMIT :pool_size
                """),
                {"genre_pat": f"%{genre}%", "uid": user_id, "centroid": centroid_str, "pool_size": pool_size}
            ).fetchall()
        else:
            g_rows = db.execute(
                text("""
                    SELECT m.movie_id, m.title, m.genres, m.tmdb_id,
                           (AVG(r.rating) / 5.0) AS content_score
                    FROM movies m
                    LEFT JOIN ratings r ON m.movie_id = r.movie_id
                    WHERE m.genres ILIKE :genre_pat
                      AND m.movie_id NOT IN (SELECT movie_id FROM ratings WHERE user_id = :uid)
                    GROUP BY m.movie_id, m.title, m.genres, m.tmdb_id
                    HAVING COUNT(r.rating) > 5
                    ORDER BY content_score DESC NULLS LAST
                    LIMIT :pool_size
                """),
                {"genre_pat": f"%{genre}%", "uid": user_id, "pool_size": pool_size}
            ).fetchall()

        scored_bucket = []
        for gr in g_rows:
            if gr.movie_id in already_used:
                continue
            try:
                collab_score = svd.predict(user_id, gr.movie_id).est / 5.0
            except Exception:
                collab_score = 0.5
            content_score = float(getattr(gr, "content_score", 0.5))
            # Vary the reason based on which signal dominated the hybrid score
            if collab_score >= content_score:
                reason = f"Viewers with a taste similar to yours in {genre} also loved this."
                recommendation_type = "collab_dominant"
            else:
                reason = f"Closely matches the {genre} movies you've already rated highly."
                recommendation_type = "content_dominant"
            final_score = (alpha * collab_score) + ((1 - alpha) * content_score)
            scored_bucket.append({
                "movie_id": gr.movie_id, "title": gr.title,
                "genres":   gr.genres.split("|") if gr.genres else [],
                "tmdb_id":  gr.tmdb_id,
                "match_score": min(int(final_score * 100), 100),
                "reason":   reason,
                "is_serendipity": False,
                "recommendation_type": recommendation_type,

            })

        scored_bucket.sort(key=lambda x: x["match_score"], reverse=True)
        picks = scored_bucket[:n_slots]
        genre_picks.extend(picks)
        already_used.update(p["movie_id"] for p in picks)

    # Serendipity
    safe_top_genres = [g for g in top_genres if g in ALLOWED_GENRES]
    if safe_top_genres:
        excl_parts = " AND ".join(f"m.genres NOT ILIKE :excl_genre_{i}" for i in range(len(safe_top_genres)))
        excl_params = {f"excl_genre_{i}": f"%{g}%" for i, g in enumerate(safe_top_genres)}
        excl_clause = f"AND ({excl_parts})"
    else:
        excl_params = {}
        excl_clause = ""

    s_movies = db.execute(
        text(f"""
            SELECT m.movie_id, m.title, m.genres, m.tmdb_id
            FROM movies m
            JOIN ratings r ON m.movie_id = r.movie_id
            WHERE m.movie_id NOT IN (SELECT movie_id FROM ratings WHERE user_id = :uid)
              {excl_clause}
            GROUP BY m.movie_id, m.title, m.genres, m.tmdb_id
            HAVING AVG(r.rating) >= 4.0 AND COUNT(r.rating) > 50
            ORDER BY RANDOM() LIMIT 6
        """),
        {"uid": user_id, **excl_params}
    ).fetchall()

    serendipity_picks = []
    for sm in s_movies:
        if sm.movie_id not in already_used and len(serendipity_picks) < SERENDIPITY_SLOTS:
            serendipity_picks.append({
                "movie_id": sm.movie_id, "title": sm.title,
                "genres":   sm.genres.split("|") if sm.genres else [],
                "tmdb_id":  sm.tmdb_id,
                "match_score": random.randint(78, 90),
                "reason":   "✨ Broaden your horizons! Outside your usual zone, but critically acclaimed.",
                "is_serendipity": True,
                "recommendation_type": "serendipity",
            })

    final = sorted(genre_picks + serendipity_picks, key=lambda x: x["match_score"], reverse=True)[:limit]
    return {"row_title": "Top Picks for You", "movies": final}


# ── GET /api/recommendations/because-you-liked ────────────────────────────────

@router.get("/api/recommendations/because-you-liked")
def get_because_you_liked(
    movie_id: int = Query(..., gt=0),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db)
):
    anchor = db.execute(
        text("SELECT title, embedding FROM movies WHERE movie_id = :mid"),
        {"mid": movie_id}
    ).fetchone()
    if not anchor:
        raise HTTPException(status_code=404, detail="Movie not found.")

    anchor_full = db.execute(
        text("SELECT genres FROM movies WHERE movie_id = :mid"), {"mid": movie_id}
    ).fetchone()
    anchor_genre_set = set((anchor_full.genres or "").split("|")) if anchor_full else set()

    rows = db.execute(
        text("""
            SELECT m.movie_id, m.title, m.genres, m.tmdb_id,
                   (1 - (m.embedding <=> :anchor_embedding)) * 0.6
                   + (AVG(r.rating) / 5.0) * 0.4 AS blended_score
            FROM movies m
            JOIN ratings r ON m.movie_id = r.movie_id
            WHERE m.movie_id != :mid
            GROUP BY m.movie_id, m.title, m.genres, m.tmdb_id, m.embedding
            HAVING COUNT(r.rating) > 0
            ORDER BY blended_score DESC
            LIMIT :limit
        """),
        {"anchor_embedding": anchor.embedding, "mid": movie_id, "limit": limit}
    ).fetchall()

    max_score = float(rows[0].blended_score) if rows else 1.0
    min_score = float(rows[-1].blended_score) if rows else 0.0
    score_range = max(max_score - min_score, 0.001)

    results = []
    for row in rows:
        row_genres = set((row.genres or "").split("|"))
        shared = (row_genres & anchor_genre_set) - {"(no genres listed)"}
        reason = (
            f"Shares {', '.join(sorted(shared))} themes with {anchor.title}."
            if shared else f"Similar content DNA to {anchor.title}."
        )
        normalised = int(55 + ((float(row.blended_score) - min_score) / score_range) * 40)
        results.append({
            "movie_id": row.movie_id, "title": row.title,
            "genres":   row.genres.split("|") if row.genres else [],
            "tmdb_id":  row.tmdb_id,
            "match_score": min(normalised, 95),
            "reason":   reason,
        })

    return {"row_title": f"Because you liked {anchor.title}", "anchor_movie_id": movie_id, "movies": results}


# ── GET /api/recommendations/merge ────────────────────────────────────────────

@router.get("/api/recommendations/merge")
def merge_recommendations(
    friend_id: int = Query(..., gt=0, description="User ID of the friend to merge taste with"),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    svd = ml_artifacts.get("svd_model")
    if not svd:
        raise HTTPException(status_code=503, detail="Recommendation service temporarily unavailable.")

    user_a = current_user.id
    user_b = friend_id

    def get_top_genres(uid: int) -> list[str]:
        rows = db.execute(
            text("""
                SELECT m.genres FROM ratings r
                JOIN movies m ON r.movie_id = m.movie_id
                WHERE r.user_id = :uid AND r.rating >= 4.0
            """),
            {"uid": uid}
        ).fetchall()
        freq: dict = {}
        for row in rows:
            for g in (row.genres or "").split("|"):
                g = g.strip()
                if g and g != "(no genres listed)":
                    freq[g] = freq.get(g, 0) + 1
        return sorted(freq, key=freq.get, reverse=True)[:3] if freq else ["Drama"]

    genres_a = get_top_genres(user_a)
    genres_b = get_top_genres(user_b)
    joint_genres = list(dict.fromkeys(genres_a + genres_b))[:5]

    genre_conditions = " OR ".join(f"m.genres ILIKE :g{i}" for i in range(len(joint_genres)))
    params = {f"g{i}": f"%{g}%" for i, g in enumerate(joint_genres)}
    params["uid_a"] = user_a
    params["uid_b"] = user_b
    params["limit"] = limit * 5

    candidate_rows = db.execute(
        text(f"""
            SELECT m.movie_id, m.title, m.genres, m.tmdb_id
            FROM movies m
            WHERE ({genre_conditions})
              AND m.movie_id NOT IN (SELECT movie_id FROM ratings WHERE user_id = :uid_a)
              AND m.movie_id NOT IN (SELECT movie_id FROM ratings WHERE user_id = :uid_b)
            LIMIT :limit
        """),
        params
    ).fetchall()

    scored = []
    for row in candidate_rows:
        try:
            score_a = svd.predict(user_a, row.movie_id).est / 5.0
            score_b = svd.predict(user_b, row.movie_id).est / 5.0
            final_score = 0.5 * score_a + 0.5 * score_b
        except Exception:
            continue
        row_genres = set((row.genres or "").split("|"))
        shared = row_genres & set(genres_a) & set(genres_b) - {"(no genres listed)"}
        reason = (
            f"Both of you love {', '.join(sorted(shared))}!" if shared
            else "Great pick for your combined taste!"
        )
        scored.append({
            "movie_id":    row.movie_id, "title": row.title,
            "genres":      row.genres.split("|") if row.genres else [],
            "tmdb_id":     row.tmdb_id,
            "match_score": min(int(final_score * 100), 100),
            "reason":      reason,
        })

    scored.sort(key=lambda x: x["match_score"], reverse=True)
    return {
        "row_title":       f"Perfect for Movie Night Together",
        "user_a":          user_a,
        "user_b":          user_b,
        "shared_genres":   list(set(genres_a) & set(genres_b)),
        "movies":          scored[:limit],
    }


# ── GET /api/recommendations/group ────────────────────────────────────────────

@router.get("/api/recommendations/group",
            summary="Group recommendations using Least Misery strategy")
def get_group_recommendations(
    user_ids: str = Query(...,
                          description="Comma-separated user IDs (min 2), caller must be included"),
    limit: int = Query(20, ge=1, le=50),
    pool_size: int = Query(500, ge=100, le=3000),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Group recommendations using **least misery**: for each candidate movie the
    group score is the *minimum* SVD predicted rating across all members — so one
    strong dislike caps the whole group.

    Returns the top `limit` movies by `group_score` descending.
    Candidates are movies none of the group has rated yet with ≥ 10 community ratings.
    """
    svd = ml_artifacts.get("svd_model")
    if not svd:
        raise HTTPException(status_code=503, detail="Service temporarily unavailable.")

    raw = [x.strip() for x in user_ids.split(",") if x.strip()]
    try:
        group_ids = sorted(set(int(x) for x in raw))
    except ValueError:
        raise HTTPException(status_code=400, detail="user_ids must be comma-separated integers.")

    if len(group_ids) < 2:
        raise HTTPException(status_code=400, detail="Provide at least two distinct user_ids for a group.")

    if current_user.id not in group_ids:
        raise HTTPException(status_code=403, detail="You must include your own user id in user_ids.")

    for uid in group_ids:
        row = db.execute(
            text("SELECT id FROM users WHERE id = :id AND is_active = TRUE"),
            {"id": uid},
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"User {uid} not found or inactive.")

    in_parts = ", ".join(f":gid_{i}" for i in range(len(group_ids)))
    exclusion_params = {f"gid_{i}": uid for i, uid in enumerate(group_ids)}

    candidate_sql = f"""
        SELECT m.movie_id, m.title, m.genres, m.tmdb_id
        FROM movies m
        JOIN ratings r ON m.movie_id = r.movie_id
        WHERE m.movie_id NOT IN (
            SELECT DISTINCT movie_id FROM ratings WHERE user_id IN ({in_parts})
        )
        GROUP BY m.movie_id, m.title, m.genres, m.tmdb_id
        HAVING COUNT(r.rating) >= 10
        ORDER BY AVG(r.rating) DESC, COUNT(r.rating) DESC
        LIMIT :pool_size
    """
    c_rows = db.execute(
        text(candidate_sql),
        {**exclusion_params, "pool_size": pool_size},
    ).fetchall()

    scored = []
    for cr in c_rows:
        preds: list[float] = []
        member_preds: dict[str, float] = {}
        for uid in group_ids:
            try:
                est = float(svd.predict(uid, cr.movie_id).est)
            except Exception:
                est = 2.5
            preds.append(est)
            member_preds[str(uid)] = round(est, 2)

        group_score = min(preds) if preds else 0.0
        scored.append({
            "movie_id":          cr.movie_id,
            "title":             cr.title,
            "genres":            cr.genres.split("|") if cr.genres else [],
            "tmdb_id":           cr.tmdb_id,
            "group_score":       round(group_score, 2),
            "member_predictions": member_preds,
            "strategy":          "least_misery",
            "reason": (
                f"Least misery: min predicted rating across the group is "
                f"{round(group_score, 2)}/5 — no one is predicted below this."
            ),
        })

    scored.sort(key=lambda x: x["group_score"], reverse=True)

    return {
        "strategy": "least_misery",
        "user_ids": group_ids,
        "limit":    limit,
        "movies":   scored[:limit],
    }
    # ── GET /api/trending/by-genre ───────────────────────────────────────────────
@router.get("/api/trending/by-genre", summary="Trending movies grouped by liked genres")
def get_trending_by_genre(
    max_genres: int = Query(6, ge=1, le=19),
    limit: int = Query(8, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Trending movies grouped by genre, personalized by the current user's "liked" history.

    Response shape must match `frontend/lib/api.ts`:
      {
        user_id, max_genres, limit,
        genre_groups: [{ genre, rank, liked_count, movies: [...] }]
      }
    """
    # 1) User genre like counts (ratings >= 4.0)
    user_genre_rows = db.execute(
        text(
            """
            SELECT genre, COUNT(*) AS liked_count
            FROM (
                SELECT unnest(string_to_array(m.genres, '|')) AS genre
                FROM ratings r
                JOIN movies m ON m.movie_id = r.movie_id
                WHERE r.user_id = :uid
                  AND r.rating >= 4.0
                  AND m.genres IS NOT NULL
            ) x
            WHERE genre IS NOT NULL
              AND genre <> '(no genres listed)'
            GROUP BY genre
            ORDER BY liked_count DESC
            LIMIT :genre_limit
            """
        ),
        {"uid": current_user.id, "genre_limit": max_genres * 2},
    ).fetchall()

    ordered_user_genres: list[tuple[str, int]] = [
        (row.genre, int(row.liked_count)) for row in user_genre_rows
    ]
    filtered_user_genres = [(g, c) for g, c in ordered_user_genres if g in DIRECT_GENRES]

    # 2) Fallback when user has no likes
    if not filtered_user_genres:
        global_genre_rows = db.execute(
            text(
                """
                SELECT genre, COUNT(*) AS liked_count
                FROM (
                    SELECT unnest(string_to_array(m.genres, '|')) AS genre
                    FROM ratings r
                    JOIN movies m ON m.movie_id = r.movie_id
                    WHERE r.rating >= 4.0
                      AND m.genres IS NOT NULL
                ) x
                WHERE genre IS NOT NULL
                  AND genre <> '(no genres listed)'
                GROUP BY genre
                ORDER BY liked_count DESC
                LIMIT :genre_limit
                """
            ),
            {"genre_limit": max_genres},
        ).fetchall()

        filtered_user_genres = [
            (row.genre, int(row.liked_count))
            for row in global_genre_rows
            if row.genre in DIRECT_GENRES
        ]

    # Always return exactly `max_genres` buckets.
    genre_to_liked_count: dict[str, int] = {g: c for g, c in filtered_user_genres}
    ordered_genres: list[str] = [g for g, _ in filtered_user_genres]

    for g in DIRECT_GENRES:
        if len(ordered_genres) >= max_genres:
            break
        if g not in genre_to_liked_count:
            genre_to_liked_count[g] = 0
            ordered_genres.append(g)

    ordered_genres = ordered_genres[:max_genres]

    # 3) Trending movies per genre
    genre_groups: list[dict] = []
    for idx, genre in enumerate(ordered_genres, start=1):
        rows = db.execute(
            text(
                """
                WITH max_time AS (
                    SELECT MAX(timestamp) AS max_ts FROM ratings
                )
                SELECT m.movie_id,
                       m.title,
                       m.genres,
                       m.tmdb_id,
                       SUM(
                           r.rating * EXP(
                               -0.03 * (mt.max_ts - r.timestamp) / 86400.0
                           )
                       ) AS trending_score
                FROM movies m
                JOIN ratings r ON m.movie_id = r.movie_id
                CROSS JOIN max_time mt
                WHERE m.genres ILIKE :genre_pat
                GROUP BY m.movie_id, m.title, m.genres, m.tmdb_id
                ORDER BY trending_score DESC
                LIMIT :limit
                """
            ),
            {"genre_pat": f"%{genre}%", "limit": limit},
        ).fetchall()

        genre_groups.append(
            {
                "genre": genre,
                "rank": idx,
                "liked_count": genre_to_liked_count.get(genre, 0),
                "movies": [
                    {
                        "movie_id": row.movie_id,
                        "title": row.title,
                        "genres": row.genres.split("|") if row.genres else [],
                        "tmdb_id": row.tmdb_id,
                        "trending_score": round(float(row.trending_score), 2),
                    }
                    for row in rows
                ],
            }
        )

    return {
        "user_id": int(current_user.id),
        "max_genres": max_genres,
        "limit": limit,
        "genre_groups": genre_groups,
    }

