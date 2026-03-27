import { NextResponse } from 'next/server';
import { fetchMovieDetails } from '@/lib/tmdb';

/**
 * GET /api/trailer/[tmdb_id]
 *
 * Server-side proxy that fetches movie details + trailer from TMDB.
 * Using a Route Handler keeps TMDB_API_KEY off the client entirely.
 * Cached by Next.js for 24 hours — repeated clicks are instant.
 */
export async function GET(
    _req: Request,
    { params }: { params: Promise<{ tmdb_id: string }> }
) {
    const { tmdb_id } = await params;
    const id = parseInt(tmdb_id, 10);

    if (isNaN(id) || id <= 0) {
        return NextResponse.json({ error: 'Invalid tmdb_id' }, { status: 400 });
    }

    const details = await fetchMovieDetails(id);

    return NextResponse.json(
        {
            tmdb_id: details.tmdb_id,
            title: details.title,
            tagline: details.tagline,
            overview: details.overview,
            backdropUrl: details.backdropUrl,
            posterUrl: details.posterUrl,
            runtime: details.runtime,
            releaseYear: details.releaseYear,
            voteAverage: details.voteAverage,
            tmdbGenres: details.tmdbGenres,
            trailerKey: details.trailerKey,
            trailerUrl: details.trailerUrl,
            trailerEmbed: details.trailerEmbed,
        },
        {
            headers: {
                // Cache in the browser for 1 hour, CDN for 24 hours
                'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
            },
        }
    );
}
