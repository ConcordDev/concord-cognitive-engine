'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronRight, Flag, Loader2 } from 'lucide-react';
import type { Kingdom } from './types';

export function KingdomListPanel({ onPick }: { onPick: (id: string) => void }) {
  const [kingdoms, setKingdoms] = useState<Kingdom[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/kingdoms', { credentials: 'same-origin' });
      const j = await r.json();
      if (j?.ok) {
        setKingdoms(Array.isArray(j.kingdoms) ? j.kingdoms : []);
        setLoaded(true);
      } else {
        setError(j?.error || `request failed (${r.status})`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);

  if (loading && !loaded) {
    return (
      <div role="status" aria-live="polite" className="flex items-center justify-center gap-3 rounded-lg border border-slate-800 bg-slate-900 p-12 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin text-amber-300" />
        <span>Loading kingdoms…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-rose-800 bg-rose-950/40 p-8 text-center text-rose-200">
        <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-rose-400" />
        <p className="mb-4 text-sm">Could not load kingdoms: {error}</p>
        <button onClick={() => fetchList()} className="rounded bg-rose-700 px-4 py-1.5 text-sm font-medium hover:bg-rose-600 focus:outline-none focus:ring-2 focus:ring-amber-500">
          Try again
        </button>
      </div>
    );
  }
  if (kingdoms.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-12 text-center text-slate-400">
        <Flag className="mx-auto mb-3 h-12 w-12 text-slate-700" />
        No kingdoms in any world yet. Found one to claim a region.
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {kingdoms.map((k) => (
        <li key={k.id}>
          <button
            onClick={() => onPick(k.id)}
            className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-900 p-4 text-left hover:border-amber-500/50 hover:bg-slate-800"
          >
            <div className="flex-1">
              <div className="flex items-baseline gap-3">
                <h3 className="font-semibold text-amber-100">{k.name}</h3>
                <span className="text-xs text-slate-400">{k.world_id}</span>
              </div>
              <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
                <span>Ruler: {k.ruler_user_id ? k.ruler_user_id.slice(0, 12) : k.ruler_faction_id || 'None'}</span>
                <span>·</span>
                <span>{k.region_polygon?.length ?? 0} vertices</span>
                <span>·</span>
                <span>Strength: {Math.round(k.claim_strength)}</span>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-600" />
          </button>
        </li>
      ))}
    </ul>
  );
}
