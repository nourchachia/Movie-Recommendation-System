# Movie Recommendation System

A full-stack movie recommendation platform built with FastAPI and React/Next.js. The system leverages both Content-Based Filtering (using genres and TF-IDF cosine similarity) and Collaborative Filtering (SVD via scikit-surprise) to provide personalized movie suggestions.

## Features
- **Personalized Recommendations:** Top picks based on user ratings and watch history.
- **Content-Based Filtering:** "Similar Movies" row using genre embeddings.
- **Collaborative Filtering:** Matrix factorization predicting user tastes.
- **Watchlist & Ratings:** Save movies to watch later and rate them to improve recommendations.
- **Trending by Genre:** Dynamic rows categorized by the user's favorite genres.

## Architecture
- **Backend:** Python (FastAPI)
- **Frontend:** Node/React (Streamlit was originally planned but replaced with a modern web frontend)
- **Machine Learning:** pandas, numpy, scikit-learn, scikit-surprise (TF-IDF, SVD, KNNBaseline)
- **Dataset:** MovieLens Latest Small (https://grouplens.org/datasets/movielens/)

## Setup Instructions

### Environment Setup
1. Clone the repository and navigate to the project root.
2. Create `.env` files in both `backend/` and `frontend/` as needed based on configuration requirements.

### Backend Development
1. Navigate to the `backend/` directory.
2. Create a virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Run the FastAPI development server:
   ```bash
   uvicorn main:app --reload
   ```

### Frontend Development
1. Navigate to the `frontend/` directory.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```

## Contribution
Check out a branch, make your changes, and create a PR to `main`. Ensure your working directory is clean of ignored packages like `node_modules` or `venv` before pushing.
