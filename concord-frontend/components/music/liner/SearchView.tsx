'use client';

/** Search the Concord catalogue: releases, songs and artists, as you type. */

import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { fmtDuration, music, toPlayerTrack, type ArtistCard, type Release, type ReleaseTrack } from './linerApi';
import { Cover, Empty, Grid, ReleaseTile, Section } from './parts';
import { playQueue } from './play';
import { OpenWeb } from './Extras';

interface Results {
  releases: Release[];
  tracks: Array<ReleaseTrack & { releaseId: string; releaseTitle: string; coverUrl: string | null; artist: ArtistCard }>;
  artists: ArtistCard[];
}

export function SearchView({ initial, onQuery, onRelease, onArtist }: {
  initial: string;
  onQuery: (q: string) => void;
  onRelease: (id: string) => void;
  onArtist: (a: ArtistCard) => void;
}) {
  const [q, setQ] = useState(initial);
  const [res, setRes] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const term = q.trim();
    onQuery(term);
    if (!term) { setRes(null); setError(null); return; }
    const my = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      void music<Results>('catalog-search', { q: term }).then((r) => {
        if (my !== seq.current) return;
        setLoading(false);
        if (!r.ok || !r.result) { setError(r.error || 'Search failed.'); return; }
        setError(null);
        setRes(r.result);
      });
    }, 180);
    return () => clearTimeout(t);
  }, [q, onQuery]);

  const playSong = (i: number) => {
    if (!res) return;
    const tracks = res.tracks.map((t, idx) => {
      const rel = { id: t.releaseId, title: t.releaseTitle, coverUrl: t.coverUrl, artist: t.artist, genre: null, releaseDate: '', publishedAt: null, remixes: [], remixOf: [] } as unknown as Release;
      return toPlayerTrack(rel, t, idx);
    });
    playQueue(tracks, i);
  };
  const empty = res && !res.releases.length && !res.tracks.length && !res.artists.length;

  return (
    <div className="px-4 pb-16 pt-8 sm:px-8" data-testid="ln-search">
      <label className="relative mb-8 block max-w-2xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[color:var(--ln-muted)]" aria-hidden />
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} maxLength={80} placeholder="Artists, songs, releases, genres" aria-label="Search music" className="ln-input h-12 w-full pl-10 pr-4 text-base" data-testid="ln-search-input" />
      </label>
      {!q.trim() && <Empty title="Find something new">Search every release on Concord by title, artist or genre.</Empty>}
      {loading && !res && <p className="text-sm text-[color:var(--ln-muted)]" role="status">Searching…</p>}
      {error && <Empty title="Search is not working">{error}</Empty>}
      {empty && <Empty title={`Nothing for “${q.trim()}”`}>Try an artist name, a genre, or fewer words.</Empty>}
      {res && res.artists.length > 0 && (
        <Section title="Artists" id="ln-s-artists">
          <ul className="flex flex-wrap gap-2">
            {res.artists.map((a) => <li key={a.key}><button type="button" onClick={() => onArtist(a)} className="ln-chip px-4 py-1.5 text-sm font-semibold">{a.name}</button></li>)}
          </ul>
        </Section>
      )}
      {res && res.tracks.length > 0 && (
        <Section title="Songs" id="ln-s-songs">
          <ol className="grid gap-x-8 sm:grid-cols-2">
            {res.tracks.map((t, i) => (
              <li key={`${t.releaseId}-${t.mediaId}`} className="ln-row flex items-center gap-3 px-2 py-2">
                <Cover url={t.coverUrl} title={t.releaseTitle} size="sm" />
                <button type="button" onClick={() => playSong(i)} className="min-w-0 flex-1 text-left" aria-label={`Play ${t.title}`}>
                  <span className="block truncate text-sm font-medium">{t.title}</span>
                  <span className="block truncate text-xs text-[color:var(--ln-muted)]">{t.artist.name} · {t.releaseTitle}</span>
                </button>
                <span className="ln-mono text-xs text-[color:var(--ln-muted)]">{fmtDuration(t.durationSec)}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}
      {q.trim().length >= 2 && <OpenWeb q={q.trim()} />}
      {res && res.releases.length > 0 && (
        <Section title="Releases" id="ln-s-releases">
          <Grid>{res.releases.map((r) => <ReleaseTile key={r.id} release={r} onOpen={onRelease} onArtist={() => onArtist(r.artist)} />)}</Grid>
        </Section>
      )}
    </div>
  );
}
