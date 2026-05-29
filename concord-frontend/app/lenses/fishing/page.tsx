'use client';

// Phase DC3 — Fishing hub lens.
// Catalog of fish available in the player's world + catch log + cast
// trigger. The existing FishingMinigameOverlay handles the actual
// reaction-timed minigame.

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { Fish, Trophy, Sparkles, Loader2 } from 'lucide-react';

interface FishCatalog {
  id: string;
  name: string;
  rarity: string;
  biome?: string;
  buffOnCook?: string | null;
}
interface CatchRow {
  id: string;
  world_id: string;
  item_id: string;
  item_name?: string;
  acquired_at: number;
  meta_json?: string;
}

const RARITY_COLORS: Record<string, string> = {
  common: 'text-zinc-300 bg-zinc-800',
  uncommon: 'text-emerald-300 bg-emerald-900/40',
  rare: 'text-cyan-300 bg-cyan-900/40',
  epic: 'text-violet-300 bg-violet-900/40',
  legendary: 'text-amber-300 bg-amber-900/40',
};

export default function FishingLensPage() {
  const [catalog, setCatalog] = useState<FishCatalog[]>([]);
  const [catches, setCatches] = useState<CatchRow[]>([]);
  const [worldId, setWorldId] = useState<string>('concordia-hub');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const w = typeof window !== 'undefined' ? localStorage.getItem('concordia:activeWorldId') : null;
    if (w) setWorldId(w);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [c, m] = await Promise.all([
        fetch(`/api/fishing/catalog?worldId=${encodeURIComponent(worldId)}`, { credentials: 'include' }).then(r => r.json()),
        fetch('/api/fishing/catches/mine', { credentials: 'include' }).then(r => r.json()),
      ]);
      if (c?.ok) setCatalog(c.fish || []);
      if (m?.ok) setCatches(m.catches || []);
    } catch { /* swallow */ }
  }, [worldId]);

  useEffect(() => { refresh(); }, [refresh]);

  const cast = useCallback(async () => {
    setPending(true);
    try {
      await fetch('/api/fishing/cast', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ worldId, biome: 'water' }),
      });
      // Open the minigame overlay if mounted via event.
      window.dispatchEvent(new CustomEvent('concordia:open-fishing'));
    } finally { setPending(false); }
  }, [worldId]);

  return (
    <LensShell lensId="fishing">
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-cyan-200">
          <Fish size={22} /> Fishing
        </h1>
        <p className="text-sm text-zinc-400">Cast lines, log catches, study local fish.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-cyan-300">Fish catalog · {worldId}</h2>
          <div className="space-y-1">
            {catalog.length === 0 && <p className="text-xs text-zinc-500">No fish defined for this world.</p>}
            {catalog.map((f) => (
              <div key={f.id} className="flex items-center justify-between rounded border border-cyan-500/20 bg-zinc-900/40 p-2 text-xs">
                <div>
                  <div className="text-cyan-100">{f.name}</div>
                  {f.buffOnCook && <div className="text-[10px] text-amber-300/70">cook → {f.buffOnCook}</div>}
                </div>
                <span className={['rounded px-1.5 py-0.5 text-[10px]', RARITY_COLORS[f.rarity] || 'text-zinc-400 bg-zinc-800'].join(' ')}>
                  {f.rarity}
                </span>
              </div>
            ))}
          </div>
          <button
            onClick={cast}
            disabled={pending}
            className="mt-2 flex w-full items-center justify-center gap-1 rounded bg-cyan-500/30 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/50 disabled:opacity-50"
          >
            {pending ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />} Cast line
          </button>
        </section>

        <section className="space-y-2">
          <h2 className="flex items-center gap-1 text-sm font-semibold text-amber-300">
            <Trophy size={14} /> Catch log
          </h2>
          <div className="space-y-1">
            {catches.length === 0 && <p className="text-xs text-zinc-500">No catches yet.</p>}
            {catches.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded border border-amber-500/20 bg-amber-950/20 p-2 text-xs">
                <span className="text-amber-100">{c.item_name || c.item_id}</span>
                <span className="text-[10px] text-amber-300/70">{new Date(c.acquired_at * 1000).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
    </LensShell>
  );
}
