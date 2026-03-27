import { fetchFeatured } from '@/lib/mockApi';
import { fetchBackdropUrl } from '@/lib/tmdb';
import HomeContent from '@/components/HomeContent';

export default async function HomePage() {
  // Only fetch the featured movie backdrop server-side.
  // All movie rows (trending, top-picks, etc.) self-fetch on the client
  // via MovieRow's endpoint prop — no server-side movie list needed.
  const featured = await fetchFeatured();
  const backdropUrl = await fetchBackdropUrl(featured.tmdb_id);

  return <HomeContent featured={featured} backdropUrl={backdropUrl} />;
}
