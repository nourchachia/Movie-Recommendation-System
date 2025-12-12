Movie-Recommendation-System

1-choix du dataset: https://grouplens.org/datasets/movielens/ (ml-latest-small.zip)

2- Document de spécifications fonctionnelles :

Objectif : recommander films via hybride (content + collaborative).



Entrées : tables users, movies, ratings, (optionnel : tags, genome-scores).



Cas d’usage :



Reco « similar movies » (content-based) : on compare avec le genre et le contenu des filmes entre eux



Reco « top-K personnalisées » (collaborative: on compare les gouts des gens / SVD)



Cold-start (nouvel utilisateur / nouveau film) : fallback content-based



Critères de succès / métriques : précision@K, recall@K, NDCG, RMSE pour prédiction de note.



Architecture (proposition) : Python backend (FastAPI) + modèle entraîné (pickle) + DB PostgreSQL/pgvector pour embeddings + UI Streamlit.



Plan de livrables \& échéances : dataset, EDA, modèle baseline (cosine TF-IDF), modèle collab (SVD Surprise), UI Streamlit, rapport. (Mets ces items dans un doc Word / Markdown.)



📦 Required Packages

This project uses the following Python libraries:



pandas — data manipulation

numpy — numerical operations

scikit-learn — ML algorithms (TF-IDF, KNN, etc.)

scikit-surprise — collaborative filtering (SVD, KNNBaseline) ///depuis conda-forge

matplotlib — visualizations for EDA

streamlit — simple web interface for the recommender demo


