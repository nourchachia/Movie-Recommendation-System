"""
train.py — Flicker ML Training Pipeline
========================================
Reads the live ratings from PostgreSQL (the single source of truth that
includes all new user feedback submitted via POST /api/ratings), trains
the SVD collaborative-filtering model, and saves it to models/svd_model.pkl.

The saved .pkl file is what the FastAPI server loads at startup AND what
the POST /api/retrain endpoint hot-swaps into memory without a server restart.

Usage:
    python src/train.py                  # standalone one-shot training
    python src/train.py --source csv     # fallback if Postgres is unavailable
"""

import os
import pickle
import argparse
import pandas as pd
from dotenv import load_dotenv
from surprise import SVD, Dataset, Reader
from sqlalchemy import create_engine, text

# ── Configuration ─────────────────────────────────────────────────────────────
load_dotenv()
MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")
os.makedirs(MODELS_DIR, exist_ok=True)


def load_ratings_from_postgres() -> pd.DataFrame:
    """Pull the full ratings table from Postgres into a DataFrame.

    This is the primary data source. It contains the original MovieLens
    data PLUS any new ratings submitted by users via POST /api/ratings,
    which is the entire point of the feedback loop.
    """
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise ValueError("DATABASE_URL not set in environment. Cannot connect to Postgres.")

    print("  Connecting to PostgreSQL...")
    engine = create_engine(db_url)
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT user_id, movie_id, rating FROM ratings")).fetchall()

    df = pd.DataFrame(rows, columns=["userId", "movieId", "rating"])
    print(f"  Loaded {len(df):,} ratings from Postgres ({df['userId'].nunique():,} users, {df['movieId'].nunique():,} movies)")
    return df


def load_ratings_from_csv() -> pd.DataFrame:
    """Fallback: load ratings from the original CSV files.

    Use this only when Postgres is unavailable (e.g., teammate running
    offline). The CSV data does NOT include new user feedback.
    """
    data_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "datasets", "ml-latest-small"
    )
    csv_path = os.path.join(data_path, "ratings.csv")
    print(f"  Loading ratings from CSV: {csv_path}")
    df = pd.read_csv(csv_path)[["userId", "movieId", "rating"]]
    print(f"  Loaded {len(df):,} ratings from CSV")
    return df


def train_svd(ratings_df: pd.DataFrame) -> SVD:
    """Train the SVD collaborative-filtering model on the provided ratings.

    SVD was chosen over KNNBaseline for production because:
    - Same NDCG accuracy on the MovieLens benchmark.
    - Scales in O(factors × iterations) rather than O(users²) — KNN must
      recompute the full user-user similarity matrix on every retrain, which
      becomes prohibitively slow as the ratings table grows.
    - 20 factors × 20 epochs produces ~0.87 RMSE on this dataset.
    """
    reader = Reader(rating_scale=(0.5, 5.0))
    data = Dataset.load_from_df(ratings_df[["userId", "movieId", "rating"]], reader)
    trainset = data.build_full_trainset()

    model = SVD(n_factors=100, n_epochs=20, lr_all=0.005, reg_all=0.02, random_state=42, verbose=True)
    model.fit(trainset)
    return model


def save_model(model: SVD) -> str:
    """Pickle the trained SVD model to models/svd_model.pkl."""
    output_path = os.path.join(MODELS_DIR, "svd_model.pkl")
    with open(output_path, "wb") as f:
        pickle.dump(model, f)
    return output_path


def run_training_pipeline(source: str = "postgres") -> str:
    """Full pipeline: load → train → save. Returns the path of the saved model.

    This function is called:
    1. Directly when running `python src/train.py` (standalone).
    2. By the FastAPI POST /api/retrain endpoint in a background thread.
    """
    print(f"\n{'='*55}")
    print("  Flicker SVD Training Pipeline")
    print(f"  Data Source: {source.upper()}")
    print(f"{'='*55}")

    # Step 1: Load
    print("\n[1/3] Loading ratings data...")
    if source == "postgres":
        ratings_df = load_ratings_from_postgres()
    else:
        ratings_df = load_ratings_from_csv()

    # Step 2: Train
    print("\n[2/3] Training SVD model (100 factors, 20 epochs)...")
    model = train_svd(ratings_df)
    print("  Training complete.")

    # Step 3: Save
    print("\n[3/3] Saving model artifact...")
    output_path = save_model(model)
    print(f"  Saved → {output_path}")

    print(f"\n✅ Pipeline complete! Model is ready for the API.\n")
    return output_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Flicker SVD Training Pipeline")
    parser.add_argument(
        "--source",
        choices=["postgres", "csv"],
        default="postgres",
        help="Data source: 'postgres' (default, includes new user feedback) or 'csv' (offline fallback)"
    )
    args = parser.parse_args()
    run_training_pipeline(source=args.source)
