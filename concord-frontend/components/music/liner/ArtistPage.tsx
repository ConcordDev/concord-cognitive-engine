'use client';

/**
 * An artist's page: their own storefront. Hero tinted by their latest cover,
 * follow, top songs by real play counts, the full discography with prices,
 * bio and links. Addressed by handle (or an opaque key), never a raw id.
 */

import { useCallback, useEffect, useState } from 'react';
import { Play, UserCheck, UserPlus } from 'lucide-react';
import { showToast } from '@/components/common/Toasts';
import { artistRef, fmtDuration, music, toPlayerTrack, type ArtistCard, type ArtistPage as Page } from './linerApi';
import { Cover, Empty, Eq, Grid, ReleaseTile, Section } from './parts';
import { playQueue, playRelease, useNowPlaying } from './play';
import { useCoverTint } from './tint';

export function ArtistPage({ artist, onRelease, onArtist, refreshKey }: {
  artist: { handle?: string; artistKey?: string };
  onRelease: (id: string) => void;
  onArtist: (a: ArtistCard) => void;
  refreshKey?: number;
}) {
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNowPlaying();
  const tint = useCoverTint(page?.releases[0]?.coverUrl);

  const load = useCallback(async () => {
    const r = await music<Page>('artist-page', artist);
    if (!r.ok || !r.result) { setError(r.error || 'This artist could not be found.'); return; }
    setError(null);
    setPage(r.result);
  }, [artist]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const follow = async () => {
    if (!page) return;
    const want = !page.following;
    setPage({ ...page, following: want, followers: page.followers + (want ? 1 : -1) });
    setBusy(true);
    const r = await music<{ following: boolean; followers: number }>('artist-follow-toggle', { ...artistRef(page.artist), follow: want });
    setBusy(false);
    if (!r.ok || !r.result) {
      setPage((p) => (p ? { ...p, following: !want, followers: p.followers + (want ? -1 : 1) } : p));
      showToast('error', r.error || 'Could not update follow.');
      return;
    }
    setPage((p) => (p ? { ...p, following: r.result!.following, followers: r.result!.followers } : p));
  };

  if (error) return <div className="p-6"><Empty title="Artist not found">{error}</Empty></div>;
  if (!page) return <div className="p-8" role="status" aria-label="Loading artist"><div className="h-10 w-1/2 animate-pulse rounded bg-[var(--ln-paper-2)]" /></div>;

  const playTop = (i: number) => {
    const tracks = page.topTracks.map((t, idx) => {
      const rel = page.releases.find((r) => r.id === t.releaseId)!;
      return toPlayerTrack(rel, t, idx);
    });
    playQueue(tracks, i);
  };

  return (
    <article className="ln-wash min-h-full" style={{ ['--ln-tint' as string]: tint }} data-testid="ln-artist">
      <header className="px-4 pb-8 pt-10 sm:px-8 sm:pt-16">
        <p className="ln-eyebrow">Artist{page.artist.isMe ? ' · You' : ''}</p>
        <h1 className="ln-serif mt-1 text-5xl leading-none sm:text-7xl" data-testid="ln-artist-name">{page.artist.name}</h1>
        <p className="mt-3 text-sm text-[color:var(--ln-muted)]">
          <span className="ln-mono">{page.followers}</span> follower{page.followers === 1 ? '' : 's'} · <span className="ln-mono">{page.totalPlays}</span> {page.totalPlays === 1 ? 'play' : 'plays'} · {page.releases.length} release{page.releases.length === 1 ? '' : 's'}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {page.releases[0] && (
            <button type="button" onClick={() => playRelease(page.releases[0], 0)} className="ln-btn ln-btn-primary h-10 px-6 text-sm"><Play className="h-4 w-4 fill-current" /> Play latest</button>
          )}
          {!page.artist.isMe && (
            <button type="button" onClick={() => void follow()} disabled={busy} aria-pressed={page.following} className="ln-btn ln-btn-quiet h-10 px-5 text-sm" data-testid="ln-follow">
              {page.following ? <UserCheck className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />} {page.following ? 'Following' : 'Follow'}
            </button>
          )}
        </div>
      </header>

      <div className="px-4 pb-16 sm:px-8">
        {page.topTracks.length > 0 && (
          <Section title="Top songs" id="ln-top">
            <ol className="grid gap-x-8 sm:grid-cols-2">
              {page.topTracks.map((t, i) => {
                const current = now.trackId === `${t.releaseId}:${t.mediaId}`;
                return (
                  <li key={`${t.releaseId}-${t.mediaId}`} className="ln-row flex items-center gap-3 px-2 py-2" data-current={current ? 'true' : 'false'}>
                    <Cover url={t.coverUrl} title={t.releaseTitle} size="sm" />
                    <button type="button" onClick={() => playTop(i)} className="min-w-0 flex-1 text-left" aria-label={`Play ${t.title}`}>
                      <span className="block truncate text-sm font-medium">{t.title}</span>
                      <span className="block truncate text-xs text-[color:var(--ln-muted)]">{t.releaseTitle} · <span className="ln-mono">{t.plays}</span> {t.plays === 1 ? 'play' : 'plays'}</span>
                    </button>
                    {current ? <Eq playing={now.playing} /> : <span className="ln-mono text-xs text-[color:var(--ln-muted)]">{fmtDuration(t.durationSec)}</span>}
                  </li>
                );
              })}
            </ol>
          </Section>
        )}

        <Section title="Discography" id="ln-disco">
          {page.releases.length ? (
            <Grid>{page.releases.map((r) => <ReleaseTile key={r.id} release={r} onOpen={onRelease} showArtist={false} onArtist={() => onArtist(r.artist)} />)}</Grid>
          ) : (
            <Empty title="Nothing out yet">{page.artist.isMe ? 'Publish your first release from For Artists and it shows up here.' : 'This artist has not released anything yet.'}</Empty>
          )}
        </Section>

        {(page.bio || page.links.length > 0) && (
          <Section title="About" id="ln-about">
            {page.bio && <p className="ln-note max-w-3xl">{page.bio}</p>}
            {page.links.length > 0 && (
              <ul className="mt-4 flex flex-wrap gap-2">
                {page.links.filter((l) => /^https?:\/\//i.test(l.url)).map((l) => (
                  <li key={l.url}><a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="ln-chip inline-block px-3 py-1 text-sm">{l.label}</a></li>
                ))}
              </ul>
            )}
          </Section>
        )}
      </div>
    </article>
  );
}
