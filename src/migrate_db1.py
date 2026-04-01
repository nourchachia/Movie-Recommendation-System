import pandas as pd
import numpy as np
from sqlalchemy import create_engine, text
from sklearn.feature_extraction.text import TfidfVectorizer
from sentence_transformers import SentenceTransformer
import os
from dotenv import load_dotenv

def main():
    movies_df = movies_df.merge(links_df[['movieId', 'tmdbId']], on='movieId', how='left')
    movies_df['tmdbId'] = movies_df['tmdbId'].fillna(0).astype(int) # Handle any movies missing a TMDB ID

    # 3. Generate Semantic Embeddings for pgvector
    print("Generating pure mathematical embeddings for 'pgvector'...")
    # 3. Generate 384-dimensional Semantic Embeddings for pgvector
    print("Generating 384d sentence-transformer embeddings for 'pgvector'...")
    movies_df['genres'] = movies_df['genres'].fillna('')
    tfidf = TfidfVectorizer(stop_words='english')
    tfidf_matrix = tfidf.fit_transform(movies_df['genres'])
    
    # Find out exactly how many unique genres there are (this is the dimensionality of our math vectors)
    vector_dim = tfidf_matrix.shape[1]
    print(f"Successfully generated embeddings with {vector_dim} dimensions.")
    
    # Convert the sparse sklearn matrix into standard arrays, then to strings formatted as "[0.1, 0.4, 0.0, ...]"
    # This string format is exactly what PostgreSQL's pgvector expects!
    dense_matrix = tfidf_matrix.toarray()
    movies_df['embedding'] = [str(list(row)) for row in dense_matrix]
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