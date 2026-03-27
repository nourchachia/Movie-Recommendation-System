"""
One-time migration: create the three tables needed for the Tinder-style
"Watch Together" swipe feature.

Run once from the project root:
    python -m backend.migrate_watch_sessions
"""
import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
DB_URL = os.getenv("DATABASE_URL")
if not DB_URL:
    raise ValueError("DATABASE_URL is not set in .env")

engine = create_engine(DB_URL, pool_pre_ping=True)

DDL = """
-- ── Watch Sessions ────────────────────────────────────────────────────────────
-- A pairing session created by one user and joined by another.
-- movie_pool is a JSON array of movie_ids pre-fetched from the group
-- recommendation endpoint so both users see the exact same card stack.
CREATE TABLE IF NOT EXISTS watch_sessions (
    id            SERIAL       PRIMARY KEY,
    code          VARCHAR(8)   UNIQUE NOT NULL,          -- human-friendly invite code e.g. "FILM4829"
    creator_id    INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guest_id      INT          REFERENCES users(id) ON DELETE SET NULL,
    status        VARCHAR(20)  NOT NULL DEFAULT 'waiting', -- waiting | active | done
    movie_pool    JSONB        NOT NULL DEFAULT '[]',    -- ordered list of movie_ids
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW() + INTERVAL '2 hours'
);

CREATE INDEX IF NOT EXISTS idx_watch_sessions_code ON watch_sessions (code);
CREATE INDEX IF NOT EXISTS idx_watch_sessions_creator ON watch_sessions (creator_id);

-- ── Session Swipes ────────────────────────────────────────────────────────────
-- One row per (user, movie) swipe inside a session.
-- UNIQUE constraint prevents double-swiping the same card.
CREATE TABLE IF NOT EXISTS session_swipes (
    id            SERIAL       PRIMARY KEY,
    session_id    INT          NOT NULL REFERENCES watch_sessions(id) ON DELETE CASCADE,
    user_id       INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    movie_id      INT          NOT NULL,
    direction     VARCHAR(5)   NOT NULL CHECK (direction IN ('left', 'right')),
    swiped_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, user_id, movie_id)
);

CREATE INDEX IF NOT EXISTS idx_session_swipes_session ON session_swipes (session_id);
CREATE INDEX IF NOT EXISTS idx_session_swipes_lookup  ON session_swipes (session_id, movie_id, direction);

-- ── Session Matches ───────────────────────────────────────────────────────────
-- Populated automatically when both users swipe right on the same movie.
CREATE TABLE IF NOT EXISTS session_matches (
    id            SERIAL       PRIMARY KEY,
    session_id    INT          NOT NULL REFERENCES watch_sessions(id) ON DELETE CASCADE,
    movie_id      INT          NOT NULL,
    matched_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, movie_id)
);

CREATE INDEX IF NOT EXISTS idx_session_matches_session ON session_matches (session_id);
"""

with engine.connect() as conn:
    conn.execute(text(DDL))
    conn.commit()
    print("✅  watch_sessions, session_swipes, session_matches — tables created successfully.")
