'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import type { HouseRow, LoadState } from './types';

export function VisitHousesPanel({
  onFlash,
}: {
  onFlash: (kind: 'ok' | 'err', msg: string) => void;
}) {
  const [worldId, setWorldId] = useState('tunya');
  const [publicHouses, setPublicHouses] = useState<HouseRow[]>([]);
  const [publicState, setPublicState] = useState<LoadState>('idle');
  const [publicError, setPublicError] = useState<string | null>(null);

  const refreshPublic = useCallback(async (wid: string) => {
    setPublicState('loading');
    setPublicError(null);
    try {
      const r = await fetch(`/api/housing/world/${encodeURIComponent(wid)}/public`);
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setPublicError(j?.error || j?.reason || `Request failed (${r.status})`);
        setPublicState('error');
        return;
      }
      setPublicHouses(j.houses || []);
      setPublicState('ready');
    } catch (e) {
      setPublicError(e instanceof Error ? e.message : 'Network error');
      setPublicState('error');
    }
  }, []);

  useEffect(() => { refreshPublic(worldId); }, [worldId, refreshPublic]);

  return (
    <section className="mx-auto max-w-screen-2xl px-4 py-5 sm:px-6">
      <div className="mb-3 flex items-center gap-2 text-[12px]">
        <span className="text-slate-400">World:</span>
        <input value={worldId} onChange={(e) => setWorldId(e.target.value)}
          className="rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-slate-100" />
        <button onClick={() => refreshPublic(worldId)} className="rounded bg-emerald-500/20 px-2 py-1 text-emerald-100">Browse</button>
      </div>
      {publicState === 'loading' ? (
        <div role="status" aria-live="polite" className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="housing-public-loading">
          <span className="sr-only">Loading public houses…</span>
          {[0, 1, 2].map(i => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-800/60" aria-hidden="true" />
          ))}
        </div>
      ) : publicState === 'error' ? (
        <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-[12px] text-rose-200" data-testid="housing-public-error">
          <p className="mb-2">Couldn&apos;t load public houses: {publicError}</p>
          <button onClick={() => refreshPublic(worldId)} className="rounded bg-rose-500/20 px-2 py-1 text-[11px] text-rose-100 hover:bg-rose-500/30">
            <RefreshCcw className="mr-1 inline h-3 w-3" />Retry
          </button>
        </div>
      ) : publicHouses.length === 0 ? (
        <p className="py-8 text-center text-[12px] text-slate-500" data-testid="housing-public-empty">No public houses in this world yet.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="housing-public-list">
          {publicHouses.map(h => (
            <li key={h.id} className="rounded-xl border border-emerald-500/20 bg-zinc-950/60 p-3">
              <h3 className="font-semibold text-emerald-100">{h.name || 'Unnamed'}</h3>
              <p className="mt-0.5 text-[10px] text-emerald-300/60">{h.allow_live_visits ? 'Live visits open' : 'Snapshot only'}</p>
              <button
                onClick={() => fetch(`/api/housing/${h.id}/visit`, {
                  method: 'POST', credentials: 'include',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ isFriend: false }),
                }).then(r => r.json()).then(j => onFlash(j.ok ? 'ok' : 'err', j.ok ? `Entered in ${j.mode} mode` : (j.error || 'visit failed')))}
                className="mt-2 w-full rounded bg-emerald-500/20 px-2 py-1 text-[11px] text-emerald-100 hover:bg-emerald-500/30">
                Visit
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
