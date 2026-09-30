'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Dna, Sparkles, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { CreaturePortraitThumb } from '@/components/creatures/CreaturePortraitThumb';
import type { BreedResult, Population } from './types';

export function PopulationsPanel({ worldId }: { worldId: string }) {
  const [pops, setPops] = useState<Population[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickA, setPickA] = useState<Population | null>(null);
  const [pickB, setPickB] = useState<Population | null>(null);
  const [breeding, setBreeding] = useState(false);
  const [breedResult, setBreedResult] = useState<BreedResult | null>(null);
  const [affect, setAffect] = useState<{ histogram: Record<string, number>; recent: Array<{ species_id?: string; dominant_drive?: string; reason?: string; v?: number }>; total: number } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await lensRun('creatures', 'roster', { worldId });
      const result = r?.data?.result as { ok?: boolean; populations?: Population[] } | null;
      if (r?.data?.ok && result?.ok) {
        setPops(result.populations || []);
      } else if (r?.data?.error) {
        throw new Error(r.data.error);
      } else {
        setPops(result?.populations || []);
      }
      try {
        const em = await fetch(`/api/creatures/world/${encodeURIComponent(worldId)}/affect`, { credentials: 'include' }).then(res => res.json());
        if (em?.ok) setAffect({ histogram: em.histogram || {}, recent: em.recent || [], total: em.total || 0 });
      } catch { /* optional */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load populations');
    } finally {
      setLoading(false);
    }
  }, [worldId]);

  useEffect(() => { refresh(); }, [refresh]);

  const breed = async () => {
    if (!pickA || !pickB) return;
    setBreeding(true);
    setBreedResult(null);
    try {
      const r = await lensRun('creatures', 'breed', {
        a: { id: pickA.id, species_id: pickA.species_id, lifestyle: pickA.lifestyle },
        b: { id: pickB.id, species_id: pickB.species_id, lifestyle: pickB.lifestyle },
        environment: pickA.biome,
        sameEnvironmentBonus: pickA.biome === pickB.biome,
        worldId,
      });
      setBreedResult((r?.data?.result as BreedResult) || { ok: false, reason: 'no_response' });
    } catch (e) {
      setBreedResult({ ok: false, reason: e instanceof Error ? e.message : 'breed_failed' });
    } finally { setBreeding(false); }
  };

  useLensCommand(
    [
      { id: 'refresh-populations', keys: 'r', description: 'Refresh populations', category: 'actions', action: () => { void refresh(); } },
      { id: 'breed-pair', keys: 'b', description: 'Breed the selected crossbreeding pair', category: 'actions', action: () => { void breed(); }, enabled: !!pickA && !!pickB && !breeding },
    ],
    { lensId: 'creatures' },
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <div className="flex items-center gap-1.5">
          <button onClick={refresh} disabled={loading} aria-label="Refresh populations" title="Refresh populations (R)"
            className="rounded border border-zinc-700 bg-zinc-900 p-2 text-zinc-300 hover:border-violet-500/50 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden />
          </button>
          <kbd className="hidden rounded border border-zinc-700 bg-zinc-900 px-1 text-[10px] text-zinc-500 sm:inline">R</kbd>
        </div>
      </div>

      {affect && affect.total > 0 && (
        <section aria-label="Emotional weather" className="rounded-lg border border-fuchsia-500/20 bg-fuchsia-500/[0.04] p-3">
          <h2 className="mb-2 text-sm font-semibold text-fuchsia-300">Emotional weather <span className="text-[10px] font-normal text-zinc-500">{affect.total} recent felt moments</span></h2>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {Object.entries(affect.histogram).sort((a, b) => b[1] - a[1]).map(([drive, n]) => (
              <span key={drive} className="rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] text-fuchsia-200">
                {drive.toLowerCase()} · {n}
              </span>
            ))}
          </div>
          <ul className="space-y-0.5">
            {affect.recent.slice(0, 6).map((r, i) => (
              <li key={i} className="text-[11px] text-zinc-400">
                <span className="text-zinc-200">{r.species_id || 'creature'}</span> felt{' '}
                <span className={(r.v ?? 0) < 0 ? 'text-rose-300' : 'text-emerald-300'}>{r.reason || r.dominant_drive?.toLowerCase() || 'something'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Populations">
        <h2 className="mb-2 text-sm font-semibold text-violet-300">Populations</h2>
        {loading ? (
          <div className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/40 p-4 text-xs text-zinc-400" role="status" aria-live="polite">
            <Loader2 size={14} className="animate-spin" aria-hidden /> Loading populations…
          </div>
        ) : error ? (
          <div className="rounded border border-red-500/30 bg-red-500/[0.06] p-4 text-xs" role="alert">
            <div className="mb-2 flex items-center gap-2 text-red-300"><AlertCircle size={14} aria-hidden /> Couldn’t load populations.</div>
            <p className="mb-3 text-zinc-400">{error}</p>
            <button onClick={refresh} className="rounded bg-red-500/20 px-3 py-1 text-red-100 hover:bg-red-500/30">Retry</button>
          </div>
        ) : pops.length === 0 ? (
          <div className="rounded border border-dashed border-zinc-700 bg-zinc-900/30 p-6 text-center text-xs text-zinc-500">
            <Dna size={20} className="mx-auto mb-2 opacity-40" aria-hidden />
            No creature populations in <span className="font-mono text-zinc-400">{worldId}</span> yet.
            <p className="mt-1 text-[11px] text-zinc-600">Fauna populate as the world’s ecosystem spawns species per biome.</p>
          </div>
        ) : (
          <div className="grid gap-1 md:grid-cols-2">
            {pops.map((p) => {
              const sel = pickA?.id === p.id || pickB?.id === p.id;
              return (
                <button key={p.id} aria-pressed={sel}
                  onClick={() => {
                    if (!pickA) setPickA(p);
                    else if (!pickB && pickA.id !== p.id) setPickB(p);
                    else { setPickA(p); setPickB(null); setBreedResult(null); }
                  }}
                  className={[
                    'flex items-center gap-2 rounded border p-2 text-left text-xs',
                    sel ? 'border-violet-300 bg-violet-500/30 text-violet-50' : 'border-violet-500/20 bg-violet-950/20 text-violet-200 hover:border-violet-400/50',
                  ].join(' ')}
                >
                  <CreaturePortraitThumb speciesId={p.species_id} size={36} />
                  <div className="min-w-0">
                    <div className="font-mono font-semibold">{p.species_id}</div>
                    <div className="text-[10px] opacity-80">{p.biome} · {p.lifestyle} · ×{p.current_count}{p.topology ? ` · ${p.topology}` : ''}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {pickA && pickB && (
        <section aria-label="Crossbreeding pen" className="rounded-lg border border-violet-500/40 bg-zinc-900/50 p-3">
          <h3 className="mb-2 text-sm font-semibold text-violet-200">Cross: {pickA.species_id} × {pickB.species_id}</h3>
          {pickA.biome === pickB.biome && (
            <p className="mb-2 text-[11px] text-emerald-300/80">Same biome ({pickA.biome}) — crossbreeding bonus applies.</p>
          )}
          <button onClick={breed} disabled={breeding} title="Breed (B)"
            className="rounded bg-violet-500/30 px-3 py-1.5 text-xs text-violet-100 hover:bg-violet-500/50 disabled:opacity-50">
            {breeding ? <Loader2 className="inline animate-spin" size={11} aria-hidden /> : <Sparkles className="inline" size={11} aria-hidden />} Breed
            <kbd className="ml-1.5 rounded border border-violet-400/30 bg-violet-950/40 px-1 text-[9px] text-violet-300">B</kbd>
          </button>
          {breedResult && (
            <div className="mt-2 flex items-center gap-2 text-xs" role="status" aria-live="polite">
              {breedResult.ok && breedResult.hybrid ? (
                <>
                  {breedResult.hybrid.species_id && (
                    <CreaturePortraitThumb speciesId={breedResult.hybrid.species_id} variant={breedResult.hybrid.variant} size={36} />
                  )}
                  <span className="text-emerald-300">
                    ✓ hybrid {breedResult.hybrid.species_id} ({breedResult.hybrid.id?.slice(0, 14)})
                    {typeof breedResult.stability === 'number' && <> · stability {Math.round(breedResult.stability * 100)}%</>}
                    {breedResult.hybrid.topology && <> · {breedResult.hybrid.topology}</>}
                  </span>
                </>
              ) : (
                <span className="text-red-300">× {breedResult.reason || 'incompatible'}</span>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
