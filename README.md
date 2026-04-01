# Movie Recommendation System

A full-stack movie recommendation platform built with FastAPI and React/Next.js. The system leverages both Content-Based Filtering (using genres and TF-IDF cosine similarity) and Collaborative Filtering (SVD via scikit-surprise) to provide personalized movie suggestions.

## Features
- **Personalized Recommendations:** Top picks based on user ratings and watch history.
- **Content-Based Filtering:** "Similar Movies" row using genre embeddings.
- **Collaborative Filtering:** Matrix factorization predicting user tastes.
- **Watchlist & Ratings:** Save movies to watch later, rate them, and add personal notes to track your thoughts.
- **Trending by Genre:** Dynamic rows categorized by the user's favorite genres.
- **Flicker AI Chatbot:** Context-aware AI assistant with movie keyword integration and voice responses powered by Grok Text-to-Speech (TTS).
- **Watch Together:** Tinder-like swiping to find a movie to watch with a friend, powered by combined SVD recommendation scores and real-time synchronization.

## Architecture
- **Backend:** Python (FastAPI)
- **Frontend:** Next.js (React) and Tailwind CSS
- **Database:** PostgreSQL (via Neon) with `pgvector` for embeddings
- **Machine Learning & AI:** pandas, numpy, scikit-learn, scikit-surprise (TF-IDF, SVD), SentenceTransformers, Groq/xAI API (Grok Speech-to-Text)
- **Dataset:** MovieLens Latest Small (https://grouplens.org/datasets/movielens/)
- **Real-time:** WebSockets for instant watch-together swipe matching

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
