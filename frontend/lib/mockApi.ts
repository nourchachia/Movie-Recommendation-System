/**
 * Mock API — simulates what the real FastAPI backend will return.
 *
 * Key change: movies now carry a `tmdb_id` (not a poster URL).
 * The poster URL is resolved separately by lib/tmdb.ts (server-side).
 */

export interface Movie {
    movie_id: number;
    title: string;
    year: number;
    genres: string[];
    match_score: number;
    tmdb_id: number;       // ← backend provides this; frontend fetches poster from TMDB
    rating?: number;
    runtime?: string;
    description?: string;
}

export interface MovieRow {
    row_title: string;
    movies: Movie[];
}

export interface FeaturedMovie extends Movie {
    runtime: string;
    description: string;
    ai_reason: string;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Featured / Hero ───────────────────────────────────────────────────────
export async function fetchFeatured(): Promise<FeaturedMovie> {
    await delay(200);
    return {
        movie_id: 102,
        tmdb_id: 157336,           // Interstellar
        title: "Interstellar",
        year: 2014,
        runtime: "2h 49m",
        genres: ["Sci-Fi", "Drama", "Adventure"],
        match_score: 98,
        rating: 8.7,
        description:
            "A team of explorers travel through a wormhole in space in an attempt to ensure humanity's survival.",
        ai_reason:
            "Based on your love for mind-bending sci-fi and Christopher Nolan's work",
    };
}

// ─── Top Picks (Hybrid) ────────────────────────────────────────────────────
export async function fetchTopPicks(_userId: number = 1): Promise<MovieRow> {
    await delay(300);
    return {
        row_title: "Top Picks for You",
        movies: [
            { movie_id: 201, tmdb_id: 155, title: "The Dark Knight", year: 2008, genres: ["Action", "Crime"], match_score: 97, rating: 9.0 },
            { movie_id: 202, tmdb_id: 27205, title: "Inception", year: 2010, genres: ["Sci-Fi", "Thriller"], match_score: 95, rating: 8.8 },
            { movie_id: 203, tmdb_id: 496243, title: "Parasite", year: 2019, genres: ["Drama", "Thriller"], match_score: 93, rating: 8.6 },
            { movie_id: 204, tmdb_id: 238, title: "The Godfather", year: 1972, genres: ["Crime", "Drama"], match_score: 92, rating: 9.2 },
            { movie_id: 205, tmdb_id: 680, title: "Pulp Fiction", year: 1994, genres: ["Crime", "Drama"], match_score: 90, rating: 8.9 },
            { movie_id: 206, tmdb_id: 603, title: "The Matrix", year: 1999, genres: ["Sci-Fi", "Action"], match_score: 89, rating: 8.7 },
            { movie_id: 207, tmdb_id: 244786, title: "Whiplash", year: 2014, genres: ["Drama", "Music"], match_score: 87, rating: 8.5 },
            { movie_id: 208, tmdb_id: 872585, title: "Oppenheimer", year: 2023, genres: ["Biography", "Drama"], match_score: 86, rating: 8.4 },
            { movie_id: 209, tmdb_id: 530385, title: "1917", year: 2019, genres: ["War", "Drama"], match_score: 84, rating: 8.3 },
            { movie_id: 210, tmdb_id: 438631, title: "Dune", year: 2021, genres: ["Sci-Fi", "Adventure"], match_score: 83, rating: 8.0 },
        ],
    };
}

// ─── Trending Now ──────────────────────────────────────────────────────────
export async function fetchTrending(): Promise<MovieRow> {
    await delay(300);
    return {
        row_title: "Trending Now",
        movies: [
            { movie_id: 301, tmdb_id: 693134, title: "Dune: Part Two", year: 2024, genres: ["Sci-Fi", "Adventure"], match_score: 91, rating: 8.5 },
            { movie_id: 302, tmdb_id: 792307, title: "Poor Things", year: 2023, genres: ["Comedy", "Drama"], match_score: 88, rating: 8.1 },
            { movie_id: 303, tmdb_id: 742660, title: "The Zone of Interest", year: 2023, genres: ["Drama", "History"], match_score: 85, rating: 7.9 },
            { movie_id: 304, tmdb_id: 841742, title: "Past Lives", year: 2023, genres: ["Drama", "Romance"], match_score: 84, rating: 7.9 },
            { movie_id: 305, tmdb_id: 466420, title: "Killers of the Flower Moon", year: 2023, genres: ["Crime", "Drama"], match_score: 82, rating: 7.7 },
            { movie_id: 306, tmdb_id: 753342, title: "Napoleon", year: 2023, genres: ["Biography", "Drama"], match_score: 78, rating: 6.5 },
            { movie_id: 307, tmdb_id: 346698, title: "Barbie", year: 2023, genres: ["Comedy", "Fantasy"], match_score: 79, rating: 6.9 },
            { movie_id: 308, tmdb_id: 575264, title: "Mission: Impossible", year: 2023, genres: ["Action", "Thriller"], match_score: 82, rating: 7.7 },
            { movie_id: 309, tmdb_id: 840430, title: "The Holdovers", year: 2023, genres: ["Comedy", "Drama"], match_score: 86, rating: 7.9 },
            { movie_id: 310, tmdb_id: 915935, title: "Anatomy of a Fall", year: 2023, genres: ["Drama", "Mystery"], match_score: 87, rating: 7.8 },
        ],
    };
}

// ─── Because You Liked ─────────────────────────────────────────────────────
export async function fetchBecauseYouLiked(
    movieId: number,
    movieTitle: string
): Promise<MovieRow> {
    await delay(300);

    const pools: Record<number, Movie[]> = {
        102: [ // Interstellar → space/mind-bending sci-fi
            { movie_id: 401, tmdb_id: 49047, title: "Gravity", year: 2013, genres: ["Sci-Fi", "Thriller"], match_score: 94 },
            { movie_id: 402, tmdb_id: 286217, title: "The Martian", year: 2015, genres: ["Sci-Fi", "Drama"], match_score: 92 },
            { movie_id: 403, tmdb_id: 419430, title: "Ad Astra", year: 2019, genres: ["Sci-Fi", "Drama"], match_score: 88 },
            { movie_id: 404, tmdb_id: 329865, title: "Arrival", year: 2016, genres: ["Sci-Fi", "Drama"], match_score: 95 },
            { movie_id: 405, tmdb_id: 62, title: "2001: A Space Odyssey", year: 1968, genres: ["Sci-Fi"], match_score: 90 },
            { movie_id: 406, tmdb_id: 686, title: "Contact", year: 1997, genres: ["Sci-Fi", "Drama"], match_score: 87 },
            { movie_id: 407, tmdb_id: 41515, title: "Moon", year: 2009, genres: ["Sci-Fi", "Drama"], match_score: 85 },
            { movie_id: 408, tmdb_id: 310131, title: "Annihilation", year: 2018, genres: ["Sci-Fi", "Horror"], match_score: 83 },
            { movie_id: 409, tmdb_id: 264660, title: "Ex Machina", year: 2014, genres: ["Sci-Fi", "Thriller"], match_score: 89 },
            { movie_id: 410, tmdb_id: 335984, title: "Blade Runner 2049", year: 2017, genres: ["Sci-Fi", "Drama"], match_score: 91 },
        ],
        201: [ // The Dark Knight → crime/thriller
            { movie_id: 501, tmdb_id: 272, title: "Batman Begins", year: 2005, genres: ["Action", "Crime"], match_score: 93 },
            { movie_id: 502, tmdb_id: 49026, title: "The Dark Knight Rises", year: 2012, genres: ["Action", "Crime"], match_score: 88 },
            { movie_id: 503, tmdb_id: 263115, title: "Logan", year: 2017, genres: ["Action", "Drama"], match_score: 86 },
            { movie_id: 504, tmdb_id: 475557, title: "Joker", year: 2019, genres: ["Crime", "Drama"], match_score: 84 },
            { movie_id: 505, tmdb_id: 949, title: "Heat", year: 1995, genres: ["Crime", "Drama"], match_score: 90 },
            { movie_id: 506, tmdb_id: 6977, title: "No Country for Old Men", year: 2007, genres: ["Crime", "Drama"], match_score: 89 },
            { movie_id: 507, tmdb_id: 146233, title: "Prisoners", year: 2013, genres: ["Crime", "Thriller"], match_score: 87 },
            { movie_id: 508, tmdb_id: 4147, title: "Zodiac", year: 2007, genres: ["Crime", "Drama"], match_score: 85 },
            { movie_id: 509, tmdb_id: 807, title: "Se7en", year: 1995, genres: ["Crime", "Thriller"], match_score: 91 },
            { movie_id: 510, tmdb_id: 317557, title: "Sicario", year: 2015, genres: ["Crime", "Thriller"], match_score: 88 },
        ],
    };

    const movies = pools[movieId] ?? pools[102];
    return { row_title: `Because you liked ${movieTitle}`, movies };
}
