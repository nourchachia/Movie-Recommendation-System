import os
import sys
import json
from dotenv import load_dotenv

load_dotenv()

from sqlalchemy import create_engine, text
from core.database import SessionLocal
import traceback

def run_debug():
    print("Connecting to DB...")
    db = SessionLocal()
    try:
        print("Checking if watch_sessions exists...")
        row = db.execute(text("SELECT * FROM watch_sessions LIMIT 1")).fetchone()
        print("✅ watch_sessions exists!")

        print("Executing pool query...")
        test_uid = 1
        pool_size = 10
        pool_rows = db.execute(
            text("""
                SELECT m.movie_id, m.title, m.genres, m.tmdb_id
                FROM movies m
                JOIN ratings r ON m.movie_id = r.movie_id
                WHERE m.movie_id NOT IN (
                    SELECT movie_id FROM ratings WHERE user_id = :uid
                )
                GROUP BY m.movie_id, m.title, m.genres, m.tmdb_id
                HAVING COUNT(r.rating) >= 20
                ORDER BY AVG(r.rating) DESC, COUNT(r.rating) DESC
                LIMIT :pool_size
            """),
            {"uid": test_uid, "pool_size": pool_size * 3},
        ).fetchall()
        print(f"✅ Found {len(pool_rows)} pool candidates")

        print("Testing json.dumps...")
        pool = [{"movie_id": r.movie_id, "title": r.title, "est": 2.5} for r in pool_rows]
        dumped = json.dumps(pool)
        
        print("Testing insert...")
        db.execute(
            text("""
                INSERT INTO watch_sessions (code, creator_id, status, movie_pool)
                VALUES ('XYZ12345', :creator_id, 'waiting', :pool::jsonb)
                ON CONFLICT DO NOTHING
            """),
            {"creator_id": test_uid, "pool": dumped},
        )
        db.commit()
        print("✅ Insert successful!")
        
    except Exception as e:
        print(f"❌ Crash inside backend logic: {e}")
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    run_debug()
