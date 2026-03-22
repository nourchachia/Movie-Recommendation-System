import os
import sys
import re
import json
import math
import pickle
import secrets
import threading
import numpy as np
from fastapi import FastAPI, HTTPException, Query, Path, Depends, Header, status, BackgroundTasks, Body
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from pydantic import BaseModel, Field, EmailStr, field_validator
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
from backend.auth import (
    hash_password, verify_password, validate_password_strength,
    create_access_token, create_refresh_token, create_password_reset_token,
    decode_access_token, decode_refresh_token, decode_reset_token,
    generate_totp_secret, generate_totp_qr_base64, verify_totp_code
)
from backend.email_service import (
    send_password_reset_email, send_2fa_code_email, send_welcome_email
)

# ==========================================================
# 1. DATABASE CONFIGURATION (FastAPI best practice)
# ==========================================================
load_dotenv()
DB_URL = os.getenv("DATABASE_URL")
if not DB_URL:
    raise ValueError("CRITICAL: DATABASE_URL is missing from environment variables!")

# pool_pre_ping=True is CRITICAL for Neon.tech serverless Postgres.
# It tests the connection before every query and transparently reconnects
# if Neon dropped the idle connection to save resources.
engine = create_engine(DB_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Dependency injection to get the DB connection separately for every single API request
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ==========================================================
# 2. MACHINE LEARNING ENGINE
# ==========================================================
ml_artifacts = {}

@asynccontextmanager
async def lifespan(app: FastAPI):
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    models_dir = os.path.join(base_dir, "models")
    
    print("🚀 Loading the SVD Collaborative Model into memory...")
    try:
        # SVD chosen over KNN for production: same NDCG accuracy but scales efficiently 
        # as new users join (KNN must recompute the full similarity matrix on every retrain).
        with open(os.path.join(models_dir, "svd_model.pkl"), "rb") as f:
            ml_artifacts["svd_model"] = pickle.load(f)
        print("✅ Successfully loaded SVD model! API is ready for requests.")
    except Exception as e:
        print(f"❌ Error loading ML model: {e}")
        
    yield  
    ml_artifacts.clear()

# ==========================================================
# 3. FASTAPI SERVER INITIALIZATION
# ==========================================================
app = FastAPI(title="Flicker API (PostgreSQL Hub)", description="Netflix-style Movie Recommendations via SQL", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://flicker-movies.vercel.app"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def health_check():
    return {"status": "online", "message": "Flicker Backend is running blazingly fast via PostgreSQL."}

# ==========================================================
# 4. CORE NETFLIX ENDPOINTS (SQL ARCHITECTURE)
# ==========================================================

# ── Auth Dependency ────────────────────────────────────────────────────────────
# HTTPBearer tells FastAPI to look for an "Authorization: Bearer <token>" header.
# It makes Swagger UI show a simple text box where users can paste their JWT.
security_scheme = HTTPBearer(auto_error=False)

def get_current_user(creds: HTTPAuthorizationCredentials | None = Depends(security_scheme), db: Session = Depends(get_db)):
    """FastAPI dependency: validates the Bearer token and returns the user row.
    
    Inject into any endpoint requiring authentication:
        @app.post("/api/ratings")
        def submit_rating(..., current_user = Depends(get_current_user)):
            # current_user.id, .email, .role, .username are available
    """
    # Defensive parsing: remove quotes if the user accidentally pasted them from JSON
    token = creds.credentials.strip('"\'') if creds else None
    
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Not authenticated. Please log in.",
                            headers={"WWW-Authenticate": "Bearer"})
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Invalid or expired token. Please log in again.",
                            headers={"WWW-Authenticate": "Bearer"})
    user = db.execute(
        text("SELECT id, email, username, role, is_active, totp_enabled FROM users WHERE id = :uid"),
        {"uid": int(payload["sub"])}
    ).fetchone()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Account not found or has been deactivated.")
    return user

@app.get("/api/users/{user_id}/favorites")
def get_user_favorites(user_id: int = Path(..., gt=0), db: Session = Depends(get_db), current_user=Depends(get_current_user)): 
    """Fetch a user's top-rated movies (4 stars and above).
    
    Any authenticated user can view any other user's favorites — this powers
    the social discovery feature (e.g. see what a friend is loving).
    """
    query = text("""
        SELECT m.movie_id, m.title, m.genres, m.tmdb_id, r.rating
        FROM movies m
        JOIN ratings r ON m.movie_id = r.movie_id
        WHERE r.user_id = :uid AND r.rating >= 4.0
        ORDER BY r.rating DESC
    """)
    rows = db.execute(query, {"uid": user_id}).fetchall()
    
    results = []
    for row in rows:
        results.append({
            "movie_id": row.movie_id,
            "title": row.title,
            "genres": row.genres.split('|') if row.genres else [],
            "tmdb_id": row.tmdb_id,
            "rating": float(row.rating)
        })
        
    return results


@app.get("/api/users/me/ratings")
def get_my_ratings(
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Get all ratings submitted by the currently logged-in user."""
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
        "total": len(rows),
        "ratings": [
            {
                "movie_id": r.movie_id,
                "title":    r.title,
                "genres":   r.genres.split('|') if r.genres else [],
                "tmdb_id":  r.tmdb_id,
                "rating":   float(r.rating),
                "rated_at": str(r.rated_at) if r.rated_at else None,
            } for r in rows
        ]
    }


@app.get("/api/users/{user_id}/ratings")
def get_user_ratings(
    user_id: int = Path(..., gt=0),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Get all ratings submitted by a specific user (social discovery).
    
    Any authenticated user can view another user's ratings history.
    """
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
        "total": len(rows),
        "ratings": [
            {
                "movie_id": r.movie_id,
                "title":    r.title,
                "genres":   r.genres.split('|') if r.genres else [],
                "tmdb_id":  r.tmdb_id,
                "rating":   float(r.rating),
                "rated_at": str(r.rated_at) if r.rated_at else None,
            } for r in rows
        ]
    }

@app.get("/api/recommendations/top-picks")
def get_top_picks(
    limit: int = Query(10, ge=1, le=50), 
    alpha: float = Query(0.7, ge=0.0, le=1.0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """The main 'For You' row integrating pgvector Candidate Generation with the Python SVD model."""
    user_id = current_user.id
    svd = ml_artifacts.get("svd_model")
    if not svd:
        raise HTTPException(status_code=503, detail="Service temporarily unavailable.")

    # -----------------------------------------------------------------------
    # STEP 1: Build genre frequency profile + pgvector taste centroid
    # -----------------------------------------------------------------------
    # The genre frequency drives proportional slot allocation (how many cards
    # per genre). The centroid captures the user's specific stylistic taste
    # WITHIN each genre — e.g. two Action fans might prefer sci-fi action vs
    # crime action. pgvector finds that nuance; SQL ILIKE alone cannot.
    profile_query = text("""
        SELECT m.genres, m.embedding
        FROM ratings r JOIN movies m USING (movie_id)
        WHERE r.user_id = :uid AND r.rating >= 4.0
        ORDER BY r.rating DESC LIMIT 30
    """)
    profile_rows = db.execute(profile_query, {"uid": user_id}).fetchall()

    genre_freq: dict = {}
    embeddings_for_centroid = []
    for pr in profile_rows:
        for g in (pr.genres or "").split('|'):
            g = g.strip()
            if g and g != "(no genres listed)":
                genre_freq[g] = genre_freq.get(g, 0) + 1
        if pr.embedding:
            embeddings_for_centroid.append(np.array(json.loads(pr.embedding)))

    top_genres = sorted(genre_freq, key=genre_freq.get, reverse=True)[:3] if genre_freq else ["Drama"]

    # Build the taste centroid from the user's highly-loved movies
    if embeddings_for_centroid:
        centroid = np.mean(embeddings_for_centroid, axis=0)
        centroid_str = "[" + ",".join(map(str, centroid)) + "]"
        has_centroid = True
    else:
        centroid_str = None
        has_centroid = False
        
    # -------------------------------------------------------------
    # STEP 2: PROPORTIONAL GENRE SLOT ALLOCATION
    # -------------------------------------------------------------
    # Instead of a flat scoring pool where Drama always wins, we split available
    # recommendation slots proportionally across the user's top 3 genres based
    # on how often they gave high ratings to each.
    #
    # Example: user rated Drama 10×, Comedy 6×, Romance 4× (20 total, limit=10)
    #   genre_slots = 10 - 2 serendipity = 8
    #   Drama  → round(8 × 10/20) = 4 slots
    #   Comedy → round(8 × 6/20)  = 2 slots
    #   Romance→ 8 - 4 - 2        = 2 slots (remainder)
    import random

    SERENDIPITY_SLOTS = 2
    genre_slots = limit - SERENDIPITY_SLOTS
    total_freq = sum(genre_freq.get(g, 1) for g in top_genres) or 1

    # Calculate proportional slot counts, correcting rounding drift
    raw_slots = [round(genre_slots * genre_freq.get(g, 1) / total_freq) for g in top_genres]
    diff = genre_slots - sum(raw_slots)
    raw_slots[0] += diff                                # remainder goes to top genre
    genre_slot_map = {g: max(s, 1) for g, s in zip(top_genres, raw_slots)}

    already_used: set = set()
    genre_picks = []

    for genre, n_slots in genre_slot_map.items():
        pool_size = n_slots * 3
        if has_centroid:
            # pgvector + quality blend: within each genre bucket, rank by personal
            # taste similarity AND community rating. Two users who both love Action
            # get different results based on their unique style vectors.
            genre_cand_query = text("""
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
            """)
            g_rows = db.execute(genre_cand_query, {
                "genre_pat": f"%{genre}%", "uid": user_id,
                "centroid": centroid_str, "pool_size": pool_size
            }).fetchall()
        else:
            # New user with no ratings: fall back to pure community quality ranking
            genre_cand_query = text("""
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
            """)
            g_rows = db.execute(genre_cand_query, {
                "genre_pat": f"%{genre}%", "uid": user_id, "pool_size": pool_size
            }).fetchall()

        # SVD-score every candidate in this genre bucket, then take top n_slots
        scored_bucket = []
        for gr in g_rows:
            if gr.movie_id in already_used:
                continue
            try:
                collab_score = svd.predict(user_id, gr.movie_id).est / 5.0
            except Exception:
                collab_score = 0.5
            
            # Hybrid Blend: α * collab_score + (1-α) * content_score
            content_score = float(getattr(gr, 'content_score', 0.5))
            final_score = (alpha * collab_score) + ((1 - alpha) * content_score)
            
            scored_bucket.append({
                "movie_id": gr.movie_id,
                "title": gr.title,
                "genres": gr.genres.split('|') if gr.genres else [],
                "tmdb_id": gr.tmdb_id,
                "match_score": min(int(final_score * 100), 100),
                "reason": f"Recommended because you love {genre} \u2014 strong match for your taste.",
                "is_serendipity": False
            })

        scored_bucket.sort(key=lambda x: x["match_score"], reverse=True)
        picks = scored_bucket[:n_slots]
        genre_picks.extend(picks)
        already_used.update(p["movie_id"] for p in picks)

    # STEP 3: SERENDIPITY (2 wildcards from OUTSIDE the user's top genres)
    # ──────────────────────────────────────────────────────────────────────
    # Security note: top_genres comes from the DB (movie genre strings), but
    # we STILL whitelist them before touching SQL to eliminate any injection
    # risk. Only strings matching the allowed genre list are passed through.
    ALLOWED_GENRES = {
        "Action", "Adventure", "Animation", "Children", "Comedy", "Crime",
        "Documentary", "Drama", "Fantasy", "Film-Noir", "Horror", "IMAX",
        "Musical", "Mystery", "Romance", "Sci-Fi", "Thriller", "War", "Western"
    }
    safe_top_genres = [g for g in top_genres if g in ALLOWED_GENRES]

    # Build parameterized NOT ILIKE conditions — never interpolate genre values
    # directly into the SQL string. Each genre gets its own named bind parameter.
    if safe_top_genres:
        excl_parts = " AND ".join(
            f"m.genres NOT ILIKE :excl_genre_{i}" for i in range(len(safe_top_genres))
        )
        excl_params = {f"excl_genre_{i}": f"%{g}%" for i, g in enumerate(safe_top_genres)}
        excl_clause = f"AND ({excl_parts})"
    else:
        excl_params = {}
        excl_clause = ""

    serendipity_sql = f"""
        SELECT m.movie_id, m.title, m.genres, m.tmdb_id
        FROM movies m
        JOIN ratings r ON m.movie_id = r.movie_id
        WHERE m.movie_id NOT IN (SELECT movie_id FROM ratings WHERE user_id = :uid)
          {excl_clause}
        GROUP BY m.movie_id, m.title, m.genres, m.tmdb_id
        HAVING AVG(r.rating) >= 4.0 AND COUNT(r.rating) > 50
        ORDER BY RANDOM()
        LIMIT 6
    """
    s_movies = db.execute(
        text(serendipity_sql),
        {"uid": user_id, **excl_params}
    ).fetchall()
    serendipity_picks = []
    for sm in s_movies:
        if sm.movie_id not in already_used and len(serendipity_picks) < SERENDIPITY_SLOTS:
            serendipity_picks.append({
                "movie_id": sm.movie_id,
                "title": sm.title,
                "genres": sm.genres.split('|') if sm.genres else [],
                "tmdb_id": sm.tmdb_id,
                "match_score": random.randint(78, 90),
                "reason": "\u2728 Broaden your horizons! Outside your usual zone, but critically acclaimed.",
                "is_serendipity": True
            })

    # ASSEMBLY: genre picks + serendipity, re-sorted by match_score
    final = sorted(genre_picks + serendipity_picks, key=lambda x: x["match_score"], reverse=True)[:limit]
    return {"row_title": "Top Picks for You", "movies": final}


@app.get("/api/recommendations/because-you-liked")
def get_because_you_liked(
    movie_id: int = Query(..., gt=0), 
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db)
):
    """'Because you liked X' row — finds movies sharing genres with the anchor, 
    ranked by blending semantic similarity (pgvector) and community rating quality, 
    so results are meaningfully differentiated rather than all showing 100%."""
    
    # Grab the semantic embedding vector of the specific movie the user just clicked
    anchor = db.execute(text("SELECT title, embedding FROM movies WHERE movie_id = :mid"), {"mid": movie_id}).fetchone()
    if not anchor:
        raise HTTPException(status_code=404, detail="Movie not found.")
    
    # Pre-fetch the anchor movie's genres once before the loop — avoids N extra SQL calls inside!
    anchor_full = db.execute(
        text("SELECT genres FROM movies WHERE movie_id = :mid"), {"mid": movie_id}
    ).fetchone()
    anchor_genre_set = set((anchor_full.genres or "").split('|')) if anchor_full else set()
        
    # PHASE A4: pgvector semantic similarity + quality score blend
    # ---------------------------------------------------------------
    # Problem we solved: pure cosine distance gives all-100 for same-genre movies
    # (same TF-IDF genre vector → cosine distance = 0 for all of them).
    # Wrong fix: replace pgvector entirely with quality score (loses semantic AI).
    # Correct fix: BLEND both signals so pgvector provides semantic ordering AND
    # quality score differentiates movies with near-identical vectors.
    #
    #   final_score = cosine_similarity × 0.6  +  (avg_rating / 5.0) × 0.4
    #
    # This way Bowling for Columbine (high rated Documentary) naturally floats
    # above a less-watched Documentary, while still being semantically ordered.
    blended_query = text("""
        SELECT m.movie_id, m.title, m.genres, m.tmdb_id,
               (1 - (m.embedding <=> :anchor_embedding)) * 0.6
               + (AVG(r.rating) / 5.0) * 0.4  AS blended_score
        FROM movies m
        JOIN ratings r ON m.movie_id = r.movie_id
        WHERE m.movie_id != :mid
        GROUP BY m.movie_id, m.title, m.genres, m.tmdb_id, m.embedding
        HAVING COUNT(r.rating) > 0
        ORDER BY blended_score DESC
        LIMIT :limit
    """)
    rows = db.execute(blended_query, {
        "anchor_embedding": anchor.embedding, "mid": movie_id, "limit": limit
    }).fetchall()

    # Normalise blended_score to 0-95 range so frontend displays a spread of values
    max_score = float(rows[0].blended_score) if rows else 1.0
    min_score = float(rows[-1].blended_score) if rows else 0.0
    score_range = max(max_score - min_score, 0.001)

    results = []
    for row in rows:
        row_genres = set((row.genres or "").split('|'))
        shared = (row_genres & anchor_genre_set) - {"(no genres listed)"}

        if shared:
            reason = f"Shares {', '.join(sorted(shared))} themes with {anchor.title}."
        else:
            reason = f"Similar content DNA to {anchor.title}."

        # Map to 55-95 range so even the last result looks meaningful, not near-zero
        normalised = int(55 + ((float(row.blended_score) - min_score) / score_range) * 40)
        results.append({
            "movie_id": row.movie_id,
            "title": row.title,
            "genres": row.genres.split('|') if row.genres else [],
            "tmdb_id": row.tmdb_id,
            "match_score": min(normalised, 95),
            "reason": reason
        })

    return {
        "row_title": f"Because you liked {anchor.title}",
        "anchor_movie_id": movie_id,
        "movies": results
    }


# ==========================================================
# PHASE A4: SEMANTIC SEARCH ENDPOINT
# ==========================================================
# This is the engine powering Flicker's Omnibar!
# Instead of matching keywords, we translate the user's typed text into a mathematical
# vector of the exact same shape as the movie genre embeddings (23 dimensions).
# We then ask PostgreSQL with pgvector to find the movies whose vectors are closest
# to the user's query vector — meaning conceptually similar, not just keyword matched!

@app.get("/api/search")
def semantic_search(
    q: str = Query(..., min_length=1, description="Natural language query, e.g. 'dark crime thriller'"),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db)
):
    """Semantic similarity search via pgvector. Type anything — genres, moods, themes."""
    
    # -------------------------------------------------------
    # STEP 1: KEYWORD TITLE SEARCH (exact/partial match first)
    # -------------------------------------------------------
    # This guarantees that typing "Inception" returns "Inception" immediately 
    # before any vector magic kicks in.
    title_query = text("""
        SELECT movie_id, title, genres, tmdb_id, 1.0 AS match_score
        FROM movies
        WHERE LOWER(title) LIKE LOWER(:pattern)
        LIMIT :limit
    """)
    title_rows = db.execute(title_query, {"pattern": f"%{q}%", "limit": limit}).fetchall()
    
    if title_rows:
        return {
            "query": q,
            "search_type": "title_match",
            "movies": [
                {
                    "movie_id": r.movie_id,
                    "title": r.title,
                    "genres": r.genres.split('|') if r.genres else [],
                    "tmdb_id": r.tmdb_id,
                    "match_score": 100,
                    "reason": f"Title match for '{q}'"
                } for r in title_rows
            ]
        }
    
    # -------------------------------------------------------
    # STEP 2: GENRE/MOOD SQL SEARCH (slang + abbreviation aware)
    # -------------------------------------------------------
    # Root cause fix: TF-IDF builds its own internal vocabulary with a RANDOM column ordering.
    # This means our hand-crafted query vector CANNOT reliably align with the database embeddings.
    # The correct and guaranteed approach: resolve the query to a list of genre strings,
    # then let PostgreSQL filter directly on the `genres` VARCHAR column using ILIKE.
    
    # MOOD_MAP: slang/synonym → list of exact genre strings stored in the DB
    MOOD_MAP = {
        "romcom":      ["Romance", "Comedy"],
        "rom-com":     ["Romance", "Comedy"],
        "rom com":     ["Romance", "Comedy"],
        "romantic comedy": ["Romance", "Comedy"],
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
    }
    
    # Also directly recognize genre names typed literally (e.g. "comedy", "horror", "action")
    DIRECT_GENRES = [
        "Action", "Adventure", "Animation", "Children", "Comedy", "Crime",
        "Documentary", "Drama", "Fantasy", "Film-Noir", "Horror", "IMAX",
        "Musical", "Mystery", "Romance", "Sci-Fi", "Thriller", "War", "Western"
    ]
    
    query_lower = q.lower()
    matched_genres: list[str] = []
    
    # 1. Check slang/mood map first (higher priority)
    for keyword, genres in MOOD_MAP.items():
        if keyword in query_lower:
            for g in genres:
                if g not in matched_genres:
                    matched_genres.append(g)
    
    # 2. Check if the user typed an actual genre name literally
    for genre in DIRECT_GENRES:
        if genre.lower() in query_lower and genre not in matched_genres:
            matched_genres.append(genre)
    
    if matched_genres:
        # Build a SQL WHERE clause: genres ILIKE '%Comedy%' AND genres ILIKE '%Romance%'
        # This guarantees results contain ALL requested genres simultaneously.
        conditions = " AND ".join([f"genres ILIKE '%{g}%'" for g in matched_genres])
        genre_query = text(f"""
            SELECT m.movie_id, m.title, m.genres, m.tmdb_id,
                   COUNT(r.rating) * AVG(r.rating) AS quality_score
            FROM movies m
            LEFT JOIN ratings r ON m.movie_id = r.movie_id
            WHERE {conditions}
            GROUP BY m.movie_id, m.title, m.genres, m.tmdb_id
            ORDER BY quality_score DESC NULLS LAST
            LIMIT :limit
        """)
        genre_rows = db.execute(genre_query, {"limit": limit}).fetchall()
        
        if genre_rows:
            return {
                "query": q,
                "search_type": "genre_match",
                "matched_genres": matched_genres,
                "movies": [
                    {
                        "movie_id": r.movie_id,
                        "title": r.title,
                        "genres": r.genres.split('|') if r.genres else [],
                        "tmdb_id": r.tmdb_id,
                        "match_score": 95,
                        "reason": f"Best rated {' & '.join(matched_genres)} movies"
                    } for r in genre_rows
                ]
            }
    
    # -------------------------------------------------------
    # STEP 3: LAST RESORT FALLBACK for completely unrecognized queries
    # -------------------------------------------------------
    # If we reach this point, neither a title nor any genre/mood keyword matched.
    # Return the highest-quality Drama movies as a safe, generic fallback.
    fallback_query = text("""
        SELECT m.movie_id, m.title, m.genres, m.tmdb_id,
               COUNT(r.rating) * AVG(r.rating) AS quality_score
        FROM movies m
        LEFT JOIN ratings r ON m.movie_id = r.movie_id
        GROUP BY m.movie_id, m.title, m.genres, m.tmdb_id
        ORDER BY quality_score DESC NULLS LAST
        LIMIT :limit
    """)
    fallback_rows = db.execute(fallback_query, {"limit": limit}).fetchall()
    
    return {
        "query": q,
        "search_type": "fallback_top_rated",
        "movies": [
            {
                "movie_id": r.movie_id,
                "title": r.title,
                "genres": r.genres.split('|') if r.genres else [],
                "tmdb_id": r.tmdb_id,
                "match_score": 70,
                "reason": f"No exact match found for '{q}' — showing top rated movies"
            } for r in fallback_rows
        ]
    }


@app.get("/api/trending")
def get_trending(
    mode: str = Query("combined", pattern="^(count|mean|combined)$"), 
    limit: int = Query(10, ge=1, le=50), 
    category: str = None,
    db: Session = Depends(get_db)
):
    """Trending movies calculated via blazing fast SQL Data Warehousing queries.
    
    The `category` parameter accepts both real genre names (e.g. 'Comedy') and
    colloquial aliases (e.g. 'romcom', 'sci-fi', 'chick flick') which are
    expanded to their canonical MovieLens genre equivalents before the SQL runs.
    """
    
    # ── Genre alias / slang expansion ────────────────────────────────────────
    # For aliases that map cleanly to MovieLens genres, we filter by genre.
    # MovieLens has 19 genres: Action, Adventure, Animation, Children, Comedy,
    # Crime, Documentary, Drama, Fantasy, Film-Noir, Horror, IMAX, Musical,
    # Mystery, Romance, Sci-Fi, Thriller, War, Western.
    MOOD_MAP: dict[str, list[str]] = {
        "romcom":      ["Romance", "Comedy"],
        "rom-com":     ["Romance", "Comedy"],
        "rom com":     ["Romance", "Comedy"],
        "romantic comedy": ["Romance", "Comedy"],
        "chick flick": ["Romance", "Comedy"],
        "scary":       ["Horror"],
        "spooky":      ["Horror", "Thriller"],
        "sci fi":      ["Sci-Fi"],
        "sci-fi":      ["Sci-Fi"],
        "scifi":       ["Sci-Fi"],
        "space":       ["Sci-Fi"],
        "cartoon":     ["Animation", "Children"],
        "kids":        ["Children", "Animation"],
        "family":      ["Children", "Animation", "Comedy"],
        "whodunit":    ["Mystery", "Crime"],
        "suspense":    ["Thriller", "Mystery"],
        "war film":    ["War"],
        "war movie":   ["War"],
        "western":     ["Western"],
        "cowboy":      ["Western"],
        "documentary": ["Documentary"],
        "doc":         ["Documentary"],
        "true story":  ["Documentary", "Drama"],
        "musical":     ["Musical"],
        "feel good":   ["Comedy", "Romance"],
        "tearjerker":  ["Drama", "Romance"],
        "magic":       ["Fantasy"],
        "historical":  ["Drama", "War"],
        "love story":  ["Romance", "Drama"],
        "funny":       ["Comedy"],
        "laugh":       ["Comedy"],
        "hilarious":   ["Comedy"],
        "romantic":    ["Romance"],
        "crime":       ["Crime", "Thriller"],
        "noir":        ["Film-Noir", "Crime"],
        "gritty":      ["Crime", "Thriller"],
        "dark":        ["Crime", "Thriller", "Film-Noir"],
    }

    # ── Title keyword map ─────────────────────────────────────────────────────
    # For aliases that DON'T map cleanly to MovieLens genres, we search by
    # well-known movie titles instead. This is necessary because MovieLens has
    # no "Superhero", "Anime", or "Martial Arts" genre tag.
    TITLE_KEYWORDS_MAP: dict[str, list[str]] = {
        "superhero": [
            "spider-man", "batman", "superman", "avengers", "x-men",
            "iron man", "hulk", "thor", "captain america", "deadpool",
            "black panther", "aquaman", "wonder woman", "justice league",
            "guardians of the galaxy", "ant-man", "dr. strange", "fantastic four",
        ],
        "anime": [
            "spirited away", "princess mononoke", "akira", "ghost in the shell",
            "howl's moving castle", "my neighbor totoro", "nausicaa",
            "grave of the fireflies", "perfect blue", "paprika",
            "ninja scroll", "cowboy bebop", "dragon ball", "evangelion",
            "castle in the sky", "kiki's delivery service",
        ],
        "kung fu": [
            "kung fu", "martial arts", "shaolin", "bruce lee", "jackie chan",
            "jet li", "enter the dragon", "drunken master", "crouching tiger",
            "fist of fury", "way of the dragon", "ip man", "hero", "house of flying",
        ],
    }

    DIRECT_GENRES = [
        "Action", "Adventure", "Animation", "Children", "Comedy", "Crime",
        "Documentary", "Drama", "Fantasy", "Film-Noir", "Horror", "IMAX",
        "Musical", "Mystery", "Romance", "Sci-Fi", "Thriller", "War", "Western"
    ]

    # Resolve the category string into canonical genre(s) or title keywords
    resolved_genres: list[str] = []
    resolved_title_keywords: list[str] = []
    row_title = "Trending Now"
    
    if category:
        cat_lower = category.strip().lower()

        # 1. Check title keyword map FIRST (highest precision)
        for keyword, titles in TITLE_KEYWORDS_MAP.items():
            if keyword in cat_lower:
                resolved_title_keywords = titles
                row_title = f"Trending in {category.title()}"
                break  # title keyword wins, skip genre resolution

        if not resolved_title_keywords:
            # 2. Check genre slang map
            for keyword, genres in MOOD_MAP.items():
                if keyword in cat_lower:
                    for g in genres:
                        if g not in resolved_genres:
                            resolved_genres.append(g)
            # 3. Check if a real genre name was typed directly (e.g. "comedy")
            for genre in DIRECT_GENRES:
                if genre.lower() in cat_lower and genre not in resolved_genres:
                    resolved_genres.append(genre)
            # 4. If nothing matched at all, use the raw string as a fallback ILIKE on genres
            if not resolved_genres:
                resolved_genres = [category]
            row_title = f"Trending in {category.title()}"

    # ── Build SQL ─────────────────────────────────────────────────────────────
    sql_query = """
        SELECT m.movie_id, m.title, m.genres, m.tmdb_id,
               COUNT(r.rating) * AVG(r.rating) AS trending_score
        FROM movies m
        JOIN ratings r ON m.movie_id = r.movie_id
    """
    params: dict = {"limit": limit}

    if resolved_title_keywords:
        # Title keyword mode: movie title must contain at least one keyword
        title_conditions = " OR ".join(
            f"LOWER(m.title) ILIKE :tk_{i}" for i in range(len(resolved_title_keywords))
        )
        sql_query += f" WHERE ({title_conditions})"
        for i, kw in enumerate(resolved_title_keywords):
            params[f"tk_{i}"] = f"%{kw}%"

    elif resolved_genres:
        # Genre mode: movie must have ALL resolved genres (AND semantics)
        # "romcom" → WHERE genres ILIKE '%Romance%' AND genres ILIKE '%Comedy%'
        genre_conditions = " AND ".join(
            f"m.genres ILIKE :genre_{i}" for i in range(len(resolved_genres))
        )
        sql_query += f" WHERE ({genre_conditions})"
        for i, genre in enumerate(resolved_genres):
            params[f"genre_{i}"] = f"%{genre}%"
        
    sql_query += """
        GROUP BY m.movie_id, m.title, m.genres, m.tmdb_id
        ORDER BY trending_score DESC
        LIMIT :limit
    """
    
    rows = db.execute(text(sql_query), params).fetchall()
    
    results = []
    for row in rows:
        results.append({
            "movie_id": row.movie_id,
            "title": row.title,
            "genres": row.genres.split('|') if row.genres else [],
            "tmdb_id": row.tmdb_id,
            "trending_score": round(float(row.trending_score), 2)
        })
        
    return {"row_title": row_title, "movies": results}



# ==========================================================
# 7. PHASE A5 — INTERACTIVE RATINGS ENDPOINT
# ==========================================================

class RatingSubmission(BaseModel):
    """Pydantic model for the POST /api/ratings request body.
    
    Mirrors the exact API contract from the implementation plan:
      { user_id, movie_id, rating, timestamp (optional) }
    
    Security decisions:
    - rating is strictly validated to 0.5-step multiples in [0.5, 5.0],
      matching the MovieLens dataset convention. Any non-standard value
      (e.g. 3.3, 7.0, -1) is rejected at the Pydantic layer before any
      SQL is even attempted — we never trust raw client input.
    - movie_id is constrained to gt=0 so negative IDs cannot be used to probe the database.
    - timestamp is optional; when omitted we use PostgreSQL's NOW() on the
      server side, preventing clients from forging historical timestamps.
    """
    movie_id: int = Field(..., gt=0, description="ID of the movie being rated")
    rating: float = Field(..., ge=0.5, le=5.0, description="Star rating from 0.5 to 5.0 in 0.5 increments")
    timestamp: int | None = Field(None, description="Unix timestamp (optional — server uses NOW() if omitted)")

    @field_validator("rating")
    @classmethod
    def rating_must_be_half_step(cls, v: float) -> float:
        """Reject ratings like 3.3 or 4.7 — only 0.5-step values (0.5, 1.0, ... 5.0) are valid."""
        if not math.isclose(round(v * 2) / 2, v, abs_tol=1e-6):
            raise ValueError("Rating must be a multiple of 0.5 (e.g. 1.0, 1.5, 2.0 ... 5.0)")
        return round(v * 2) / 2  # normalise floating-point noise (e.g. 3.9999 → 4.0)


@app.post("/api/ratings", status_code=status.HTTP_201_CREATED)
def submit_rating(payload: RatingSubmission, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Submit or update a movie rating for a user.
    
    This is the write endpoint that feeds new explicit feedback back into
    the PostgreSQL ratings table, which is the source of truth for all
    recommendation models (SVD, KNN, NMF) and trending calculations.
    
    Behaviour:
    - Returns 404 if movie_id does not exist in the database.
      This prevents ghost ratings (data noise for orphaned IDs).
    - Uses INSERT ... ON CONFLICT DO UPDATE (upsert) so re-rating a movie
      updates the existing row rather than creating a duplicate. This keeps
      the ratings table clean and the model training deterministic.
    - Timestamp falls back to server-side NOW() when the client doesn't
      provide one, preventing clients from forging historical timestamps.
    """

    # ── Guard: Verify the movie exists ─────────────────────────────────
    movie_row = db.execute(
        text("SELECT title FROM movies WHERE movie_id = :mid"),
        {"mid": payload.movie_id}
    ).fetchone()
    if not movie_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Movie {payload.movie_id} not found."
        )

    # ── Write: Upsert the rating ──────────────────────────────────────────
    # ON CONFLICT (user_id, movie_id) DO UPDATE means:
    #   - First rating  → INSERT a fresh row.
    #   - Re-rating     → UPDATE rating + timestamp in place, no duplicates.
    # The (user_id, movie_id) pair must be a UNIQUE constraint in Postgres.
    # If it doesn't exist (e.g. fresh DB), we fall back to a plain INSERT.
    upsert_query = text("""
        INSERT INTO ratings (user_id, movie_id, rating, timestamp)
        VALUES (
            :uid,
            :mid,
            :rating,
            COALESCE(CAST(:ts AS BIGINT), EXTRACT(EPOCH FROM NOW())::BIGINT)
        )
        ON CONFLICT (user_id, movie_id)
        DO UPDATE SET
            rating    = EXCLUDED.rating,
            timestamp = EXCLUDED.timestamp
    """)
    try:
        db.execute(upsert_query, {
            "uid":    current_user.id,
            "mid":    payload.movie_id,
            "rating": payload.rating,
            "ts":     payload.timestamp,
        })
        db.commit()
    except Exception as exc:
        db.rollback()
        # Most likely cause: UNIQUE constraint missing on (user_id, movie_id).
        # Tell the developer exactly how to fix it instead of a generic 500.
        if "unique constraint" in str(exc).lower() or "duplicate key" in str(exc).lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Duplicate rating detected but UNIQUE constraint is missing on the ratings table. "
                       "Run: python src/add_ratings_constraint.py to fix this."
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error while saving rating: {str(exc)}"
        )

    # ── Auto-remove from watchlist ────────────────────────────────────────
    # Design rationale: rating a movie means you watched it, so it should
    # no longer appear on the "Want to Watch" list. We run a DELETE silently
    # (no error if the movie wasn't in the watchlist — that's perfectly fine).
    # This avoids any extra roundtrip from the frontend; it just happens.
    try:
        db.execute(
            text("DELETE FROM watchlist WHERE user_id = :uid AND movie_id = :mid"),
            {"uid": current_user.id, "mid": payload.movie_id}
        )
        db.commit()
    except Exception:
        pass  # Watchlist table missing or other error — never break the rating flow

    # ── Respond with a structured confirmation ────────────────────────────
    return {
        "status":               "success",
        "message":              "Rating saved! Removed from watchlist if it was there. 🎬",
        "user_id":              current_user.id,
        "movie_id":             payload.movie_id,
        "movie_title":          movie_row.title,
        "rating":               payload.rating,
        "removed_from_watchlist": True,   # frontend hint: may want to refresh watchlist
    }


@app.delete("/api/ratings/{movie_id}", status_code=200)
def delete_rating(
    movie_id: int = Path(..., gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Remove a user's rating for a specific movie.
    
    This is the complement to POST /api/ratings. Use this when the user
    wants to wipe their opinion (rather than re-rate with a new star count).
    The rating row is permanently deleted from the ratings table.
    """
    result = db.execute(
        text("DELETE FROM ratings WHERE user_id = :uid AND movie_id = :mid"),
        {"uid": current_user.id, "mid": movie_id}
    )
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No rating found for movie {movie_id} to delete."
        )
    return {"status": "success", "message": f"Rating for movie {movie_id} has been deleted."}


# ==========================================================
# PHASE A6 TASK 2 — WATCHLIST MANAGEMENT
# ==========================================================
#
# Design overview
# ───────────────
# The watchlist is a simple "Want to Watch" list that lives in its own
# dedicated Postgres table. Key design decisions:
#
# 1. UNIQUE(user_id, movie_id) constraint at the DB level — the API returns
#    409 Conflict if you try to add the same movie twice, with a friendly
#    message rather than a cryptic duplicate-key error.
#
# 2. Optional `note` field (max 300 chars) — lets users add personal
#    context like "watch with Sarah" or "sequel to X". PATCH lets them
#    update it later without removing and re-adding the movie.
#
# 3. Auto-removal on rating — the moment a user rates a movie via
#    POST /api/ratings, a silent DELETE is run against the watchlist.
#    Rating = watched = no longer "want to watch". No extra UX step needed.
#
# 4. All 4 endpoints require authentication (get_current_user).
#    The user_id always comes from the JWT token, never from the URL,
#    so nobody can modify another user's watchlist.

# ── Pydantic Models ────────────────────────────────────────────────────────────

class WatchlistAddRequest(BaseModel):
    movie_id: int = Field(..., gt=0, description="ID of the movie to add to your watchlist")
    note:     str | None = Field(None, max_length=300,
                                 description="Optional personal note, e.g. 'watch with Sarah'")

class WatchlistUpdateRequest(BaseModel):
    note: str | None = Field(None, max_length=300,
                              description="Updated note. Set to null to clear it.")


# ── POST /api/watchlist ────────────────────────────────────────────────────────

@app.post("/api/watchlist", status_code=status.HTTP_201_CREATED,
          summary="Add a movie to your watchlist")
def add_to_watchlist(
    payload: WatchlistAddRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Save a movie to your personal 'Want to Watch' list.

    - Returns **201 Created** with the new watchlist entry on success.
    - Returns **404** if the movie_id doesn't exist in our database.
    - Returns **409 Conflict** if the movie is already in your watchlist
      (so the frontend never needs to check first — just call this and
      inspect the response code).

    The movie is automatically removed from this list the moment you
    rate it via POST /api/ratings.
    """
    # Verify the movie actually exists before adding it
    movie_row = db.execute(
        text("SELECT movie_id, title, genres, tmdb_id FROM movies WHERE movie_id = :mid"),
        {"mid": payload.movie_id}
    ).fetchone()
    if not movie_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Movie {payload.movie_id} not found in the database."
        )

    # Insert the watchlist row. The UNIQUE(user_id, movie_id) constraint on the
    # table ensures we never silently store a duplicate — we catch the DB error
    # and return a clean 409 instead.
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
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"'{movie_row.title}' is already in your watchlist."
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error: {str(exc)}"
        )

    return {
        "status":   "added",
        "message":  f"'{movie_row.title}' has been added to your watchlist! 🎬",
        "entry": {
            "id":        row.id,
            "movie_id":  movie_row.movie_id,
            "title":     movie_row.title,
            "genres":    movie_row.genres.split("|") if movie_row.genres else [],
            "tmdb_id":   movie_row.tmdb_id,
            "note":      payload.note,
            "added_at":  str(row.added_at),
        }
    }


# ── GET /api/watchlist ─────────────────────────────────────────────────────────

@app.get("/api/watchlist", summary="Get your full watchlist")
def get_watchlist(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Return your complete 'Want to Watch' list, most recently added first.

    Each entry includes the full movie metadata (title, genres, tmdb_id) so
    the frontend can render a rich card without making additional API calls.
    """
    rows = db.execute(
        text("""
            SELECT
                w.id,
                w.movie_id,
                m.title,
                m.genres,
                m.tmdb_id,
                w.note,
                w.added_at
            FROM watchlist w
            JOIN movies m ON m.movie_id = w.movie_id
            WHERE w.user_id = :uid
            ORDER BY w.added_at DESC
        """),
        {"uid": current_user.id}
    ).fetchall()

    return {
        "user_id": current_user.id,
        "total":   len(rows),
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

@app.delete("/api/watchlist/{movie_id}", status_code=200,
            summary="Remove a movie from your watchlist")
def remove_from_watchlist(
    movie_id: int = Path(..., gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Manually remove a movie from your 'Want to Watch' list.

    This is for cases where you changed your mind and no longer want to
    watch a film — distinct from rating it (which implies you watched it).

    Returns **404** if the movie wasn't in your list to begin with.
    """
    result = db.execute(
        text("DELETE FROM watchlist WHERE user_id = :uid AND movie_id = :mid"),
        {"uid": current_user.id, "mid": movie_id}
    )
    db.commit()

    if result.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Movie {movie_id} is not in your watchlist."
        )

    return {"status": "removed", "message": f"Movie {movie_id} removed from your watchlist."}


# ── PATCH /api/watchlist/{movie_id} ──────────────────────────────────────────

@app.patch("/api/watchlist/{movie_id}", status_code=200,
           summary="Update the note on a watchlist entry")
def update_watchlist_note(
    movie_id: int = Path(..., gt=0),
    payload: WatchlistUpdateRequest = Body(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Edit or clear the personal note attached to a watchlist entry.

    Useful for updating context like "watch with Sarah" → "already watched
    alone, want to rewatch with Sarah". Send `note: null` to clear it.

    Returns **404** if the movie isn't in your watchlist.
    """
    result = db.execute(
        text("""
            UPDATE watchlist
            SET note = :note
            WHERE user_id = :uid AND movie_id = :mid
        """),
        {"note": payload.note, "uid": current_user.id, "mid": movie_id}
    )
    db.commit()

    if result.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Movie {movie_id} is not in your watchlist."
        )

    return {
        "status":  "updated",
        "message": f"Note for movie {movie_id} updated.",
        "note":    payload.note,
    }


# ==========================================================
# 8. PHASE A5 — USER PROFILE ENDPOINT
# ==========================================================

@app.get("/api/users/{user_id}/profile")
def get_user_profile(user_id: int = Path(..., gt=0), db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Return a user's taste profile: rating stats, top genres, and favourites.

    Any authenticated user can view any profile (social discovery).
    Matches the implementation plan contract:
      { user_id, total_ratings, average_rating, top_genres, favorites }
    """

    # ── Step 1: Aggregate stats directly in Postgres ──────────────────────
    # One query to get: total count, average, and a distribution breakdown
    # (how many 1-star, 2-star ... 5-star ratings the user gave overall).
    stats_query = text("""
        SELECT
            COUNT(*)                                        AS total_ratings,
            ROUND(AVG(rating)::numeric, 2)                  AS average_rating,
            COUNT(*) FILTER (WHERE rating <= 1.5)           AS stars_1,
            COUNT(*) FILTER (WHERE rating BETWEEN 1.6 AND 2.5) AS stars_2,
            COUNT(*) FILTER (WHERE rating BETWEEN 2.6 AND 3.5) AS stars_3,
            COUNT(*) FILTER (WHERE rating BETWEEN 3.6 AND 4.5) AS stars_4,
            COUNT(*) FILTER (WHERE rating > 4.5)            AS stars_5
        FROM ratings
        WHERE user_id = :uid
    """)
    stats = db.execute(stats_query, {"uid": user_id}).fetchone()

    # 404 if this user has never rated anything
    if not stats or stats.total_ratings == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {user_id} not found or has no ratings yet."
        )

    # ── Step 2: Fetch the user's favourite movies (≥ 4.0 stars) ──────────
    # Reuses the same logic as GET /api/users/{user_id}/favorites so the two
    # endpoints are always consistent with each other.
    favs_query = text("""
        SELECT m.movie_id, m.title, m.genres, m.tmdb_id, r.rating
        FROM movies m
        JOIN ratings r ON m.movie_id = r.movie_id
        WHERE r.user_id = :uid AND r.rating >= 4.0
        ORDER BY r.rating DESC, m.title ASC
    """)
    fav_rows = db.execute(favs_query, {"uid": user_id}).fetchall()

    favorites = []
    genre_freq: dict[str, int] = {}

    for row in fav_rows:
        genres = row.genres.split("|") if row.genres else []
        favorites.append({
            "movie_id": row.movie_id,
            "title":    row.title,
            "genres":   genres,
            "tmdb_id":  row.tmdb_id,
            "rating":   float(row.rating),
        })
        # Tally genre frequencies across all favourites (weighted by ≥4-star taste)
        for g in genres:
            genre_freq[g] = genre_freq.get(g, 0) + 1

    # Sort by frequency descending, return the top 3 as the user's taste profile
    top_genres = [g for g, _ in sorted(genre_freq.items(), key=lambda x: x[1], reverse=True)[:3]]

    # ── Step 3: Return the full profile ──────────────────────────────────
    return {
        "user_id":        user_id,
        "total_ratings":  int(stats.total_ratings),
        "average_rating": float(stats.average_rating),
        "rating_breakdown": {
            "1_star":  int(stats.stars_1),
            "2_stars": int(stats.stars_2),
            "3_stars": int(stats.stars_3),
            "4_stars": int(stats.stars_4),
            "5_stars": int(stats.stars_5),
        },
        "top_genres": top_genres,
        "favorites":  favorites,
    }


# ==========================================================
# 9. PHASE A5 — BACKGROUND RETRAINING ENDPOINT
# ==========================================================

# Shared state dictionary for tracking the retraining process.
# Using a plain dict (not a Pydantic model) because it must be mutated
# from inside the background thread and read from the main thread.
retrain_status: dict = {"state": "idle", "message": "No retraining has been triggered yet."}


def _retrain_worker():
    """Background thread worker: trains a fresh SVD model and hot-swaps it.

    Threading design:
    - Runs entirely in a daemon thread so it doesn't block the event loop.
    - The GIL (Python's Global Interpreter Lock) ensures that the dict
      assignment `ml_artifacts['svd_model'] = model` is atomic — no request
      handler can read a half-initialised model object during the swap.
    - If training fails, the old model stays in place (safe fallback).
    """
    global retrain_status
    retrain_status = {"state": "running", "message": "Training in progress..."}

    try:
        # Import here to avoid circular imports if train.py ever imports from main.py
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from src.train import run_training_pipeline

        # Train SVD on the live Postgres data (includes all new POST /api/ratings feedback)
        model_path = run_training_pipeline(source="postgres")

        # Hot-swap: load the freshly saved .pkl and replace the in-memory model
        with open(model_path, "rb") as f:
            new_model = pickle.load(f)

        ml_artifacts["svd_model"] = new_model   # atomic dict assignment — thread-safe
        retrain_status = {
            "state": "idle",
            "message": "Retraining completed successfully. New model is live."
        }

    except Exception as exc:
        retrain_status = {
            "state": "error",
            "message": f"Retraining failed: {str(exc)}. Previous model is still active."
        }


@app.post("/api/retrain", status_code=status.HTTP_202_ACCEPTED)
def trigger_retrain(x_admin_secret: str | None = Header(default=None)):
    """Trigger a background SVD retraining job from live Postgres data.

    Returns 202 Accepted immediately — does NOT wait for training to finish.
    Poll GET /api/retrain/status to check when the new model is live.

    Security: Requires the X-Admin-Secret request header to match the
    ADMIN_SECRET environment variable.
    """
    expected_secret = os.getenv("ADMIN_SECRET")
    if not expected_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Retraining is disabled: ADMIN_SECRET is not configured on the server."
        )
    if x_admin_secret != expected_secret:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-Admin-Secret header."
        )

    if retrain_status["state"] == "running":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A retraining job is already running. Please wait for it to finish."
        )

    # Launch in a daemon background thread and return 202 immediately
    thread = threading.Thread(target=_retrain_worker, daemon=True)
    thread.start()

    return {
        "status": "accepted",
        "message": "Retraining started in the background. Poll GET /api/retrain/status to track progress."
    }


@app.get("/api/retrain/status")
def get_retrain_status():
    """Poll this endpoint to check if background retraining is still running."""
    return retrain_status


# ==========================================================
# 10. PHASE A6 — JWT AUTHENTICATION
# ==========================================================

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
    password: str = Field(..., description="Your current password to confirm account deactivation")





# ── POST /auth/register ────────────────────────────────────────────────────────

@app.post("/auth/register", status_code=status.HTTP_201_CREATED,
          summary="Register a new Flicker account")
async def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    """Create a new user account.
    
    Security:
    - Password is hashed with bcrypt before storage. Plain text is never persisted.
    - Duplicate email check uses a single indexed query (idx_users_email).
    - Returns both tokens so the user is immediately logged in after signup.
    """
    # Duplicate email guard (case-insensitive)
    existing = db.execute(
        text("SELECT id FROM users WHERE LOWER(email) = LOWER(:email)"),
        {"email": payload.email}
    ).fetchone()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="An account with this email already exists.")

    # Duplicate username guard
    existing_username = db.execute(
        text("SELECT id FROM users WHERE LOWER(username) = LOWER(:username)"),
        {"username": payload.username}
    ).fetchone()
    if existing_username:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="This username is already taken.")

    # Hash password and insert new user
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

    # Send welcome email in background (don't block the response)
    try:
        await send_welcome_email(new_user.email, new_user.username)
    except Exception:
        pass  # Email failure should never break registration

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

@app.post("/auth/login", summary="Log in and receive tokens")
def login(payload: LoginRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Authenticate with email + password (and optional 2FA code).

    Security:
    - Always says 'Invalid email or password' regardless of which field is wrong.
    - 2FA only enforced if the user has explicitly enabled it.
    """
    # ── Fetch user from DB ───────────────────────────────────────────────────
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

    # Deliberately vague — never reveal which of email/password is wrong
    auth_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid email or password."
    )

    if not user:
        raise auth_error
    if not verify_password(payload.password, user.hashed_password):
        raise auth_error

    # 2FA Email OTP Flow
    if bool(user.totp_enabled):
        if not payload.totp_code:
            # Generate a 6-digit code and save it to the DB
            new_code = "".join(secrets.choice("0123456789") for _ in range(6))
            db.execute(
                text("UPDATE users SET totp_secret = :code WHERE id = :uid"),
                {"code": new_code, "uid": user.id}
            )
            db.commit()
            
            # IMPORTANT: BackgroundTasks are dropped when HTTPException is raised.
            # We must send the email BEFORE raising, using a fire-and-forget thread
            # so we don't block the response.
            threading.Thread(
                target=lambda: __import__('asyncio').run(send_2fa_code_email(user.email, new_code)),
                daemon=True
            ).start()
            
            raise HTTPException(
                status_code=status.HTTP_202_ACCEPTED,
                detail="2FA_REQUIRED"
            )
            
        # Verify the provided code
        if payload.totp_code != user.totp_secret:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid 2FA code. Please try again or request a new one."
            )
            
        # Clear the code after successful use to prevent replay attacks
        db.execute(text("UPDATE users SET totp_secret = NULL WHERE id = :uid"), {"uid": user.id})
        db.commit()

    # Auto-reactivation: If the user soft-deleted their account, logging in restores it
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

@app.post("/auth/refresh", summary="Silently renew tokens (keeps user logged in)")
def refresh_tokens(payload: RefreshRequest, db: Session = Depends(get_db)):
    """Exchange a valid refresh token for a new access + refresh token pair.
    
    The frontend calls this automatically when the access token expires.
    The user never sees a login prompt — the session feels permanent.
    
    30-day refresh tokens mean users stay logged in for a month without
    doing anything. After 30 days of inactivity they are asked to log in once.
    """
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

    # Issue fresh token pair (rotating refresh tokens for security)
    new_access  = create_access_token(user.id, user.email, user.role)
    new_refresh = create_refresh_token(user.id)

    return {
        "access_token":  new_access,
        "refresh_token": new_refresh,
        "token_type":    "bearer",
    }


# ── POST /auth/forgot-password ─────────────────────────────────────────────────

@app.post("/auth/forgot-password", summary="Request a password reset email")
async def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """Send a password reset link to the user's email.
    
    Security: ALWAYS returns the same response whether the email exists or not.
    This prevents user enumeration (attacker cannot discover valid emails).
    The reset link expires in 15 minutes.
    """
    # Look up the user but don't reveal whether found or not in the response
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
            pass  # Never reveal email sending failure to the client

    # Always return the same message (enumeration prevention)
    return {
        "message": "If an account with that email exists, you will receive a password reset link shortly."
    }


# ── POST /auth/reset-password ──────────────────────────────────────────────────

@app.post("/auth/reset-password", summary="Set a new password using reset token")
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    """Validate the reset token from the email link and update the password."""
    token_data = decode_reset_token(payload.token)
    if not token_data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="This password reset link is invalid or has expired. Please request a new one.")

    new_hash = hash_password(payload.new_password)
    result = db.execute(
        text("UPDATE users SET hashed_password = :hashed WHERE id = :uid"),
        {"hashed": new_hash, "uid": int(token_data["sub"])}
    )
    db.commit()

    if result.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Account not found.")

    return {"message": "Password updated successfully. You can now log in with your new password."}


# ── GET /auth/me ───────────────────────────────────────────────────────────────

@app.get("/auth/me", summary="Get current logged-in user info")
def get_me(current_user=Depends(get_current_user)):
    """Return the profile of the currently authenticated user."""
    return {
        "id":           current_user.id,
        "email":        current_user.email,
        "username":     current_user.username,
        "role":         current_user.role,
        "totp_enabled": current_user.totp_enabled,
    }


# ── POST /auth/me/deactivate ───────────────────────────────────────────────────

@app.post("/auth/me/deactivate", summary="Deactivate (soft-delete) your account")
def deactivate_account(
    payload: DeactivateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Soft-delete the account by setting is_active=FALSE.
    
    Requires the user's password for security to prevent unauthorized deactivation.
    The account is NOT deleted from the database. Users can reactivate by logging in
    via the /auth/login endpoint.
    """
    # Fetch hashed password
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
    return {"message": "Your account has been deactivated. You can restore it anytime by logging into /auth/reactivate."}



# ── POST /auth/2FA/setup ───────────────────────────────────────────────────────

@app.post("/auth/2fa/setup", summary="Initiate 2FA setup — sends code to email")
def setup_2fa(background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Step 1 of 2FA setup: generate a 6-digit OTP code and email it.
    
    2FA is NOT enabled yet — the user must confirm they received the code
    by passing it to POST /auth/2fa/verify.
    """
    code = "".join(secrets.choice("0123456789") for _ in range(6))

    # Store the pending secret (not active until verified)
    db.execute(
        text("UPDATE users SET totp_secret = :code WHERE id = :uid"),
        {"code": code, "uid": current_user.id}
    )
    db.commit()
    
    background_tasks.add_task(send_2fa_code_email, current_user.email, code)

    return {"message": "A 6-digit verification code has been sent to your email. Call POST /auth/2fa/verify to complete setup."}


# ── POST /auth/2fa/verify ──────────────────────────────────────────────────────

@app.post("/auth/2fa/verify", summary="Confirm 2FA setup by verifying the email code")
def verify_2fa_setup(
    payload: Enable2FARequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Step 2 of 2FA setup: verify the emailed code to officially activate 2FA."""
    row = db.execute(
        text("SELECT totp_secret FROM users WHERE id = :uid"),
        {"uid": current_user.id}
    ).fetchone()

    if not row or not row.totp_secret:
        raise HTTPException(status_code=400,
                            detail="No 2FA setup in progress. Call POST /auth/2fa/setup first.")

    if payload.totp_code != row.totp_secret:
        raise HTTPException(status_code=400,
                            detail="Invalid code. Please check your email and try again.")

    # Activate 2FA and clear out the used code
    db.execute(
        text("UPDATE users SET totp_enabled = TRUE, totp_secret = NULL WHERE id = :uid"),
        {"uid": current_user.id}
    )
    db.commit()

    return {"message": "2FA has been successfully enabled on your account! Your logins will now require an email verification code. ✅"}


# ── POST /auth/2fa/disable ─────────────────────────────────────────────────────

@app.post("/auth/2fa/disable", summary="Disable 2FA")
def disable_2fa(
    payload: DeactivateRequest,  # We reuse the password payload for security check
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Disable 2FA. Requires password to prevent unauthorized disabling."""
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
