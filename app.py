import streamlit as st
import pandas as pd
import numpy as np
import pickle
import os
from src.recommender import hybrid_predictions, collaborative_predictions, content_based_predictions

# Page config
st.set_page_config(page_title="Flicker - Find your spark.", layout="wide")

# Custom CSS for rich aesthetics
st.markdown("""
    <style>
    .main {
        background-color: #0e1117;
        color: #ffffff;
    }
    .stButton>button {
        background-color: #e50914;
        color: white;
        border-radius: 5px;
        border: none;
        padding: 10px 20px;
        font-weight: bold;
    }
    .stButton>button:hover {
        background-color: #ff0a16;
        color: white;
    }
    .movie-card {
        background-color: #1f2937;
        padding: 15px;
        border-radius: 10px;
        border: 1px solid #374151;
        margin-bottom: 10px;
    }
    .rating-badge {
        background-color: #f59e0b;
        color: black;
        padding: 2px 8px;
        border-radius: 4px;
        font-weight: bold;
    }
    </style>
    """, unsafe_allow_html=True)

@st.cache_resource
def load_artifacts():
    try:
        with open("models/cosine_sim.pkl", "rb") as f:
            cosine_sim = pickle.load(f)
        with open("models/svd_model.pkl", "rb") as f:
            svd_model = pickle.load(f)
        movies = pd.read_pickle("models/movies.pkl")
        ratings = pd.read_pickle("models/ratings.pkl")
        return cosine_sim, svd_model, movies, ratings
    except FileNotFoundError:
        return None, None, None, None

def main():
    st.title("🎬 Flicker")
    st.subheader("Find your spark. (Hybrid Recommender)")

    cosine_sim, svd_model, movies, ratings = load_artifacts()

    if movies is None:
        st.error("Les modèles ne sont pas encore entraînés. Veuillez lancer 'python src/train.py' d'abord.")
        return

    # Sidebar for parameters
    st.sidebar.header("Configuration")
    user_id = st.sidebar.number_input("Entrez votre User ID", min_value=1, max_value=int(ratings['userId'].max()), value=1)
    top_n = st.sidebar.slider("Nombre de recommandations", 5, 20, 10)
    alpha = st.sidebar.slider("Poids Collaboratif (Hybrid)", 0.0, 1.0, 0.7)

    # User favorites
    st.write(f"### 🍿 Vos films préférés (User {user_id})")
    user_ratings = ratings[ratings['userId'] == user_id].sort_values('rating', ascending=False)
    fav_movies = user_ratings.merge(movies, on='movieId').head(5)
    
    cols = st.columns(5)
    for i, (_, row) in enumerate(fav_movies.iterrows()):
        with cols[i]:
            st.markdown(f"""
                <div class="movie-card">
                    <p style='font-size: 0.9em; font-weight: bold;'>{row['title']}</p>
                    <span class="rating-badge">⭐ {row['rating']}</span>
                </div>
            """, unsafe_allow_html=True)

    # Recommendation tabs
    tab1, tab2, tab3 = st.tabs(["🔥 Hybride (Recommandé)", "👥 Collaboratif (SVD)", "📜 Basé sur le contenu"])

    with tab1:
        st.write("### Recommandations Hybrides")
        st.info("Combine vos goûts personnels avec les tendances de films similaires.")
        recommendations = hybrid_predictions(user_id, svd_model, ratings, movies, cosine_sim, alpha=alpha, top_n=top_n)
        
        for _, row in recommendations.iterrows():
            with st.expander(f"{row['title']}"):
                col1, col2 = st.columns([3, 1])
                with col1:
                    st.write(f"**Score de confiance :** {row['pred_rating_hybrid']:.2f}/5")
                    st.write("*Pourquoi ce film ?* Ce film correspond à la fois à vos habitudes (Collaboratif: {row['pred_rating_collab']:.2f}) et ressemble aux genres que vous aimez (Contenu: {row['pred_rating_content']:.2f}).")
                with col2:
                    st.button("Détails", key=f"hybrid_{row['movieId']}")

    with tab2:
        st.write("### Collaborative Filtering (SVD)")
        collab_recs = collaborative_predictions(user_id, svd_model, ratings, movies).head(top_n)
        st.table(collab_recs[['title', 'pred_rating']])

    with tab3:
        st.write("### Content-Based Recommendations")
        content_recs = content_based_predictions(user_id, ratings, movies, cosine_sim).head(top_n)
        st.table(content_recs[['title', 'pred_rating']])

    # Trends Section
    st.divider()
    st.write("### 📈 Films Populaires en ce moment")
    trend_movies = ratings.groupby('movieId').agg({'rating': ['count', 'mean']})
    trend_movies.columns = ['num_ratings', 'avg_rating']
    trend_movies = trend_movies[trend_movies['num_ratings'] > 50].sort_values('avg_rating', ascending=False).head(10)
    trend_movies = trend_movies.merge(movies, on='movieId')
    
    st.dataframe(trend_movies[['title', 'avg_rating', 'num_ratings']], hide_index=True)

if __name__ == "__main__":
    main()
