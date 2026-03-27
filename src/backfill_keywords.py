"""
src/backfill_keywords.py
=====================================================
Fetches movie keywords from the TMDB API and updates the local database.
Run this script to populate the missing `keywords` column values.
"""

import os
import time
import requests
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()

DB_URL = os.getenv("DATABASE_URL")
TMDB_API_KEY = os.getenv("TMDB_API_KEY")

if not DB_URL:
    raise ValueError("CRITICAL: DATABASE_URL is missing!")
if not TMDB_API_KEY:
    raise ValueError("CRITICAL: TMDB_API_KEY is missing!")

engine = create_engine(DB_URL, pool_pre_ping=True)

def fetch_movie_keywords(tmdb_id: int) -> str | None:
    url = f"https://api.themoviedb.org/3/movie/{tmdb_id}/keywords?api_key={TMDB_API_KEY}"
    try:
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            kw_list = []
            if "keywords" in data:
                kw_list = [k["name"] for k in data["keywords"]]
            elif "results" in data:
                kw_list = [k["name"] for k in data["results"]]
            return ", ".join(kw_list)
        elif response.status_code == 429:
            print("Rate limited by TMDB. Waiting 5 seconds...")
            time.sleep(5)
            return fetch_movie_keywords(tmdb_id)
        elif response.status_code == 404:
            return "" # TMDB ID not found
        else:
            print(f"Error fetching {tmdb_id}: {response.status_code} - {response.text}")
            return None
    except Exception as e:
        print(f"Exception fetching {tmdb_id}: {e}")
        return None

def main():
    BATCH_SIZE = 100
    
    with engine.connect() as conn:
        # Get movies that need keywords
        rows = conn.execute(text(
            "SELECT movie_id, tmdb_id, title FROM movies WHERE keywords IS NULL AND tmdb_id IS NOT NULL"
        )).fetchall()
        
        total_movies = len(rows)
        print(f"To backfill: {total_movies} movies.")
        
        success_count = 0
        error_count = 0
        
        for i, row in enumerate(rows):
            tmdb_id = row.tmdb_id
            movie_id = row.movie_id
            
            keywords = fetch_movie_keywords(tmdb_id)
            
            if keywords is not None:
                # Update DB
                conn.execute(
                    text("UPDATE movies SET keywords = :keywords WHERE movie_id = :movie_id"),
                    {"keywords": keywords, "movie_id": movie_id}
                )
                success_count += 1
                if success_count % 50 == 0:
                    conn.commit()
            else:
                error_count += 1
                
            if (i + 1) % 10 == 0:
                print(f"Processed {i + 1} / {total_movies} (Success: {success_count}, Errors: {error_count})")
            
            time.sleep(0.05)
            
        conn.commit()
        print(f"\n✅ Backfill complete! Successfully added keywords to {success_count} movies. {error_count} errors.")

if __name__ == "__main__":
    main()
