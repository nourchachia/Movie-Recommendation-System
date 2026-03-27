import os
import pickle
import asyncio

from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text

from backend.core.database import SessionLocal
from backend.core.limiter import limiter
from backend.core.state import ml_artifacts  # shared state — avoids circular imports with routers

# ==========================================================
# 2. LIFESPAN — runs once at startup and shutdown
# ==========================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    import os as _os
    base_dir = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
    model_path = _os.path.join(base_dir, "models", "svd_model.pkl")

    async def _load_model():
        try:
            model = await asyncio.to_thread(lambda: pickle.load(open(model_path, "rb")))
            ml_artifacts["svd_model"] = model
            print("✅ SVD model loaded!")
        except FileNotFoundError:
            print("⚠️  svd_model.pkl not found. Recommendation endpoints will return 503.")
        except Exception as exc:
            print(f"❌ ML model load failed: {exc}")

    async def _warmup_db():
        import os as _os
        import psycopg2
        db_url = _os.getenv("DATABASE_URL", "")
        try:
            print("🗄️  Warming up Neon DB...")
            conn = psycopg2.connect(db_url, connect_timeout=15)
            conn.close()
            print("✅ Neon DB is warm!")
        except Exception as exc:
            print(f"⚠️  DB warmup failed: {type(exc).__name__}: {exc}")

    _bg = asyncio.ensure_future(_load_model())
    _db = asyncio.ensure_future(_warmup_db())
    print("🚀 Server ready. ML load + DB warmup running in background...")

    yield

    for task in (_bg, _db):
        if not task.done():
            task.cancel()
    ml_artifacts.clear()


# ==========================================================
# 3. FASTAPI APP INITIALIZATION
# ==========================================================
app = FastAPI(
    title="Flicker API",
    description="Netflix-style Movie Recommendations",
    lifespan=lifespan,
)

# Attach limiter state + 429 error handler
app.state.limiter = limiter

@app.exception_handler(RateLimitExceeded)
async def _rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"detail": "Too many requests. Please slow down and try again shortly."},
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://127.0.0.1:3000",
        "https://flicker-movies.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def health_check():
    return {"status": "online", "message": "Flicker Backend is running via PostgreSQL."}


# ==========================================================
# 4. REGISTER ALL ROUTERS
# ==========================================================
from backend.routers import auth, movies, ratings, watchlist, users, chat  # noqa: E402

app.include_router(auth.router)
app.include_router(movies.router)
app.include_router(ratings.router)
app.include_router(watchlist.router)
app.include_router(users.router)
app.include_router(chat.router)