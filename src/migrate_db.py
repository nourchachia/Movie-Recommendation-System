"""
src/migrate_db.py — Base schema migration (idempotent)
=====================================================
Creates any missing tables and indexes needed by the backend.

This file is intentionally safe to run multiple times:
- Uses CREATE TABLE IF NOT EXISTS
- Uses CREATE INDEX IF NOT EXISTS

Currently includes:
- Chat tables used by `backend/routers/chat.py` and `backend/services/chatbot.py`
  - conversations
  - chat_history

Usage:
    python src/migrate_db.py

Notes:
- This script assumes the `users` table already exists because it references
  `users(id)` via foreign keys.
- One-off live-data fixes (like adding constraints / deduping) live in separate
  scripts such as `src/add_ratings_constraint.py`.
"""

import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()

DB_URL = os.getenv("DATABASE_URL")
if not DB_URL:
    raise ValueError("CRITICAL: DATABASE_URL is missing from environment variables!")

engine = create_engine(DB_URL, pool_pre_ping=True)

DDL = """
-- ── Chat: Conversations ───────────────────────────────────────────────────────
-- One row per user conversation thread (aka "session" in the API).
CREATE TABLE IF NOT EXISTS conversations (
    id          SERIAL       PRIMARY KEY,
    user_id     INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       VARCHAR(120) NOT NULL DEFAULT 'New Conversation',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_created_at
    ON conversations (user_id, created_at DESC);

-- ── Chat: Message history ─────────────────────────────────────────────────────
-- Stores user/assistant/tool messages, including tool call metadata.
CREATE TABLE IF NOT EXISTS chat_history (
    id              SERIAL       PRIMARY KEY,
    user_id         INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id INT          NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            VARCHAR(20)  NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
    content         TEXT         NOT NULL DEFAULT '',
    tool_call_id    VARCHAR(120),
    tool_calls_json TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- If chat_history already existed from an older version, it may be missing columns.
-- Ensure required columns exist before creating indexes / constraints.
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS conversation_id INT;
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS tool_call_id VARCHAR(120);
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS tool_calls_json TEXT;
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Add FK to conversations if missing (idempotent).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_chat_history_conversation'
    ) THEN
        ALTER TABLE chat_history
            ADD CONSTRAINT fk_chat_history_conversation
            FOREIGN KEY (conversation_id)
            REFERENCES conversations(id)
            ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_chat_history_conversation_created_at
    ON chat_history (conversation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_chat_history_user_created_at
    ON chat_history (user_id, created_at DESC);
"""


def main() -> None:
    with engine.connect() as conn:
        conn.execute(text(DDL))
        conn.commit()
        print("✅ Base schema migration complete (chat tables ensured).")


if __name__ == "__main__":
    main()