"""
src/migrate_add_movie_keywords.py
=====================================================
Migration script to add the `keywords` column to the `movies` table.
"""

import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()

DB_URL = os.getenv("DATABASE_URL")
if not DB_URL:
    raise ValueError("CRITICAL: DATABASE_URL is missing from environment variables!")

engine = create_engine(DB_URL, pool_pre_ping=True)

DDL = """
ALTER TABLE movies ADD COLUMN IF NOT EXISTS keywords TEXT;
"""

def main() -> None:
    with engine.connect() as conn:
        conn.execute(text(DDL))
        conn.commit()
        print("✅ Added `keywords` column to movies table.")

    with engine.connect() as conn:
        count = conn.execute(text("SELECT COUNT(*) FROM movies WHERE keywords IS NULL")).scalar()
        print(f"Movies needing keywords backfill: {count}")

if __name__ == "__main__":
    main()
