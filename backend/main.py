import os
import json
import pickle
import numpy as np
from fastapi import FastAPI, HTTPException, Query, Path, Depends
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session

# ==========================================================
# 1. DATABASE CONFIGURATION (FastAPI best practice)
# ==========================================================
load_dotenv()
DB_URL = os.getenv("DATABASE_URL")
if not DB_URL:
    raise ValueError("CRITICAL: DATABASE_URL is missing from environment variables!")

engine = create_engine(DB_URL)
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

@app.get("/api/users/{user_id}/favorites")
def get_user_favorites(user_id: int = Path(..., gt=0), db: Session = Depends(get_db)): 
    """Fetch the user's top-rated movies directly via PostgreSQL JOIN."""
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

@app.get("/api/recommendations/top-picks")
def get_top_picks(
    user_id: int = Query(..., gt=0), 
    limit: int = Query(10, ge=1, le=50), 
    alpha: float = Query(0.7, ge=0.0, le=1.0),
    db: Session = Depends(get_db)
):
    """The main 'For You' row integrating pgvector Candidate Generation with the Python SVD model."""
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

    # -------------------------------------------------------------
    # STEP 3: SERENDIPITY (2 wildcards from OUTSIDE the user's top genres)
    # -------------------------------------------------------------
    # Critical: must exclude the user's top genres, otherwise a Drama fan can
    # receive Drama movies tagged as 'broaden your horizons' — which is absurd.
    excl_conditions = " AND ".join(
        [f"m.genres NOT ILIKE '%{g}%'" for g in top_genres]
    ) if top_genres else "TRUE"
    serendipity_query = text(f"""
        SELECT m.movie_id, m.title, m.genres, m.tmdb_id
        FROM movies m
        JOIN ratings r ON m.movie_id = r.movie_id
        WHERE m.movie_id NOT IN (SELECT movie_id FROM ratings WHERE user_id = :uid)
          AND {excl_conditions}
        GROUP BY m.movie_id, m.title, m.genres, m.tmdb_id
        HAVING AVG(r.rating) >= 4.0 AND COUNT(r.rating) > 50
        ORDER BY RANDOM()
        LIMIT 6
    """)
    s_movies = db.execute(serendipity_query, {"uid": user_id}).fetchall()
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
    """Trending movies calculated via blazing fast SQL Data Warehousing queries."""
    
    # We combine COUNT(ratings) [popularity] and AVG(ratings) [quality] into a trending score
    sql_query = """
        SELECT m.movie_id, m.title, m.genres, m.tmdb_id,
               COUNT(r.rating) * AVG(r.rating) AS trending_score
        FROM movies m
        JOIN ratings r ON m.movie_id = r.movie_id
    """
    params = {"limit": limit}
    
    if category:
        # SQL Injection safe because we use SQLAlchemy parameter binding `:cat`
        sql_query += " WHERE m.genres ILIKE :cat"
        params["cat"] = f"%{category}%"
        
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
        
    row_title = f"Trending in {category.capitalize()}" if category else "Trending Now"
    return {"row_title": row_title, "movies": results}
