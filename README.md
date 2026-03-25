# 🎬 Flicker — AI Movie Recommendation System

A full-stack, production-grade movie recommendation platform powered by a hybrid ML pipeline and an AI chatbot assistant.

---

## 🏗️ Project Structure

```
Movie-Recommendation-System/
├── backend/                    # FastAPI Python backend
│   ├── core/                   # Infrastructure (DB, Auth, Rate limiter, State)
│   │   ├── auth.py             # JWT creation, hashing, token decode
│   │   ├── database.py         # SQLAlchemy engine, session, get_current_user
│   │   ├── limiter.py          # slowapi rate limiter instance
│   │   └── state.py            # Shared in-memory ML artifacts
│   ├── services/               # Business logic
│   │   ├── chatbot.py          # Groq LLM agentic loop (Flicker AI)
│   │   └── email_service.py    # Password reset & 2FA email sender
│   ├── routers/                # API endpoint definitions
│   │   ├── auth.py             # /auth/register, /auth/login, /auth/2fa, ...
│   │   ├── chat.py             # /api/chat, /api/chat/sessions, /api/chat/transcribe
│   │   ├── movies.py           # /api/search, /api/trending, /api/recommendations/*
│   │   ├── ratings.py          # /api/ratings, /api/retrain
│   │   ├── users.py            # /api/users/me/ratings, /api/users/{id}/profile
│   │   └── watchlist.py        # /api/watchlist
│   ├── requirements.txt
│   └── main.py                 # App entrypoint, CORS, rate limit middleware
│
├── frontend/                   # ⚠️ To be implemented by frontend teammate
│
├── ml_pipeline/                # Machine Learning & Data Science
│   ├── notebooks/              # Jupyter EDA and training notebooks
│   ├── datasets/               # Raw CSVs (MovieLens ml-latest-small)
│   └── scripts/                # Training pipeline scripts
│
├── models/                     # Trained ML model artifacts
│   └── svd_model.pkl           # SVD collaborative filtering model
│
├── migrations/                 # SQL migration scripts (run manually in Neon)
├── .env                        # 🔒 Secret keys (NEVER commit)
└── README.md
```

---

## ⚙️ Tech Stack

| Layer | Technology |
|---|---|
| **Backend API** | FastAPI (Python 3.11) |
| **Database** | PostgreSQL on [Neon.tech](https://neon.tech) (serverless) |
| **ORM / Queries** | SQLAlchemy + raw SQL via `text()` |
| **Authentication** | JWT (access + refresh tokens), bcrypt, optional 2FA |
| **AI Chatbot** | Groq API — `llama-3.3-70b-versatile` with tool-calling |
| **Speech-to-Text** | Groq Whisper (`whisper-large-v3-turbo`) |
| **Text-to-Speech** | Browser Web Speech API (frontend, free) |
| **ML Model** | SVD collaborative filtering (`scikit-surprise`) |
| **Embeddings** | `pgvector` — cosine similarity for content-based reco |
| **Rate Limiting** | `slowapi` — 20 req/min on chat, 10 req/min on transcribe |
| **Email** | SMTP (Gmail) — password reset, 2FA codes, welcome email |

---

## 🚀 Backend Setup (WSL2 / Linux)

### 1. Clone & activate virtual environment
```bash
git clone https://github.com/YOUR_USERNAME/Movie-Recommendation-System.git
cd Movie-Recommendation-System
python -m venv venv_wsl
source venv_wsl/bin/activate
pip install -r backend/requirements.txt
```

### 2. Configure `.env`
```env
DATABASE_URL=postgresql://neondb_owner:<password>@<host>/neondb?sslmode=require
SECRET_KEY=your-super-secret-jwt-key
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.3-70b-versatile
EMAIL_USER=your@gmail.com
EMAIL_PASSWORD=your-app-password
FRONTEND_URL=http://localhost:3000
ADMIN_SECRET=your-retrain-secret
```

> ⚠️ **Do NOT include `&channel_binding=require`** in `DATABASE_URL` — it breaks the connection on WSL2.

### 3. Run the server
```bash
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

API docs available at: **http://localhost:8000/docs**

---

## 🤖 Recommendation System

### Hybrid Model
- **Collaborative Filtering**: SVD matrix factorization via `scikit-surprise`, trained on MovieLens ratings
- **Content-Based**: `pgvector` cosine similarity on movie embeddings stored in Neon
- **Blended Score**: `α × collab_score + (1-α) × content_score` (α = 0.7 by default)

### Endpoints
| Endpoint | Description |
|---|---|
| `GET /api/recommendations/top-picks` | Personalised picks for authenticated user |
| `GET /api/recommendations/because-you-liked` | Content-similar movies to a given film |
| `GET /api/recommendations/merge` | Shared taste recommendations for two users |
| `GET /api/trending` | Trending movies, optionally by genre/mood |
| `GET /api/search?q=...` | Title, genre, or mood semantic search |

### Manual Model Retrain
```bash
curl -X POST http://localhost:8000/api/retrain \
     -H "X-Admin-Secret: YOUR_ADMIN_SECRET"
```

---

## 💬 Flicker AI Chatbot

An agentic RAG chatbot that interprets natural language into SQL movie searches.

### Flow
1. `POST /api/chat/sessions` → creates a new conversation, returns `session_id` + welcome message
2. `POST /api/chat` with `{ "message": "...", "session_id": X }` → LLM picks genre + runs search → returns reply + movie IDs
3. `GET /api/chat/sessions` → list all past conversations
4. `GET /api/chat/sessions/{id}/history` → view full message history of a session

### Voice Input (STT)
```
POST /api/chat/transcribe   (multipart/form-data, field: "audio")
→ Returns: { "transcript": "recommend something scary" }
```
Then submit the transcript to `POST /api/chat`.

### Voice Output (TTS)
Handled entirely in the browser:
```javascript
window.speechSynthesis.speak(new SpeechSynthesisUtterance(botReply));
```

---

## 🔐 Authentication

| Endpoint | Description |
|---|---|
| `POST /auth/register` | Create account |
| `POST /auth/login` | Get access + refresh tokens |
| `POST /auth/refresh` | Refresh access token |
| `POST /auth/forgot-password` | Send reset email |
| `POST /auth/reset-password` | Reset with token from email |
| `GET /auth/me` | Get current user profile |
| `POST /auth/2fa/setup` | Enable two-factor authentication |
| `POST /auth/2fa/verify` | Verify 2FA code |

---

## 🗄️ Database Schema (Neon PostgreSQL)

Key tables:
- **`users`** — id, username, email, password_hash, is_active, 2fa fields
- **`movies`** — movie_id, title, genres, tmdb_id, embedding (pgvector)
- **`ratings`** — user_id, movie_id, rating, timestamp
- **`watchlist`** — user_id, movie_id, note, added_at
- **`conversations`** — id, user_id, title, created_at
- **`chat_history`** — id, user_id, conversation_id, role, content, tool_calls_json, created_at

---

## 🌐 Frontend (To Be Implemented)

The `frontend/` folder is reserved for the React/Next.js frontend, to be built by the frontend teammate.

**Expected integration points:**
- Call `POST /auth/login` → store JWT in memory (not localStorage for security)
- Call `POST /api/chat/sessions` on login → store `session_id`
- Pass `session_id` with every `POST /api/chat` request
- Use `GET /api/chat/sessions` to populate a conversation history sidebar
- Use `POST /api/chat/transcribe` for mic input → auto-submit transcript
- Display `GET /api/recommendations/top-picks` on the home screen

---

## 👥 Team

| Role | Contributor |
|---|---|
| ML + Backend | [@nourchachia](https://github.com/nourchachia) |
| Frontend | *(teammate — assign here)* |

---

## 📄 Dataset

[MovieLens Small](https://grouplens.org/datasets/movielens/) — 100,000 ratings, 9,000 movies, 600 users.
