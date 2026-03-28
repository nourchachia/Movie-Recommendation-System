# 🎬 Flicker — Team Workflow Plan (Netflix Style)

This document outlines how Teammate A (Backend) and Teammate B (Frontend) will divide the work to build **Flicker** simultaneously.

## 🤝 Pre-Split: Do this together first (1 Hour)

Before splitting up, you must agree on how the frontend and backend talk to each other.

- [x] **Run the ML Training Pipeline:** Run `python src/train.py` to generate the `models/` folder. The backend cannot serve predictions if these files don't exist.
- [x] **Define the API Contract:** See exactly what JSON the APIs will return (Documented in [implementation_plan.md](file:///C:/Users/ASUS/.gemini/antigravity/brain/a2c140cc-2142-46d6-b40b-d039d80e83e2/implementation_plan.md)).
- [ ] **Initialize the Repositories:**
  - Scaffold the FastAPI app (`mkdir backend`)
  - Scaffold the Next.js app (`npx create-next-app@latest frontend`)

---

## 💻 Teammate A: Backend (FastAPI & ML)

**Focus:** Build the API that serves the Netflix-style rows (Trending, "Because you liked...", "Top Picks for You").

### Step 1: Set up FastAPI Foundation
- [ ] Install FastAPI and Uvicorn (`pip install fastapi uvicorn`)
- [ ] Create `backend/main.py`
- [ ] Setup CORS middleware so the Next.js frontend (running on `localhost:3000`) can make requests.
- [ ] Create a startup event to load the pickle models from `models/` into memory.

### Step 2: Implement Netflix-Style Endpoints (See Contract in Implementation Plan)
- [ ] `GET /api/users/{user_id}/favorites` — Fetch the user's top-rated movies to use as anchor points.
- [ ] `GET /api/recommendations/top-picks` — The main "For You" row (hybrid_predictions).
- [ ] `GET /api/recommendations/because-you-liked` — The "Because you watched X..." row (content-based predictions anchored to a specific movie).
- [ ] `GET /api/trending` — The "Trending Now" row (recent highest rated + most rated).

### Step 3: Enhance ML (Project Requirements)
- [ ] Add the NDCG metric to [src/evaluate.py](file:///c:/Users/ASUS/Desktop/projects2025/Movie-Recommendation-System/src/evaluate.py).
- [ ] Add Semantic Search (search movies by typing concepts, using TF-IDF or embeddings).
- [ ] Set up PostgreSQL with `pgvector` to store movie embeddings instead of using pickle files.

---

## 🎨 Teammate B: Frontend (Next.js)

**Focus:** Build the "Netflix for Movies" UI with horizontal scrolling rows. You don't need the backend to be finished to start; use "mock" data (fake JSON) while Teammate A builds the real API.

### Step 1: Project Setup & UI Foundation
- [ ] Set up Next.js with Tailwind CSS (`npx create-next-app@latest frontend`).
- [ ] Define the brand theme variables: Deep black backgrounds (`bg-black`), Neon orange/red accents (`text-orange-500`) for the Flicker aesthetic.
- [ ] Create a Layout with a fixed navigation bar (Search, Profiles) and a dark main content area.

### Step 2: Build Fake Data (Mocking)
- [ ] Create a `lib/mockData.ts` file containing exactly the JSON structure agreed upon in [implementation_plan.md](file:///C:/Users/ASUS/.gemini/antigravity/brain/a2c140cc-2142-46d6-b40b-d039d80e83e2/implementation_plan.md).

### Step 3: Build UI Components
- [ ] **MovieCard:** Vertical poster style. Needs an image placeholder, title, and a "Match %" derived from the prediction score. Includes hover animations.
- [ ] **MovieRow:** The core Netflix component. A horizontal scrolling container that takes a `title` (e.g., "Trending Now") and an array of `MovieCard` components.

### Step 4: Build Pages
- [ ] **Home / Dashboard:** Use the mock data to stack multiple `MovieRow` components:
  1.  Hero Banner (Featured movie)
  2.  Row 1: "Top Picks for You" (Hybrid)
  3.  Row 2: "Trending Now"
  4.  Row 3: "Because you liked [Favorite Movie 1]" (Content-based)
  5.  Row 4: "Because you liked [Favorite Movie 2]" (Content-based)

### Step 5: Integration
- [ ] Once Teammate A has the core endpoints ready, build a data-fetching layer to replace the mock data with real `fetch()` calls to `http://localhost:8000/api/...`.
# 🎬 Flicker — Implementation Plan & API Contracts

This is the technical blueprint defining exactly how the Next.js Frontend and FastAPI Backend will push and pull data to create a "Netflix-style" interface.

---

## 🔌 Precise API Contracts

The backend must implement these exact routes returning this exact JSON structure so the frontend can build horizontal "Netflix Rows" seamlessly.

### 1. `GET /api/recommendations/top-picks`
**Purpose:** Provides the primary "Top Picks For You" row (Hybrid Model).
**Input (Query Params):**
*   `user_id` (int): ID of the currently logged-in user.
*   `limit` (int, default=10): Number of movies to return.
*   `alpha` (float, default=0.7): Weight given to collaborative filtering.

**Output (JSON):**
```json
{
  "row_title": "Top Picks for You",
  "movies": [
    {
      "movie_id": 1225,
      "title": "Amadeus (1984)",
      "genres": ["Drama"],
      "match_score": 98,  // pred_rating_hybrid normalized to 0-100
      "collab_score": 5.0,
      "content_score": 4.54
    },
    // ... 9 more movies
  ]
}
```

### 2. `GET /api/recommendations/because-you-liked`
**Purpose:** Provides a row based off a specific movie the user already highly rated (Content-Based Model). The UI will call this multiple times for different favorite movies to create rows like "Because you liked The Matrix".
**Input (Query Params):**
*   `movie_id` (int): ID of the anchor movie.
*   `limit` (int, default=10): Number of movies to return.

**Output (JSON):**
```json
{
  "row_title": "Because you liked Toy Story",
  "anchor_movie_id": 1,
  "movies": [
    {
      "movie_id": 3114,
      "title": "Toy Story 2 (1999)",
      "genres": ["Adventure", "Animation", "Children", "Comedy", "Fantasy"],
      "match_score": 95, // pred_rating normalized to 0-100
      "similarity_score": 0.89  // from cosine_sim matrix
    },
    // ... 9 more movies
  ]
}
```

### 3. `GET /api/trending`
**Purpose:** Provides the "Trending Now" row based on recent top ratings.
**Input (Query Params):**
*   [mode](file:///c:/Users/ASUS/Desktop/projects2025/Movie-Recommendation-System/src/evaluate.py#45-88) (string, default='combined'): 'count', 'mean', or 'combined'.
*   `limit` (int, default=10).

**Output (JSON):**
```json
{
  "row_title": "Trending Now",
  "movies": [
    {
      "movie_id": 56782,
      "title": "There Will Be Blood (2007)",
      "genres": ["Drama"],
      "trending_score": 12.5
    },
    // ... 9 more movies
  ]
}
```

### 4. `GET /api/users/{user_id}/favorites`
**Purpose:** Gets the user's top-rated movies. The frontend uses this to decide which `movie_id`s to pass into the `/because-you-liked` endpoint.
**Input (Path Param):** `user_id`
**Output (JSON):** Array of movie objects the user rated >= 4.0.

---

## 🎨 Frontend Architecture (Next.js)

The UI will be built as a series of stacked, horizontally scrolling carousels.

### Component Tree
```
app/page.tsx (Main Dashboard)
 ├── Navbar (Search, Profile selector)
 ├── HeroBanner (Featured trending movie w/ big background image)
 ├── MovieRow (title="Top Picks for You", data=/api/recommendations/top-picks)
 │    ├── MovieCard
 │    ├── MovieCard
 │    └── ...
 ├── MovieRow (title="Trending Now", data=/api/trending)
 │    ├── MovieCard
 │    └── ...
 ├── MovieRow (title="Because you liked X", data=/api/recommendations/because-you-liked?movie_id=X)
 │    ├── MovieCard
 │    └── ...
```

### Mocking Strategy (For Teammate B)
While Teammate A builds the real FastAPI backend, Teammate B will create a file `frontend/lib/mockApi.ts`. This file will export functions like `fetchTopPicks()` that return the exact JSON structures defined in the API contracts section above, wrapped in a native `Promise` to simulate network latency.

---

## Verification Plan
1. **Teammate A (Backend):** Create `backend/main.py`. Start `uvicorn backend.main:app --reload`. Test the 4 specific endpoints via `http://localhost:8000/docs` to verify the JSON output exactly matches the contract.
2. **Teammate B (Frontend):** Build the UI using only `mockApi.ts`. Ensure horizontal scrolling works, hover states trigger properly, and the UI looks premium (dark theme).
3. **Integration:** Replace `mockApi.ts` calls with real `fetch()` calls to `http://localhost:8000/api/...`. Change the user ID and verify that all rows (Top Picks, Because you liked) update dynamically.
