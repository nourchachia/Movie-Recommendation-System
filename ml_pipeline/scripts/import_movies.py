#!/usr/bin/env python3
"""
ml_pipeline/scripts/import_movies.py
=====================================
Admin script to import new movies from TMDB into the Flicker database.

Usage:
    1. Add TMDB_API_KEY to your .env file
    2. Edit the TMDB_IDS list at the bottom of this file
    3. Run from the project root directory:

       source venv_wsl/bin/activate
       python ml_pipeline/scripts/import_movies.py

The script will:
    - Fetch title, genres, and overview from TMDB
    - Generate a 384-dimensional embedding using sentence-transformers
    - INSERT or UPDATE the movie in your Neon PostgreSQL database
    - Skip movies that are already in the database (by tmdb_id)

Requirements (already in backend/requirements.txt, may need):
    pip install sentence-transformers requests python-dotenv
"""

import os
import sys
import json
import time
import requests
import psycopg2
from dotenv import load_dotenv

# ─────────────────────────────────────────────────────────────────────────────
# 0. CONFIG
# ─────────────────────────────────────────────────────────────────────────────

# Load .env (look in the project root, two levels up from this script's location)
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(ROOT_DIR, ".env"))

DATABASE_URL = os.getenv("DATABASE_URL")
TMDB_API_KEY  = os.getenv("TMDB_API_KEY")

if not DATABASE_URL:
    print("❌  DATABASE_URL not found in .env. Aborting.")
    sys.exit(1)
if not TMDB_API_KEY:
    print("❌  TMDB_API_KEY not found in .env. Get a free key at https://www.themoviedb.org/settings/api and add it.")
    sys.exit(1)

# sentence-transformers model — must be the same one used to generate existing embeddings
EMBED_MODEL = "all-MiniLM-L6-v2"

# MovieLens IDs go up to ~200,000. New movies start from 1,000,000 to avoid collisions.
NEW_MOVIE_ID_START = 1_000_000

# TMDB genre_id → genre name mapping (official TMDB list)
TMDB_GENRE_MAP = {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy",
    80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Children",
    14: "Fantasy", 36: "History", 27: "Horror", 10402: "Musical",
    9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 10770: "TV Movie",
    53: "Thriller", 10752: "War", 37: "Western",
}


# ─────────────────────────────────────────────────────────────────────────────
# 1. TMDB FETCHER
# ─────────────────────────────────────────────────────────────────────────────

def fetch_tmdb_movie(tmdb_id: int) -> dict | None:
    """
    Calls the TMDB API and returns a normalised dict ready for our DB.
    Returns None on any error so the caller can skip gracefully.
    """
    url = f"https://api.themoviedb.org/3/movie/{tmdb_id}"
    params = {"api_key": TMDB_API_KEY, "language": "en-US"}

    try:
        resp = requests.get(url, params=params, timeout=10)
        if resp.status_code == 404:
            print(f"  ⚠️  TMDB ID {tmdb_id} not found (404). Skipping.")
            return None
        resp.raise_for_status()
    except requests.RequestException as exc:
        print(f"  ⚠️  Network error for TMDB ID {tmdb_id}: {exc}. Skipping.")
        return None

    data = resp.json()

    # Build the pipe-separated genres string (MovieLens style: "Action|Drama|Sci-Fi")
    genres_list = [
        TMDB_GENRE_MAP.get(g["id"], g["name"])
        for g in data.get("genre_ids", data.get("genres", []))
        # genres is a list of dicts — support both /movie/{id} and /discover formats
        if isinstance(g, dict)
    ]
    # /movie/{id} returns full genre objects; handle both id and name keys
    genre_names = []
    for g in data.get("genres", []):
        name = TMDB_GENRE_MAP.get(g.get("id", 0), g.get("name", ""))
        if name:
            genre_names.append(name)
    genres_pipe = "|".join(genre_names) if genre_names else "(no genres listed)"

    # Build a meaningful title string including year if available
    release_year = (data.get("release_date") or "")[:4]
    title = data.get("title", f"Unknown ({tmdb_id})")
    if release_year:
        title_with_year = f"{title} ({release_year})"
    else:
        title_with_year = title

    return {
        "tmdb_id":  tmdb_id,
        "title":    title_with_year,
        "genres":   genres_pipe,
        "overview": data.get("overview", ""),
    }


# ─────────────────────────────────────────────────────────────────────────────
# 2. EMBEDDING GENERATOR
# ─────────────────────────────────────────────────────────────────────────────

def load_encoder():
    """Lazy-load the sentence-transformers model (downloads ~90MB on first run)."""
    print(f"⏳  Loading sentence-transformers model '{EMBED_MODEL}'…")
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        print("❌  sentence-transformers not installed. Run: pip install sentence-transformers")
        sys.exit(1)
    model = SentenceTransformer(EMBED_MODEL)
    print("✅  Model loaded.\n")
    return model


def make_embedding_text(movie: dict) -> str:
    """
    Combine title + genres + overview into a single string for the encoder.
    More text = richer embedding = better content-based similarity.
    """
    parts = [
        movie["title"],
        movie["genres"].replace("|", " "),
        movie.get("overview", ""),
    ]
    return " ".join(p for p in parts if p).strip()


def encode(model, movie: dict) -> list[float]:
    """Returns a Python list of 384 floats."""
    text = make_embedding_text(movie)
    vector = model.encode(text, normalize_embeddings=True)
    return vector.tolist()


# ─────────────────────────────────────────────────────────────────────────────
# 3. DATABASE HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def get_connection():
    """
    Open a raw psycopg2 connection to Neon.
    We use psycopg2 directly (not SQLAlchemy) to easily send pgvector literals.
    """
    # Neon uses the same DATABASE_URL format. Remove channel_binding if present.
    url = DATABASE_URL.replace("&channel_binding=require", "")
    return psycopg2.connect(url, connect_timeout=15)


def get_next_movie_id(cursor) -> int:
    """Pick the next available ID in the ≥1,000,000 range."""
    cursor.execute(
        "SELECT COALESCE(MAX(movie_id), %s - 1) + 1 FROM movies WHERE movie_id >= %s",
        (NEW_MOVIE_ID_START, NEW_MOVIE_ID_START)
    )
    row = cursor.fetchone()
    return row[0]


def already_exists(cursor, tmdb_id: int) -> bool:
    cursor.execute("SELECT 1 FROM movies WHERE tmdb_id = %s", (tmdb_id,))
    return cursor.fetchone() is not None


def insert_movie(cursor, movie_id: int, movie: dict, embedding: list[float]) -> None:
    """
    Upsert the movie into the DB.
    ON CONFLICT (tmdb_id) DO UPDATE: if the movie is somehow already there,
    we update its title, genres, and embedding (useful for re-running the script).
    """
    # pgvector expects the vector as a string like '[0.1, -0.3, ...]'
    embedding_str = "[" + ",".join(f"{v:.8f}" for v in embedding) + "]"

    cursor.execute(
        """
        INSERT INTO movies (movie_id, title, genres, tmdb_id, embedding)
        VALUES (%s, %s, %s, %s, %s::vector)
        ON CONFLICT (tmdb_id) DO UPDATE
            SET title     = EXCLUDED.title,
                genres    = EXCLUDED.genres,
                embedding = EXCLUDED.embedding
        """,
        (movie_id, movie["title"], movie["genres"], movie["tmdb_id"], embedding_str)
    )


# ─────────────────────────────────────────────────────────────────────────────
# 4. MAIN IMPORT LOOP
# ─────────────────────────────────────────────────────────────────────────────

def import_movies(tmdb_ids: list[int]) -> None:
    if not tmdb_ids:
        print("⚠️  No TMDB IDs provided. Edit the TMDB_IDS list at the bottom of this file.")
        return

    print(f"🎬  Flicker Movie Importer — {len(tmdb_ids)} movie(s) to process\n")

    # Load the embedding model once (expensive operation)
    encoder = load_encoder()

    conn = get_connection()
    conn.autocommit = False
    cursor = conn.cursor()

    imported = 0
    skipped  = 0
    errors   = 0

    for i, tmdb_id in enumerate(tmdb_ids, 1):
        print(f"[{i}/{len(tmdb_ids)}] TMDB ID {tmdb_id}")

        # ── Check if already in DB ────────────────────────────────────────────
        if already_exists(cursor, tmdb_id):
            print(f"  ✅  Already in database. Skipping.\n")
            skipped += 1
            continue

        # ── Fetch from TMDB ───────────────────────────────────────────────────
        movie = fetch_tmdb_movie(tmdb_id)
        if movie is None:
            errors += 1
            continue
        print(f"  📋  Title:  {movie['title']}")
        print(f"  🎭  Genres: {movie['genres']}")

        # ── Generate embedding ────────────────────────────────────────────────
        embedding = encode(encoder, movie)
        print(f"  🧠  Embedding: {len(embedding)}d vector generated")

        # ── Insert into Neon ──────────────────────────────────────────────────
        new_id = get_next_movie_id(cursor)
        insert_movie(cursor, new_id, movie, embedding)
        conn.commit()
        print(f"  💾  Saved to DB as movie_id={new_id} ✅\n")
        imported += 1

        # Be polite to TMDB API (max 40 req/10s per their rate limit)
        time.sleep(0.3)

    cursor.close()
    conn.close()

    print("─" * 50)
    print(f"🎉  Done!  Imported: {imported}  |  Skipped (already exist): {skipped}  |  Errors: {errors}")
    if imported > 0:
        print("\n💡  Tip: Restart your FastAPI server so the updated DB is picked up by the live endpoints.")


# ─────────────────────────────────────────────────────────────────────────────
# 5. ✏️  EDIT THIS LIST — paste your TMDB IDs here before running
# ─────────────────────────────────────────────────────────────────────────────

TMDB_IDS: list[int] = [
    # Example — remove these and paste your own:
    1022789,   # Inside Out 2
    533535,    # Deadpool & Wolverine
    786892,    # Furiosa
    823464,    # Godzilla x Kong
]


if __name__ == "__main__":
    import_movies(TMDB_IDS)