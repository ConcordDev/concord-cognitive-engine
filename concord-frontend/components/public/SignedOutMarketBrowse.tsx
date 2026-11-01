'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, Store } from 'lucide-react';
import { api } from '@/lib/api/client';
import { PreviewAwareMedia } from '@/components/media/PreviewAwareMedia';
import { SignInToAct, VisitorFrame } from '@/components/public/VisitorFrame';

export interface PublicListing {
  id: string;
  title?: string;
  description?: string;
  category?: string;
  type?: string;
  price?: number;
  tier?: string;
  rating?: number;
  reviewCount?: number;
  createdAt?: string;
  tags?: string[];
  listenOnly?: boolean;
  mediaType?: string;
  streamUrl?: string;
}

/**
 * Market for a signed-out visitor: the listings the Market lens already serves anonymously
 * (`GET /api/marketplace/listings`), with owner/seller identity stripped by the server. Free
 * listen-only tracks play as the 30 s preview; paid listings show their price and a sign-in link in
 * place of Buy. Nothing here can write.
 */
export function SignedOutMarketBrowse() {
  const [rows, setRows] = useState<PublicListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    api.get('/api/marketplace/listings')
      .then((r) => { if (live) setRows((r.data?.listings || []) as PublicListing[]); })
      .catch(() => { if (live) setError('Could not load the listings. Try again in a moment.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [attempt]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) { const c = r.category || r.type; if (c) set.add(c); }
    return ['all', ...[...set].sort()];
  }, [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      const c = r.category || r.type || '';
      if (category !== 'all' && c !== category) return false;
      return !needle || `${r.title || ''} ${r.description || ''} ${(r.tags || []).join(' ')}`.toLowerCase().includes(needle);
    });
  }, [rows, q, category]);

  return (
    <VisitorFrame active="market">
      <div data-testid="visitor-market-browse">
        <h1 className="mb-4 font-vault text-4xl leading-tight text-zinc-100 sm:text-5xl">Market</h1>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <label className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-zinc-500" aria-hidden />
            <input aria-label="Search listings" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search listings" className="rounded-lg border border-white/10 bg-white/[0.03] py-1.5 pl-8 pr-3 text-sm text-zinc-100" />
          </label>
          <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-white/10 bg-lattice-deep px-2 py-1.5 text-sm text-zinc-100">
            {categories.map((c) => <option key={c} value={c}>{c === 'all' ? 'All categories' : c}</option>)}
          </select>
          <span className="ml-auto"><SignInToAct testId="visitor-list-something">Sign in to list something</SignInToAct></span>
        </div>

        {error && <p role="alert" className="mb-3 rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error} <button type="button" onClick={() => setAttempt((n) => n + 1)} className="underline">Retry</button></p>}
        {loading && <p className="flex items-center gap-2 text-sm text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…</p>}
        {!loading && !error && shown.length === 0 && (
          <p data-testid="visitor-market-empty" className="rounded-lg border border-dashed border-white/10 p-8 text-center text-sm text-zinc-400">
            {rows.length === 0 ? 'Nothing is listed yet.' : 'No listings match.'}
          </p>
        )}

        <ul className="grid gap-3 sm:grid-cols-2">
          {shown.map((l) => {
            const free = !l.price || l.price <= 0;
            return (
              <li key={l.id} data-testid={`visitor-listing-${l.id}`} className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-start gap-2">
                  <Store className="mt-0.5 h-4 w-4 shrink-0 text-teal-300" aria-hidden />
                  <h2 className="text-base font-semibold text-zinc-100">{l.title || 'Untitled'}</h2>
                  <span className={`ml-auto shrink-0 rounded px-2 py-0.5 text-[11px] ${l.listenOnly ? 'bg-teal-400/15 text-teal-300' : 'bg-white/5 text-zinc-300'}`}>
                    {l.listenOnly ? 'Free · listen only' : free ? 'Free' : `${l.price} CC`}
                  </span>
                </div>
                {l.description && <p className="text-sm text-zinc-400">{l.description}</p>}
                {l.listenOnly && l.streamUrl && (
                  <PreviewAwareMedia src={l.streamUrl} kind={l.mediaType === 'video' ? 'video' : 'audio'} className={l.mediaType === 'video' ? 'w-full rounded' : 'w-full'} />
                )}
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                  {(l.category || l.type) && <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-zinc-400">{l.category || l.type}</span>}
                  {typeof l.rating === 'number' && l.rating > 0 && <span className="text-[11px] text-zinc-500">★ {l.rating.toFixed(1)}{l.reviewCount ? ` (${l.reviewCount})` : ''}</span>}
                  {!l.listenOnly && <span className="ml-auto"><SignInToAct>Sign in to buy</SignInToAct></span>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </VisitorFrame>
  );
}

export default SignedOutMarketBrowse;
