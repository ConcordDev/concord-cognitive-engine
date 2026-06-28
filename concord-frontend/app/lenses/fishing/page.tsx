'use client';

// Phase DC3 — Fishing hub lens.
// Catalog of fish available in the player's world + catch log + cast
// trigger. The FishingMinigameOverlay handles the actual reaction-timed
// minigame (cast → bite → reel with the tension meter), minting catches
// into player_inventory via the real /api/fishing/* routes (thin wrappers
// over server/lib/fishing.js, also surfaced as fishing.* macros).

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { FishingMinigameOverlay } from '@/components/world-lens/FishingMinigameOverlay';
import { Fish, Trophy, Sparkles, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';

interface FishCatalog {
  id: string;
  name: string;
  rarity: string;
  biome?: string;
  subBiome?: string;
  buffOnCook?: unknown;
}
interface CatchRow {
  id: string;
  world_id: string;
  item_id: string;
  item_name?: string;
  acquired_at: number;
  meta_json?: string;
}

type LoadState = 'loading' | 'ready' | 'error';

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
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  // Real consumer for the `concordia:open-fishing` dispatch below — open the
  // reaction-timed minigame overlay mounted at the bottom of this page.
  const [minigameOpen, setMinigameOpen] = useState(false);

  useEffect(() => {
    const w = typeof window !== 'undefined' ? localStorage.getItem('concordia:activeWorldId') : null;
    if (w) setWorldId(w);
  }, []);

  useEffect(() => {
    const onOpen = () => setMinigameOpen(true);
    window.addEventListener('concordia:open-fishing', onOpen);
    return () => window.removeEventListener('concordia:open-fishing', onOpen);
  }, []);

  const refresh = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const [cRes, mRes] = await Promise.all([
        fetch(`/api/fishing/catalog?worldId=${encodeURIComponent(worldId)}`, { credentials: 'include' }),
        fetch('/api/fishing/catches/mine', { credentials: 'include' }),
      ]);
      if (!cRes.ok) throw new Error(`catalog ${cRes.status}`);
      const c = await cRes.json();
      // The catalog is the PRIMARY read. A handler rejection ({ ok:false })
      // must surface as a real ERROR, never collapse into the empty-state CTA
      // (the silent-empty defect class): an empty catalog and a failed catalog
      // load are different truths and must read differently to the player.
      if (c?.ok === false) throw new Error(c.error || c.reason || 'catalog unavailable');
      // catches is auth-gated + secondary; tolerate a 401 / { ok:false } by
      // showing an empty log rather than failing the whole lens.
      const m = mRes.ok ? await mRes.json() : { ok: true, catches: [] };
      setCatalog(Array.isArray(c?.fish) ? c.fish : []);
      setCatches(m?.ok ? (m.catches || []) : []);
      setState('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load fishing data');
      setState('error');
    }
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
      // Open the minigame overlay (consumed by the effect above).
      window.dispatchEvent(new CustomEvent('concordia:open-fishing'));
    } catch {
      // The overlay re-casts on open and surfaces its own cast errors; the
      // standalone catch here only guards against the fetch itself throwing.
    } finally { setPending(false); }
  }, [worldId]);

  return (
    <LensShell lensId="fishing">
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-cyan-200">
          <Fish size={22} aria-hidden /> Fishing
        </h1>
        <p className="text-sm text-zinc-400">Cast lines, log catches, study local fish.</p>
      </header>

      {state === 'loading' && (
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="flex items-center gap-2 rounded border border-cyan-500/20 bg-zinc-900/40 p-6 text-sm text-cyan-200"
        >
          <Loader2 className="animate-spin" size={16} aria-hidden /> Loading fishing data…
        </div>
      )}

      {state === 'error' && (
        <div
          role="alert"
          className="space-y-3 rounded border border-red-500/30 bg-red-950/30 p-6 text-sm text-red-200"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} aria-hidden /> Couldn’t load fishing data.
          </div>
          {error && <p className="text-xs text-red-300/70">{error}</p>}
          <button
            onClick={refresh}
            className="flex items-center gap-1 rounded bg-red-500/20 px-3 py-1.5 text-xs text-red-100 hover:bg-red-500/40"
          >
            <RefreshCw size={12} aria-hidden /> Retry
          </button>
        </div>
      )}

      {state === 'ready' && (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="space-y-2" aria-label="Fish catalog">
            <h2 className="text-sm font-semibold text-cyan-300">Fish catalog · {worldId}</h2>
            <div className="space-y-1">
              {catalog.length === 0 && (
                <p className="text-xs text-zinc-500">No fish defined for this world yet.</p>
              )}
              {catalog.map((f) => (
                <div key={f.id} className="flex items-center justify-between rounded border border-cyan-500/20 bg-zinc-900/40 p-2 text-xs">
                  <div>
                    <div className="text-cyan-100">{f.name}</div>
                    {f.subBiome && <div className="text-[10px] text-zinc-500">{f.subBiome}</div>}
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
              {pending ? <Loader2 className="animate-spin" size={14} aria-hidden /> : <Sparkles size={14} aria-hidden />} Cast line
            </button>
          </section>

          <section className="space-y-2" aria-label="Catch log">
            <h2 className="flex items-center gap-1 text-sm font-semibold text-amber-300">
              <Trophy size={14} aria-hidden /> Catch log
            </h2>
            <div className="space-y-1">
              {catches.length === 0 && <p className="text-xs text-zinc-500">No catches yet. Cast a line to start your log.</p>}
              {catches.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded border border-amber-500/20 bg-amber-950/20 p-2 text-xs">
                  <span className="text-amber-100">{c.item_name || c.item_id}</span>
                  <span className="text-[10px] text-amber-300/70">{new Date(c.acquired_at * 1000).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Reaction-timed minigame — opened by the `concordia:open-fishing`
          dispatch on Cast. Refreshes the catch log when it closes. */}
      <FishingMinigameOverlay
        open={minigameOpen}
        worldId={worldId}
        position={{ x: 0, z: 0 }}
        onClose={() => { setMinigameOpen(false); refresh(); }}
      />
    </div>
    </LensShell>
  );
}
