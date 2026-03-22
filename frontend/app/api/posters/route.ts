import { NextRequest, NextResponse } from 'next/server';
import { fetchPosterUrl } from '@/lib/tmdb';

/**
 * GET /api/posters?ids=862,157336,27205,...
 *
 * Batch server-side poster resolver. MovieRow calls this once with all
 * tmdb_ids in a row, gets back a { [tmdb_id]: posterUrl } map, then swaps
 * the picsum placeholders for real TMDB poster images.
 *
 * Keeping TMDB_API_KEY server-side only — never sent to the browser.
 * Cached by Next.js for 24 hours, so repeat visits are instant.
 */
export async function GET(req: NextRequest) {
    const raw = req.nextUrl.searchParams.get('ids') ?? '';
    const tmdbIds = raw.split(',').map(Number).filter((n) => n > 0 && !isNaN(n));

    if (tmdbIds.length === 0) {
        return NextResponse.json({});
    }

    // Fetch all poster URLs in parallel (each is independently cached by tmdb.ts)
    const urls = await Promise.all(tmdbIds.map((id) => fetchPosterUrl(id)));

    const result: Record<number, string> = {};
    tmdbIds.forEach((id, i) => { result[id] = urls[i]; });

    return NextResponse.json(result, {
        headers: {
            'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
        },
    });
}
