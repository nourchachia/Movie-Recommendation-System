import pandas as pd
import numpy as np

def get_favorite_movies(ratings: pd.DataFrame, movies: pd.DataFrame, user_id: int, min_rating: float = 4.0) -> pd.DataFrame:
    """Return DataFrame of user's favorite movies (movieId, title, rating)."""
    user_ratings = ratings[ratings['userId'] == user_id]
    merged = user_ratings.merge(movies[['movieId', 'title']], on='movieId', how='left')
    favs = merged[merged['rating'] >= min_rating][['movieId', 'title', 'rating']]
    return favs.reset_index(drop=True)

def content_based_predictions(user_id: int,
                              ratings: pd.DataFrame,
                              movies: pd.DataFrame,
                              cosine_sim: np.ndarray,
                              min_rating: float = 4.0,
                              id_to_idx: dict = None) -> pd.DataFrame:
    """Predict ratings for unwatched movies using content (cosine_sim).
    
    Returns DataFrame with columns ['movieId','title','pred_rating'] sorted desc.
    """
    favs = get_favorite_movies(ratings, movies, user_id, min_rating=min_rating)
    if favs.empty:
        return pd.DataFrame(columns=['movieId', 'title', 'pred_rating'])

    if id_to_idx is None:
        id_to_idx = dict(zip(movies['movieId'].values, movies.index.values))

    all_movie_ids = movies['movieId'].values
    watched = set(ratings.loc[ratings['userId'] == user_id, 'movieId'])
    unwatched = [mid for mid in all_movie_ids if mid not in watched]

    preds = []
    for mid in unwatched:
        idx_mid = id_to_idx.get(mid)
        if idx_mid is None:
            continue
        numer = 0.0
        denom = 0.0
        for fav in favs.itertuples(index=False):
            fav_mid = fav.movieId
            fav_rating = fav.rating
            idx_fav = id_to_idx.get(fav_mid)
            if idx_fav is None:
                continue
            sim = float(cosine_sim[idx_mid, idx_fav])
            if sim > 0:
                numer += sim * fav_rating
                denom += sim
        if denom > 0:
            pred = numer / denom
        else:
            user_mean = ratings.loc[ratings['userId'] == user_id, 'rating'].mean()
            pred = user_mean if not np.isnan(user_mean) else ratings['rating'].mean()
        title = movies.loc[movies['movieId'] == mid, 'title'].values[0]
        preds.append((mid, title, pred))

    out = pd.DataFrame(preds, columns=['movieId', 'title', 'pred_rating'])
    out = out.sort_values('pred_rating', ascending=False).reset_index(drop=True)
    return out

def collaborative_predictions(user_id: int, model, ratings: pd.DataFrame, movies: pd.DataFrame) -> pd.DataFrame:
    """Use the provided model to predict est ratings for unwatched movies."""
    all_movie_ids = movies['movieId'].values
    watched = set(ratings.loc[ratings['userId'] == user_id, 'movieId'])
    unwatched = [mid for mid in all_movie_ids if mid not in watched]

    preds = []
    for mid in unwatched:
        try:
            pred = model.predict(user_id, mid)
            est = float(pred.est)
        except Exception:
            continue
        title = movies.loc[movies['movieId'] == mid, 'title'].values[0]
        preds.append((mid, title, est))

    out = pd.DataFrame(preds, columns=['movieId', 'title', 'pred_rating'])
    out = out.sort_values('pred_rating', ascending=False).reset_index(drop=True)
    return out

def hybrid_predictions(user_id: int,
                       model,
                       ratings: pd.DataFrame,
                       movies: pd.DataFrame,
                       cosine_sim: np.ndarray,
                       alpha: float = 0.7,
                       min_rating: float = 0.0,
                       top_n: int = 10) -> pd.DataFrame:
    """Combine collaborative and content predictions into a hybrid score.

    alpha: weight for collaborative (SVD) predictions.
    """
    content_df = content_based_predictions(user_id, ratings, movies, cosine_sim, min_rating=0.0)
    collab_df = collaborative_predictions(user_id, model, ratings, movies)

    merged = collab_df.merge(content_df[['movieId', 'pred_rating']], on='movieId', how='outer', suffixes=('_collab', '_content'))
    global_mean = ratings['rating'].mean()
    merged['pred_rating_collab'] = merged['pred_rating_collab'].fillna(global_mean)
    merged['pred_rating_content'] = merged['pred_rating_content'].fillna(global_mean)

    merged['pred_rating_hybrid'] = alpha * merged['pred_rating_collab'] + (1 - alpha) * merged['pred_rating_content']

    result = merged[['movieId', 'title', 'pred_rating_collab', 'pred_rating_content', 'pred_rating_hybrid']].copy()
    if min_rating > 0:
        result = result[result['pred_rating_hybrid'] >= min_rating]
    result = result.sort_values('pred_rating_hybrid', ascending=False).reset_index(drop=True)
    return result.head(top_n)
