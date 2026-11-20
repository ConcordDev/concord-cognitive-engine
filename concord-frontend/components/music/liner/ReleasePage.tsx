'use client';

/**
 * A release, the way a record sleeve reads: big cover, play, buy, the
 * tracklist, then the artist's liner note, credits and the remix family
 * tree. Buying runs music.release-buy (the marketplace royalty path) and the
 * page only turns to "Owned" when the server says so.
 */

import { useCallback, useEffect, useState } from 'react';
import { Heart, Loader2, Pause, Play, ShoppingBag, Check, GitFork } from 'lucide-react';
import { cn } from '@/lib/utils';
import { showToast } from '@/components/common/Toasts';
import { fmtCC, fmtDuration, fmtTotal, music, TYPE_LABEL, type ArtistCard, type Release } from './linerApi';
import { Cover, Empty, Eq } from './parts';
import { playRelease, togglePause, useNowPlaying } from './play';
import { useCoverTint } from './tint';

export function ReleasePage({ id, onArtist, onRelease, refreshKey }: {
  id: string;
  onArtist: (a: ArtistCard) => void;
  onRelease: (id: string) => void;
  refreshKey?: number;
}) {
  const [release, setRelease] = useState<Release | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [buying, setBuying] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [justOwned, setJustOwned] = useState(false);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const now = useNowPlaying();
  const tint = useCoverTint(release?.coverUrl);

  const load = useCallback(async () => {
    const r = await music<{ release: Release }>('release-get', { id });
    if (!r.ok || !r.result?.release) { setError(r.error || 'This release could not be found.'); return; }
    setError(null);
    setRelease(r.result.release);
    // Hearts start from what is really in your library, not empty.
    const liked = await music<{ tracks: Array<{ releaseId?: string; mediaId?: string }> }>('liked-songs');
    if (liked.ok) setSaved(new Set((liked.result?.tracks || []).filter((t) => t.releaseId === id && t.mediaId).map((t) => t.mediaId as string)));
  }, [id]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const buy = async () => {
    if (!release) return;
    setBuying(true);
    setBuyError(null);
    const r = await music<{ release: Release; price: number }>('release-buy', { id: release.id });
    setBuying(false);
    setConfirming(false);
    if (!r.ok || !r.result?.release) { setBuyError(r.error || 'The purchase did not go through.'); return; }
    setRelease(r.result.release);
    setJustOwned(true);
    showToast('success', `${release.title} is yours. ${fmtCC(r.result.price)} paid; 95% goes to ${release.artist.name}'s creator pool.`);
  };

  const save = async (mediaId: string, title: string) => {
    if (!release || saved.has(mediaId)) return;
    setSaved((s) => new Set(s).add(mediaId));
    const r = await music('library-add-release-track', { id: release.id, mediaId, like: true });
    if (!r.ok) {
      setSaved((s) => { const n = new Set(s); n.delete(mediaId); return n; });
      showToast('error', r.error || 'Could not save that song.');
    } else showToast('success', `Saved “${title}” to your library.`);
  };

  if (error) return <div className="p-6"><Empty title="Not here">{error}</Empty></div>;
  if (!release) {
    return (
      <div className="flex flex-col gap-6 p-6 sm:flex-row" role="status" aria-label="Loading release">
        <div className="h-64 w-64 animate-pulse rounded-md bg-[var(--ln-paper-2)]" />
        <div className="flex-1 space-y-3"><div className="h-8 w-2/3 animate-pulse rounded bg-[var(--ln-paper-2)]" /><div className="h-4 w-1/3 animate-pulse rounded bg-[var(--ln-paper-2)]" /></div>
      </div>
    );
  }

  const r = release;
  const year = (r.releaseDate || '').slice(0, 4);
  const playingThis = !!now.trackId && now.trackId.startsWith(`${r.id}:`);
  const gated = r.tracks.some((t) => !t.fullStream);
  const mine = r.artist.isMe;

  return (
    <article className="ln-wash min-h-full" style={{ ['--ln-tint' as string]: tint }} data-testid="ln-release">
      <header className="flex flex-col gap-6 px-4 pb-6 pt-6 sm:flex-row sm:items-end sm:px-8 sm:pt-10">
        <Cover url={r.coverUrl} title={r.title} size="xl" />
        <div className="min-w-0 flex-1">
          <p className="ln-eyebrow">{TYPE_LABEL[r.type]}{r.status === 'draft' ? ' · Draft' : ''}</p>
          <h1 className="ln-serif mt-1 text-4xl leading-tight sm:text-5xl" data-testid="ln-release-title">{r.title}</h1>
          <button type="button" onClick={() => onArtist(r.artist)} className="ln-link mt-2 text-lg font-semibold text-[color:var(--ln-accent)]">{r.artist.name}</button>
          <p className="mt-1 text-sm text-[color:var(--ln-muted)]">
            {[r.genre, year, `${r.tracks.length} song${r.tracks.length === 1 ? '' : 's'}`, r.durationSec ? fmtTotal(r.durationSec) : null].filter(Boolean).join(' · ')}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => (playingThis ? togglePause() : playRelease(r, 0))}
              disabled={!r.tracks.length}
              className="ln-btn ln-btn-primary h-10 px-6 text-sm"
              data-testid="ln-play"
            >
              {playingThis && now.playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
              {playingThis && now.playing ? 'Pause' : 'Play'}
            </button>
            {r.status === 'published' && !mine && (
              r.owned ? (
                <span className={cn('ln-btn ln-btn-owned h-10 px-5 text-sm', justOwned && 'ln-owned-pop')} data-testid="ln-owned"><Check className="h-4 w-4" /> In your library</span>
              ) : r.priceCC > 0 ? (
                confirming ? (
                  <span className="flex items-center gap-1.5">
                    <button type="button" onClick={() => void buy()} disabled={buying} className="ln-btn ln-btn-primary h-10 px-5 text-sm" data-testid="ln-buy-confirm">
                      {buying && <Loader2 className="h-4 w-4 animate-spin" />} Pay {fmtCC(r.priceCC)}
                    </button>
                    <button type="button" onClick={() => setConfirming(false)} className="ln-btn ln-btn-quiet h-10 px-4 text-sm">Cancel</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => { setBuyError(null); setConfirming(true); }} className="ln-btn ln-btn-quiet h-10 px-5 text-sm" data-testid="ln-buy">
                    <ShoppingBag className="h-4 w-4" /> Buy · <span className="ln-mono">{fmtCC(r.priceCC)}</span>
                  </button>
                )
              ) : (
                <span className="text-sm text-[color:var(--ln-muted)]">Free to stream</span>
              )
            )}
            {mine && r.status === 'published' && <span className="text-sm text-[color:var(--ln-muted)]">{r.sales ?? 0} sold · {fmtCC(r.priceCC)}</span>}
          </div>
          {confirming && <p className="mt-2 text-xs text-[color:var(--ln-muted)]">You pay {fmtCC(r.priceCC)} from your Concord Coin wallet: 95% to the artist&apos;s creator pool{r.remixOf.length ? ' (shared with the artists this remixes)' : ''}, 5% platform. You get every song in full, forever.</p>}
          {buyError && <p className="mt-2 text-sm text-[color:var(--ln-accent)]" role="alert" data-testid="ln-buy-error">{buyError}</p>}
          {gated && !mine && <p className="mt-2 text-xs text-[color:var(--ln-muted)]">You hear {r.previewSec}-second previews until you buy.</p>}
        </div>
      </header>

      <div className="px-2 sm:px-6">
        <ol className="divide-y ln-divide" data-testid="ln-tracklist">
          {r.tracks.map((t, i) => {
            const current = now.trackId === `${r.id}:${t.mediaId}`;
            return (
              <li key={t.mediaId} className="ln-row flex items-center gap-3 px-2 py-2.5" data-current={current ? 'true' : 'false'}>
                <span className="ln-mono w-6 flex-shrink-0 text-right text-sm text-[color:var(--ln-muted)]">{current ? <Eq playing={now.playing} /> : i + 1}</span>
                <button type="button" onClick={() => playRelease(r, i)} className="min-w-0 flex-1 text-left" aria-label={`Play ${t.title}`} data-testid="ln-track">
                  <span className="block truncate text-[15px] font-medium">
                    {t.title}
                    {t.explicit && <span className="ml-1.5 rounded-sm bg-[var(--ln-paper-2)] px-1 text-[10px] font-bold text-[color:var(--ln-muted)]" title="Explicit">E</span>}
                  </span>
                  <span className="ln-mono block truncate text-[11px] text-[color:var(--ln-muted)]">
                    {[t.bpm ? `${t.bpm} BPM` : null, t.key, t.plays ? `${t.plays} play${t.plays === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
                    {!t.fullStream && <span className="ml-1 font-sans font-semibold text-[color:var(--ln-warn)]">Preview</span>}
                  </span>
                </button>
                {r.status === 'published' && (
                  <button type="button" onClick={() => void save(t.mediaId, t.title)} aria-pressed={saved.has(t.mediaId)} aria-label={`Save ${t.title} to your library`} className="rounded-full p-1.5 text-[color:var(--ln-muted)] transition-colors hover:text-[color:var(--ln-accent)]">
                    <Heart className={cn('h-4 w-4', saved.has(t.mediaId) && 'fill-[var(--ln-accent)] text-[color:var(--ln-accent)]')} />
                  </button>
                )}
                <span className="ln-mono w-12 flex-shrink-0 text-right text-sm text-[color:var(--ln-muted)]">{fmtDuration(t.durationSec)}</span>
              </li>
            );
          })}
        </ol>
        {!r.tracks.length && <Empty title="No songs yet">Add songs to this release in For Artists.</Empty>}
      </div>

      <div className="grid gap-10 px-4 pb-16 pt-10 sm:px-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-labelledby="ln-notes">
          <h2 id="ln-notes" className="ln-eyebrow mb-3">Liner notes</h2>
          {r.note ? <p className="ln-note" data-testid="ln-note">{r.note}</p> : <p className="text-sm text-[color:var(--ln-muted)]">{r.artist.name} has not written a note for this {TYPE_LABEL[r.type].toLowerCase()}.</p>}
        </section>
        <aside className="space-y-8">
          {r.credits.length > 0 && (
            <section aria-labelledby="ln-credits">
              <h2 id="ln-credits" className="ln-eyebrow mb-2">Credits</h2>
              <dl className="space-y-1.5 text-sm">
                {r.credits.map((c, i) => (
                  <div key={`${c.role}-${c.name}-${i}`} className="flex gap-3"><dt className="w-28 flex-shrink-0 text-[color:var(--ln-muted)]">{c.role}</dt><dd className="font-medium">{c.name}</dd></div>
                ))}
              </dl>
            </section>
          )}
          {(r.remixOf.length > 0 || r.remixes.length > 0) && (
            <section aria-labelledby="ln-family">
              <h2 id="ln-family" className="ln-eyebrow mb-2 flex items-center gap-1.5"><GitFork className="h-3.5 w-3.5" aria-hidden /> Family tree</h2>
              <p className="mb-2 text-xs text-[color:var(--ln-muted)]">Every sale pays the artists it came from, automatically.</p>
              <ul className="space-y-1.5 text-sm">
                {r.remixOf.map((p) => (
                  <li key={p.id}>Remix of <button type="button" onClick={() => onRelease(p.id)} className="ln-link font-semibold">{p.title}</button> by <button type="button" onClick={() => onArtist(p.artist)} className="ln-link">{p.artist.name}</button></li>
                ))}
                {r.remixes.map((p) => (
                  <li key={p.id}><button type="button" onClick={() => onRelease(p.id)} className="ln-link font-semibold">{p.title}</button> by <button type="button" onClick={() => onArtist(p.artist)} className="ln-link">{p.artist.name}</button></li>
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="ln-details">
            <h2 id="ln-details" className="ln-eyebrow mb-2">Details</h2>
            <dl className="space-y-1 text-sm">
              <div className="flex gap-3"><dt className="w-28 text-[color:var(--ln-muted)]">Released</dt><dd>{r.releaseDate}</dd></div>
              <div className="flex gap-3"><dt className="w-28 text-[color:var(--ln-muted)]">Streaming</dt><dd>{r.streaming === 'preview' && r.priceCC > 0 ? `Previews (${r.previewSec} s) until bought` : 'Full, free'}</dd></div>
              {r.dtuId && <div className="flex gap-3"><dt className="w-28 text-[color:var(--ln-muted)]">Release DTU</dt><dd className="ln-mono truncate text-xs">{r.dtuId}</dd></div>}
            </dl>
          </section>
        </aside>
      </div>
    </article>
  );
}
