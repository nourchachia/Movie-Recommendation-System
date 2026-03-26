import pandas as pd
import numpy as np
from sqlalchemy import create_engine, text
from sentence_transformers import SentenceTransformer
import os
from dotenv import load_dotenv

# SECURITY FIX: Load secrets purely from the hidden .env file
load_dotenv()

# Read the environment variable. If it doesn't exist, crash the app immediately!
DB_URL = os.getenv("DATABASE_URL")
if not DB_URL:
    raise ValueError("CRITICAL SECURITY ERROR: DATABASE_URL is missing from your environment variables!")

def main():
    print("🚀 Starting Database Migration to PostgreSQL...")
    
    # 1. Load the raw data files
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_path = os.path.join(base_dir, "datasets", "ml-latest-small")
    
    print(f"Loading CSV datasets from {data_path}...")
    movies_df = pd.read_csv(os.path.join(data_path, "movies.csv"))
    ratings_df = pd.read_csv(os.path.join(data_path, "ratings.csv"))
    links_df = pd.read_csv(os.path.join(data_path, "links.csv"))
    
    # 2. Merge TMDB IDs into the movies dataframe (This solves the missing Posters problem!)
    print("Attaching TMDB IDs for Frontend Image Fetching...")
    movies_df = movies_df.merge(links_df[['movieId', 'tmdbId']], on='movieId', how='left')
    movies_df['tmdbId'] = movies_df['tmdbId'].fillna(0).astype(int) # Handle any movies missing a TMDB ID
    
    # 3. Generate 384-dimensional Semantic Embeddings for pgvector
    print("Generating 384d sentence-transformer embeddings for 'pgvector'...")
    movies_df['genres'] = movies_df['genres'].fillna('')
    encoder = SentenceTransformer("all-MiniLM-L6-v2")

    # Combine title + genres for richer embeddings
    texts = (movies_df['title'].fillna('') + ' ' + movies_df['genres'].str.replace('|', ' ', regex=False)).tolist()
    vectors = encoder.encode(texts, normalize_embeddings=True, batch_size=256, show_progress_bar=True)

    vector_dim = 384
    print(f"Successfully generated {vector_dim}-dimensional embeddings for {len(texts)} movies.")

    # Format as pgvector literal strings: "[0.1, -0.3, ...]"
    movies_df['embedding'] = ["[" + ",".join(f"{v:.8f}" for v in row.tolist()) + "]" for row in vectors]
    
    # 4. Standardize Column Names (SQL heavily prefers lowercase_snake_case)
    movies_df.rename(columns={'movieId': 'movie_id', 'tmdbId': 'tmdb_id'}, inplace=True)
    ratings_df.rename(columns={'userId': 'user_id', 'movieId': 'movie_id'}, inplace=True)
    
    # 5. Connect to PostgreSQL
    print(f"Connecting to database at {DB_URL}...")
    engine = create_engine(DB_URL)
    
    with engine.connect() as conn:
        # SECURITY FIX: Prevent accidental data deletion if this script is run on the production server
        if os.getenv("ENVIRONMENT") != "production":
            print("Development Environment: Dropping old API tables to ensure a clean slate...")
            conn.execute(text("DROP TABLE IF EXISTS ratings;"))
            conn.execute(text("DROP TABLE IF EXISTS movies;"))
        else:
            print("Production Environment: Safely bypassing table teardowns.")
            
        print("Enabling the pgvector mathematical extension...")
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
        conn.commit()
        
        # Create Movies Table explicitly. This is crucial because it natively defines the `vector` data type!
        print("Creating the 'movies' schema...")
        conn.execute(text(f"""
            CREATE TABLE movies (
                movie_id INTEGER PRIMARY KEY,
                title VARCHAR,
                genres VARCHAR,
                tmdb_id INTEGER,
                embedding vector({vector_dim})
            );
        """))
        conn.commit()
        
    # 6. Insert rows into the Database
    # Using chunksize=1000 prevents Python from running out of RAM by blasting the database with all 100,000 rows at once
    print("Inserting 9,000 movies into PostgreSQL (This will take a few seconds)...")
    movies_df.to_sql('movies', engine, if_exists='append', index=False, method='multi', chunksize=1000)
    
    print("Inserting 100,000 ratings into PostgreSQL (This will take a few seconds)...")
    ratings_df.to_sql('ratings', engine, if_exists='replace', index=False, method='multi', chunksize=1000)

    # 7. Create Indexes
    # Indexes are like a book's table of contents. Without them, Postgres has to scan 100,000 rating rows one-by-one!
    print("Building analytical Indexes for blazing-fast API Queries...")
    with engine.connect() as conn:
        conn.execute(text("CREATE INDEX idx_ratings_user_id ON ratings(user_id);"))
        conn.execute(text("CREATE INDEX idx_ratings_movie_id ON ratings(movie_id);"))
        conn.commit()
        
    print("🎉 Migration Complete! Your data is safe and live inside the PostgreSQL engine!")

if __name__ == "__main__":
    main()
