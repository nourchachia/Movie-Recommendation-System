import pandas as pd
import numpy as np
import pickle
import os
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from surprise import SVD, Dataset, Reader

def train_and_save():
    print("Loading data...")
    data_path = "datasets/ml-latest-small/"
    movies = pd.read_csv(os.path.join(data_path, "movies.csv"))
    ratings = pd.read_csv(os.path.join(data_path, "ratings.csv"))

    # Content-based preparation
    print("Computing Content-Based similarity...")
    movies['genres'] = movies['genres'].fillna('')
    tfidf = TfidfVectorizer(stop_words='english')
    tfidf_matrix = tfidf.fit_transform(movies['genres'])
    cosine_sim = cosine_similarity(tfidf_matrix, tfidf_matrix)

    # Collaborative filtering preparation
    print("Training SVD model...")
    reader = Reader(rating_scale=(0.5, 5.0))
    data = Dataset.load_from_df(ratings[['userId', 'movieId', 'rating']], reader)
    trainset = data.build_full_trainset()
    model = SVD()
    model.fit(trainset)

    # Saving artifacts
    print("Saving artifacts to models/...")
    os.makedirs("models", exist_ok=True)

    with open("models/cosine_sim.pkl", "wb") as f:
        pickle.dump(cosine_sim, f)
    
    with open("models/svd_model.pkl", "wb") as f:
        pickle.dump(model, f)

    movies.to_pickle("models/movies.pkl")
    ratings.to_pickle("models/ratings.pkl")

    print("Done!")

if __name__ == "__main__":
    train_and_save()
