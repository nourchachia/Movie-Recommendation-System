#!/usr/bin/env python3
"""
ml_pipeline/scripts/regenerate_embeddings.py
=============================================
ONE-TIME migration script.

The original migrate_db.py used TF-IDF with 23 genre dimensions (vector(23)).
The live pgvector cosine-similarity queries and the import_movies.py script
need 384-dimensional sentence-transformers embeddings.

This script:
  1. Alters the `embedding` column to vector(384)
  2. Regenerates embeddings for ALL existing movies using sentence-transformers
  3. Re-creates the HNSW index for fast cosine-similarity search

Run ONCE from the project root (WSL):
  source venv_wsl/bin/activate
  python ml_pipeline/scripts/regenerate_embeddings.py

Estimated runtime: ~3-5 minutes for 9,000 movies on CPU.
"""

import os
import sys
import time
import psycopg2
from dotenv import load_dotenv

# ── Config ────────────────────────────────────────────────────────────────────

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(ROOT_DIR, ".env"))

DATABASE_URL = os.getenv("DATABASE_URL")
EMBED_MODEL  = "all-MiniLM-L6-v2"
BATCH_SIZE   = 256   # movies processed per commit — keeps RAM usage low

if not DATABASE_URL:
    print("❌  DATABASE_URL not found in .env. Aborting.")
    sys.exit(1)


# ── Helpers ───────────────────────────────────────────────────────────────────

def get_connection():
    url = DATABASE_URL.replace("&channel_binding=require", "")
    return psycopg2.connect(url, connect_timeout=30)


def load_encoder():
    print(f"⏳  Loading sentence-transformers model '{EMBED_MODEL}'…")
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        print("❌  sentence-transformers not installed. Run: pip install sentence-transformers")
        sys.exit(1)
    model = SentenceTransformer(EMBED_MODEL)
    print("✅  Model loaded.\n")
    return model


def make_text(title: str, genres: str) -> str:
    """Combine title + genres into a rich text for the encoder."""
    genres_space = (genres or "").replace("|", " ")
    return f"{title} {genres_space}".strip()


# ── Step 1: Alter the column ──────────────────────────────────────────────────

def alter_column(conn):
    print("🔧  Step 1: Altering movie embedding column to vector(384)…")
    cur = conn.cursor()

    # Drop the old column, recreate as 384d
    cur.execute("ALTER TABLE movies DROP COLUMN IF EXISTS embedding;")
    cur.execute("ALTER TABLE movies ADD COLUMN embedding vector(384);")

    conn.commit()
    cur.close()
    print("     ✅  Column ready.\n")


# ── Step 2: Regenerate all embeddings ─────────────────────────────────────────

def regenerate_all(conn, encoder):
    print("🧠  Step 2: Fetching all movies from database…")
    cur = conn.cursor()

    cur.execute("SELECT movie_id, title, genres FROM movies ORDER BY movie_id;")
    rows = cur.fetchall()
    total = len(rows)
    print(f"     Found {total:,} movies to process.\n")

    start = time.time()

    for batch_start in range(0, total, BATCH_SIZE):
        batch = rows[batch_start : batch_start + BATCH_SIZE]
        batch_num = batch_start // BATCH_SIZE + 1
        total_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE

        # Build texts for the whole batch at once (much faster than one by one)
        texts = [make_text(r[1] or "", r[2] or "") for r in batch]

        # Encode entire batch in one GPU/CPU call
        vectors = encoder.encode(texts, normalize_embeddings=True, show_progress_bar=False)

        # Build update tuples
        updates = []
        for i, row in enumerate(batch):
            movie_id = row[0]
            vec_str  = "[" + ",".join(f"{v:.8f}" for v in vectors[i].tolist()) + "]"
            updates.append((vec_str, movie_id))

        # Batch-update the database
        cur.executemany(
            "UPDATE movies SET embedding = %s::vector WHERE movie_id = %s",
            updates
        )
        conn.commit()

        elapsed  = time.time() - start
        done     = batch_start + len(batch)
        pct      = done / total * 100
        movies_s = done / elapsed if elapsed > 0 else 0
        eta_s    = (total - done) / movies_s if movies_s > 0 else 0

        print(
            f"     Batch {batch_num}/{total_batches} — "
            f"{done:,}/{total:,} ({pct:.0f}%) — "
            f"{movies_s:.0f} movies/s — "
            f"ETA: {eta_s:.0f}s"
        )

    cur.close()
    elapsed = time.time() - start
    print(f"\n     ✅  All {total:,} embeddings regenerated in {elapsed:.0f}s.\n")


# ── Step 3: Rebuild HNSW index ────────────────────────────────────────────────

def rebuild_index(conn):
    print("⚡  Step 3: Rebuilding HNSW index for fast cosine similarity…")
    cur = conn.cursor()

    # Drop old index if it exists (may have wrong dimensions)
    cur.execute("DROP INDEX IF EXISTS movies_embedding_hnsw_idx;")

    # Create a new HNSW index — the best algorithm for <=> cosine queries
    # m=16, ef_construction=64 are standard quality/speed defaults
    cur.execute("""
        CREATE INDEX movies_embedding_hnsw_idx
        ON movies
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
    """)
    conn.commit()
    cur.close()
    print("     ✅  HNSW index created.\n")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  Flicker — Embedding Migration (23d TF-IDF → 384d SBERT)")
    print("=" * 60)
    print()

    encoder = load_encoder()
    conn    = get_connection()
    conn.autocommit = False

    try:
        alter_column(conn)
        regenerate_all(conn, encoder)
        rebuild_index(conn)
    except Exception as exc:
        conn.rollback()
        print(f"\n❌  Migration failed: {exc}")
        raise
    finally:
        conn.close()

    print("=" * 60)
    print("  ✅  Migration complete!")
    print("  All movie embeddings are now 384-dimensional.")
    print("  Run import_movies.py to add new movies safely.")
    print("  Restart your FastAPI server to pick up the changes.")
    print("=" * 60)


if __name__ == "__main__":
    main()