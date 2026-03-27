"""
backend/routers/chat.py — AI Chatbot endpoints

Endpoints:
  POST   /api/chat/sessions              → Create a new conversation session
  GET    /api/chat/sessions              → List all your past conversations
  GET    /api/chat/sessions/{sid}/history → Get all messages in a specific conversation
  DELETE /api/chat/sessions/{sid}        → Delete a specific conversation + its messages
  POST   /api/chat                       → Send a message (requires session_id in body) [rate limited]
  POST   /api/chat/transcribe            → Transcribe voice audio via Groq Whisper [rate limited]
  DELETE /api/chat/history               → Clear ALL chat history (nuclear)
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.core.database import get_db, get_current_user
from backend.core.limiter import limiter

router = APIRouter(tags=["Chat"])


# ── Pydantic Models ────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message:    str = Field(..., min_length=1, max_length=2000)
    session_id: int = Field(..., description="ID of the conversation to send this message to")


class NewSessionRequest(BaseModel):
    title: str = Field("New Conversation", max_length=120,
                       description="Optional title for the conversation")


# ── POST /api/chat/sessions ────────────────────────────────────────────────────

@router.post("/api/chat/sessions", status_code=201,
             summary="Start a new conversation session")
def create_session(
    payload: NewSessionRequest = NewSessionRequest(),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """
    Create a new conversation. Call this on login OR when the user clicks 'New Chat'.
    Returns a session_id that must be sent with every subsequent /api/chat message.
    """
    row = db.execute(
        text("""
            INSERT INTO conversations (user_id, title)
            VALUES (:uid, :title)
            RETURNING id, title, created_at
        """),
        {"uid": current_user.id, "title": payload.title}
    ).fetchone()
    db.commit()
    return {
        "session_id": row.id,
        "title":      row.title,
        "created_at": str(row.created_at),
        # Static welcome message — no Groq call needed, instant, free
        "welcome":    "Hey there! 🎬 I'm Flicker, your personal movie assistant. What are you in the mood for tonight?",
    }


# ── GET /api/chat/sessions ─────────────────────────────────────────────────────

@router.get("/api/chat/sessions", summary="List all your past conversations")
def list_sessions(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Returns all conversations for this user, newest first."""
    rows = db.execute(
        text("""
            SELECT
                c.id,
                c.title,
                c.created_at,
                COUNT(ch.id)  AS message_count,
                MAX(ch.created_at) AS last_message_at
            FROM conversations c
            LEFT JOIN chat_history ch
                ON ch.conversation_id = c.id AND ch.role IN ('user', 'assistant')
            WHERE c.user_id = :uid
            GROUP BY c.id, c.title, c.created_at
            ORDER BY c.created_at DESC
            LIMIT :limit
        """),
        {"uid": current_user.id, "limit": limit}
    ).fetchall()
    return {
        "sessions": [
            {
                "session_id":      r.id,
                "title":           r.title,
                "created_at":      str(r.created_at),
                "message_count":   r.message_count,
                "last_message_at": str(r.last_message_at) if r.last_message_at else None,
            }
            for r in rows
        ]
    }


# ── GET /api/chat/sessions/{sid}/history ──────────────────────────────────────

@router.get("/api/chat/sessions/{sid}/history",
            summary="Get all messages from a specific conversation")
def get_session_history(
    sid: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Returns the full message history for a single conversation."""
    convo = db.execute(
        text("SELECT id, title FROM conversations WHERE id = :sid AND user_id = :uid"),
        {"sid": sid, "uid": current_user.id}
    ).fetchone()
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    rows = db.execute(
        text("""
            SELECT role, content, created_at
            FROM chat_history
            WHERE conversation_id = :sid AND role IN ('user', 'assistant')
            ORDER BY created_at ASC
        """),
        {"sid": sid}
    ).fetchall()
    return {
        "session_id": sid,
        "title":      convo.title,
        "messages":   [
            {"role": r.role, "content": r.content, "created_at": str(r.created_at)}
            for r in rows
            if r.content  # Skip empty tool-call artifacts
        ]
    }


# ── DELETE /api/chat/sessions/{sid} ───────────────────────────────────────────

@router.delete("/api/chat/sessions/{sid}", status_code=200,
               summary="Delete a specific conversation and all its messages")
def delete_session(
    sid: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    convo = db.execute(
        text("SELECT id FROM conversations WHERE id = :sid AND user_id = :uid"),
        {"sid": sid, "uid": current_user.id}
    ).fetchone()
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    db.execute(text("DELETE FROM conversations WHERE id = :sid"), {"sid": sid})
    db.commit()
    return {"status": "deleted", "session_id": sid}


# ── POST /api/chat ─────────────────────────────────────────────────────────────

@router.post("/api/chat", summary="Send a message to Flicker AI")
@limiter.limit("20/minute")
def send_chat_message(
    request: Request,           # required by slowapi
    payload: ChatRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """
    Send a message in an existing conversation. Rate limited to 20 requests/minute per IP.
    session_id must be obtained from POST /api/chat/sessions.
    """
    convo = db.execute(
        text("SELECT id FROM conversations WHERE id = :sid AND user_id = :uid"),
        {"sid": payload.session_id, "uid": current_user.id}
    ).fetchone()
    if not convo:
        raise HTTPException(
            status_code=404,
            detail="Conversation not found. Create one first via POST /api/chat/sessions."
        )

    try:
        from backend.services.chatbot import chat as chatbot_chat
        return chatbot_chat(
            user_message=payload.message,
            db=db,
            user_id=current_user.id,
            session_id=payload.session_id,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Chat service error: {str(exc)}"
        )


# ── POST /api/chat/transcribe ──────────────────────────────────────────────────

@router.post("/api/chat/transcribe", summary="Transcribe voice audio via Groq Whisper")
@limiter.limit("10/minute")
def transcribe_audio(
    request: Request,           # required by slowapi
    audio: UploadFile = File(..., description="Audio file (webm, mp3, wav, m4a — max 25MB)"),
    current_user=Depends(get_current_user)
):
    """
    Accepts a browser audio recording and returns the transcript text.

    Workflow:
      1. Frontend records voice via Web Audio API → sends webm/mp3 blob here
      2. We forward it to Groq Whisper (free, ~1s latency)
      3. Return { "transcript": "..." }
      4. Frontend auto-submits the transcript to POST /api/chat

    Size limit: 25MB (Groq's hard limit for audio files).
    Rate limited to 10 transcriptions/minute per IP.
    """
    ALLOWED_TYPES = {
        "audio/webm", "audio/mp4", "audio/mpeg", "audio/wav",
        "audio/ogg", "audio/x-m4a", "audio/m4a", "application/octet-stream"
    }
    MAX_BYTES = 25 * 1024 * 1024  # 25 MB

    # Content-type check (soft — browser webm recorders vary wildly)
    if audio.content_type and audio.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported audio type: {audio.content_type}. Use webm, mp3, wav, or m4a."
        )

    audio_bytes = audio.file.read()
    if len(audio_bytes) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Audio file exceeds the 25MB limit.")
    if len(audio_bytes) == 0:
        raise HTTPException(status_code=400, detail="Audio file is empty.")

    try:
        from groq import Groq
        import io
        client = Groq(api_key=os.getenv("GROQ_API_KEY"))

        # Determine a safe filename extension for Groq
        original_name = audio.filename or "audio.webm"
        transcription = client.audio.transcriptions.create(
            model="whisper-large-v3-turbo",
            file=(original_name, io.BytesIO(audio_bytes)),
            response_format="text",
        )
        transcript = transcription.strip() if isinstance(transcription, str) else str(transcription)

        if not transcript:
            raise HTTPException(
                status_code=422,
                detail="Could not detect any speech in the audio. Please try again."
            )

        return {"transcript": transcript}

    except HTTPException:
        raise  # re-raise our own validation errors
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="Groq package not installed. Run: pip install groq"
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Transcription failed: {str(exc)}"
        )


# ── DELETE /api/chat/history ───────────────────────────────────────────────────

@router.delete("/api/chat/history", status_code=200,
               summary="Clear ALL conversations and chat history (nuclear option)")
def clear_all_chat_history(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Deletes every conversation and message for this user. Irreversible."""
    msg_result = db.execute(
        text("DELETE FROM chat_history WHERE user_id = :uid"),
        {"uid": current_user.id}
    )
    conv_result = db.execute(
        text("DELETE FROM conversations WHERE user_id = :uid"),
        {"uid": current_user.id}
    )
    db.commit()
    return {
        "status":  "cleared",
        "message": f"Deleted {conv_result.rowcount} conversation(s) and {msg_result.rowcount} messages. Fresh start! 🎬"
    }


# ── Missing import ─────────────────────────────────────────────────────────────
import os  # noqa: E402 — needed by transcribe_audio for GROQ_API_KEY