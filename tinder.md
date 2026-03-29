This is a great feature but it has real technical complexity because of the real-time synchronization requirement. Here's the full implementation breakdown:

🃏 Tinder-Style Swipe — Implementation Steps
The Core Challenge
The hard part isn't the swipe UI — it's detecting that both users swiped right on the same movie in real-time and instantly triggering the match on both their screens. This requires WebSockets, not regular REST calls.

🗄️ Step 1 — Database (New Tables)
You need 3 new tables:

sql
-- A watch-together session between 2+ users
CREATE TABLE watch_sessions (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR(8) UNIQUE NOT NULL,   -- e.g. "FILM4829" (invite code)
    creator_id  INT REFERENCES users(id),
    guest_id    INT REFERENCES users(id),     -- NULL until guest joins
    status      VARCHAR(20) DEFAULT 'waiting', -- waiting | active | done
    movie_pool  JSONB,                        -- pre-fetched movie list (movie_ids)
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
-- Every swipe each user makes
CREATE TABLE session_swipes (
    id         SERIAL PRIMARY KEY,
    session_id INT REFERENCES watch_sessions(id),
    user_id    INT REFERENCES users(id),
    movie_id   INT REFERENCES movies(movie_id),
    direction  VARCHAR(5) NOT NULL,           -- 'right' | 'left'
    swiped_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(session_id, user_id, movie_id)     -- can't swipe same movie twice
);
-- Matches (both users swiped right)
CREATE TABLE session_matches (
    id         SERIAL PRIMARY KEY,
    session_id INT REFERENCES watch_sessions(id),
    movie_id   INT REFERENCES movies(movie_id),
    matched_at TIMESTAMPTZ DEFAULT NOW()
);
🖥️ Step 2 — Backend: REST Endpoints
These are straightforward FastAPI additions:

Endpoint	What it does
POST /api/sessions	Creator starts session → generates code, calls your existing /group endpoint to build the movie pool, stores it
POST /api/sessions/{code}/join	Guest joins → sets guest_id, status → active
GET /api/sessions/{code}	Polls session state (waiting → active)
POST /api/sessions/{code}/swipe	Records swipe, checks if it's a match, returns {"match": true/false}
GET /api/sessions/{code}/matches	Get full list of matched movies
The key logic in the swipe endpoint:

python
@app.post("/api/sessions/{code}/swipe")
def record_swipe(code: str, movie_id: int, direction: str, ...):
    # 1. Save swipe to DB
    db.execute(INSERT INTO session_swipes ...)
    # 2. Check if BOTH users swiped right on this movie
    if direction == "right":
        other_swipe = db.execute(
            "SELECT 1 FROM session_swipes WHERE session_id=:sid 
             AND movie_id=:mid AND direction='right' AND user_id != :uid"
        ).fetchone()
        if other_swipe:
            # IT'S A MATCH — save to session_matches
            db.execute(INSERT INTO session_matches ...)
            # Notify via WebSocket (Step 3)
            broadcast_match(code, movie_id)
            return {"match": True, "movie_id": movie_id}
    return {"match": False}
⚡ Step 3 — Backend: WebSocket (the hard part)
This is what makes the match feel instant on both screens:

python
# In-memory connection manager (works for single server)
class SessionManager:
    def __init__(self):
        self.rooms: dict[str, list[WebSocket]] = {}
    async def connect(self, code: str, ws: WebSocket):
        await ws.accept()
        self.rooms.setdefault(code, []).append(ws)
    async def broadcast_match(self, code: str, movie_id: int):
        for ws in self.rooms.get(code, []):
            await ws.send_json({"event": "match", "movie_id": movie_id})
manager = SessionManager()
@app.websocket("/ws/sessions/{code}")
async def session_ws(code: str, ws: WebSocket):
    await manager.connect(code, ws)
    try:
        while True:
            await ws.receive_text()  # keep connection alive
    except WebSocketDisconnect:
        manager.rooms[code].remove(ws)
⚠️ Production note: The in-memory SessionManager only works if both users hit the same server instance. For multi-instance production deployments (e.g. Railway, Render with multiple workers), you'd need Redis Pub/Sub as a message broker between instances. For a demo/MVP, the in-memory version is perfectly fine.

🎨 Step 4 — Frontend: Swipe Card UI
A card stack using CSS transforms:

[ Movie 3 ]  ← back (small, slightly rotated)
 [ Movie 2 ] ← middle
  [ Movie 1] ← front (full size, draggable)
Desktop: Left/Right arrow buttons + keyboard shortcuts
Mobile: Touch drag → rotate card based on drag direction, release to commit
Libraries: react-spring or framer-motion for the physics animations (already likely in your Next.js setup)
Each card shows: movie poster, title, genres, match score from the group recommendation pool.

🎉 Step 5 — Frontend: Match Animation
When the WebSocket fires {"event": "match", "movie_id": 123}:

┌─────────────────────────────────┐
│   ✨  IT'S A MATCH!  ✨          │
│                                  │
│      [Movie Poster]              │
│      Inception (2010)            │
│                                  │
│  [Add to Watchlist] [Watch Now]  │
└─────────────────────────────────┘
     confetti raining down 🎊
Full-screen overlay with a scale-in + confetti animation. Both users see this simultaneously because both are connected to the same WebSocket room.

📋 Implementation Order
1. DB tables                         (~30 min)
2. REST endpoints (create/join/swipe) (~1 hr)
3. WebSocket broadcast               (~1 hr)
4. Frontend: session create + join flow (~1 hr)
5. Frontend: swipe card UI           (~2-3 hrs, most design work)
6. Frontend: WebSocket listener      (~30 min)
7. Frontend: Match animation         (~1 hr)
Total: ~8 hours of focused work. The swipe card UI is the most time-consuming part, and the WebSocket is the trickiest to get right. Everything else builds on what you already have.

Want me to start implementing any of these steps?