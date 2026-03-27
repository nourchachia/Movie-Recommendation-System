"""
Phase A5 — One-time Migration: Add UNIQUE constraint to ratings table
=====================================================================
The POST /api/ratings endpoint uses a PostgreSQL UPSERT:
    INSERT ... ON CONFLICT (user_id, movie_id) DO UPDATE ...

This requires a UNIQUE constraint on the (user_id, movie_id) pair.
The original migrate_db.py only added speed indexes, not uniqueness.

This script adds that constraint without dropping any existing data:
  - If duplicates already exist in the table, it deduplicates them first
    (keeping the latest rating per pair) before adding the constraint.
  - Safe to run on a live database — no table teardowns.

Usage (WSL terminal):
    python src/add_ratings_constraint.py
"""

import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
DB_URL = os.getenv("DATABASE_URL")
if not DB_URL:
    raise ValueError("CRITICAL: DATABASE_URL is missing from environment variables!")

engine = create_engine(DB_URL)

def main():
    with engine.connect() as conn:
        # ── Step 1: Check if the constraint already exists ──────────────────
        existing = conn.execute(text("""
            SELECT constraint_name
            FROM information_schema.table_constraints
            WHERE table_name = 'ratings'
              AND constraint_type = 'UNIQUE'
              AND constraint_name = 'uq_ratings_user_movie'
        """)).fetchone()

        if existing:
            print("✅ UNIQUE constraint already exists — nothing to do.")
            return

        # ── Step 2: Remove duplicate (user_id, movie_id) rows ───────────────
        # Keep only the row with the latest timestamp for each pair.
        # This avoids the "could not create unique index" error if the CSV
        # data happened to have duplicate user/movie pairs.
        print("🔍 Deduplicating ratings table (keeping most recent rating per user/movie pair)...")
        conn.execute(text("""
            DELETE FROM ratings
            WHERE ctid NOT IN (
                SELECT DISTINCT ON (user_id, movie_id) ctid
                FROM ratings
                ORDER BY user_id, movie_id, timestamp DESC NULLS LAST
            )
        """))
        conn.commit()
        print("✅ Deduplication complete.")

        # ── Step 3: Add the UNIQUE constraint ───────────────────────────────
        print("🔧 Adding UNIQUE constraint on (user_id, movie_id)...")
        conn.execute(text("""
            ALTER TABLE ratings
            ADD CONSTRAINT uq_ratings_user_movie UNIQUE (user_id, movie_id)
        """))
        conn.commit()
        print("✅ UNIQUE constraint 'uq_ratings_user_movie' added successfully!")
        print("🎉 The POST /api/ratings upsert endpoint is now fully operational.")

if __name__ == "__main__":
    main()
