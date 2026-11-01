'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Music2, Search } from 'lucide-react';
import { api } from '@/lib/api/client';
import { PreviewAwareMedia } from '@/components/media/PreviewAwareMedia';
import { SignInToAct, VisitorFrame } from '@/components/public/VisitorFrame';

export interface PublicTrack {
  id: string;
  title: string;
  description: string;
  mediaType: 'audio' | 'video';
  duration: number | null;
  tags: string[];
  createdAt: string;
  authorName: string | null;
  views: number;
  likes: number;
  streamUrl: string;
  previewSeconds: number;
}

const PAGE = 20;
const mmss = (s: number | null) => (s && s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : null);

/**
 * Music for a signed-out visitor: the public catalog (`GET /api/media/public-feed`, whitelisted fields,
 * public items only), each track playable as the server's 30 s preview with the Preview badge and the
 * "Sign in for the full track" prompt. Every write is a sign-in link, not an error.
 */
export function SignedOutMusicBrowse() {
  const [tab, setTab] = useState<'latest' | 'trending'>('latest');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [items, setItems] = useState<PublicTrack[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { const t = setTimeout(() => setDebouncedQ(q.trim()), 250); return () => clearTimeout(t); }, [q]);

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/api/media/public-feed', { params: { mediaType: 'audio', tab, q: debouncedQ || undefined, limit: PAGE, offset } });
      const rows = (r.data?.items || []) as PublicTrack[];
      setItems((cur) => (offset === 0 ? rows : [...cur, ...rows]));
      setTotal(Number(r.data?.total) || 0);
    } catch {
      setError('Could not load the public catalog. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, [tab, debouncedQ]);

  useEffect(() => { void load(0); }, [load]);

  return (
    <VisitorFrame active="music">
      <div data-testid="visitor-music-browse">
        <h1 className="mb-4 font-vault text-4xl leading-tight text-zinc-100 sm:text-5xl">Music</h1>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div role="tablist" aria-label="Order" className="inline-flex rounded-full border border-white/10 bg-white/[0.03] p-1">
            {(['latest', 'trending'] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-full px-4 py-1.5 text-sm capitalize ${tab === t ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200'}`}>{t}</button>
            ))}
          </div>
          <label className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-zinc-500" aria-hidden />
            <input aria-label="Search public tracks" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search public tracks" className="rounded-lg border border-white/10 bg-white/[0.03] py-1.5 pl-8 pr-3 text-sm text-zinc-100" />
          </label>
          <span className="ml-auto"><SignInToAct testId="visitor-upload">Sign in to upload</SignInToAct></span>
        </div>

        {error && <p role="alert" className="mb-3 rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error} <button type="button" onClick={() => void load(0)} className="underline">Retry</button></p>}

        {!error && !loading && items.length === 0 && (
          <p data-testid="visitor-music-empty" className="rounded-lg border border-dashed border-white/10 p-8 text-center text-sm text-zinc-400">
            {debouncedQ ? 'No public tracks match that search.' : 'No public tracks yet.'}
          </p>
        )}

        <ul className="space-y-3">
          {items.map((t) => (
            <li key={t.id} data-testid={`visitor-track-${t.id}`} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <Music2 className="h-4 w-4 self-center text-teal-300" aria-hidden />
                <h2 className="text-base font-semibold text-zinc-100">{t.title || 'Untitled'}</h2>
                <span className="text-xs text-zinc-400">{t.authorName || 'A Concord member'}</span>
                {mmss(t.duration) && <span className="text-xs tabular-nums text-zinc-500">{mmss(t.duration)}</span>}
              </div>
              {t.description && <p className="mb-2 text-sm text-zinc-400">{t.description}</p>}
              <PreviewAwareMedia src={t.streamUrl} kind="audio" className="w-full" />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {t.tags.map((g) => <span key={g} className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-zinc-400">#{g}</span>)}
                <span className="ml-auto flex items-center gap-2"><SignInToAct>Sign in to like or comment</SignInToAct></span>
              </div>
            </li>
          ))}
        </ul>

        {loading && <p className="mt-4 flex items-center gap-2 text-sm text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…</p>}
        {!loading && items.length < total && (
          <button type="button" data-testid="visitor-music-more" onClick={() => void load(items.length)} className="mt-4 rounded-lg border border-white/10 px-4 py-2 text-sm text-zinc-300 hover:bg-white/5">Load more</button>
        )}
      </div>
    </VisitorFrame>
  );
}

export default SignedOutMusicBrowse;
