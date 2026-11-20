'use client';

/** Listen Now: new from artists you follow, then everything new on Concord, filterable by genre. */

import { useEffect, useState } from 'react';
import { music, type ArtistCard, type Release } from './linerApi';
import { Empty, Grid, ReleaseTile, Section, TileSkeleton } from './parts';
import { MadeForYou } from './Extras';

interface Feed { releases: Release[]; fromFollowed: Release[]; genres: string[] }

export function ListenNow({ onRelease, onArtist, onForArtists }: {
  onRelease: (id: string) => void;
  onArtist: (a: ArtistCard) => void;
  onForArtists: () => void;
}) {
  const [genre, setGenre] = useState('');
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancel = false;
    void music<Feed>('releases-new', { limit: 40, genre }).then((r) => {
      if (cancel) return;
      if (!r.ok || !r.result) { setError(r.error || 'Could not load new music.'); return; }
      setError(null);
      setFeed(r.result);
    });
    return () => { cancel = true; };
  }, [genre]);

  return (
    <div className="px-4 pb-16 pt-8 sm:px-8" data-testid="ln-listen">
      <p className="ln-eyebrow">Listen now</p>
      <h1 className="ln-serif mb-8 mt-1 text-4xl sm:text-5xl">Made by independent artists, owned by them too.</h1>

      <MadeForYou />
      {error && <Empty title="Music is not loading">{error}</Empty>}
      {!error && !feed && <TileSkeleton />}

      {feed && feed.fromFollowed.length > 0 && !genre && (
        <Section title="New from artists you follow" id="ln-followed">
          <Grid>{feed.fromFollowed.map((r) => <ReleaseTile key={r.id} release={r} onOpen={onRelease} onArtist={() => onArtist(r.artist)} />)}</Grid>
        </Section>
      )}

      {feed && (
        <Section
          title="New on Concord"
          id="ln-new"
          action={feed.genres.length > 0 ? (
            <div className="flex flex-wrap justify-end gap-1.5" role="group" aria-label="Filter by genre">
              <button type="button" onClick={() => setGenre('')} aria-pressed={!genre} className="ln-chip px-3 py-0.5 text-xs">All</button>
              {feed.genres.map((g) => <button key={g} type="button" onClick={() => setGenre(g)} aria-pressed={genre === g} className="ln-chip px-3 py-0.5 text-xs capitalize">{g}</button>)}
            </div>
          ) : undefined}
        >
          {feed.releases.length ? (
            <Grid>{feed.releases.map((r) => <ReleaseTile key={r.id} release={r} onOpen={onRelease} onArtist={() => onArtist(r.artist)} />)}</Grid>
          ) : (
            <Empty title="The shelves are empty, for now">
              Nobody has released anything{genre ? ` in ${genre}` : ''} yet. Be first: <button type="button" onClick={onForArtists} className="ln-link font-semibold text-[color:var(--ln-accent)]">release your music</button>.
            </Empty>
          )}
        </Section>
      )}
    </div>
  );
}
