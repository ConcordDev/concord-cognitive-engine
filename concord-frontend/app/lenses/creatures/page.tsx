'use client';

// Phase DC6 — Creatures lens.
// Browse the live fauna populations in the current world, pick two to attempt a
// real crossbreed (delegates to the server creatures.breed macro → the
// physics-validated creature-crossbreeding pipeline), and trace any creature's
// lineage. All data is real: populations come from creature_population, the
// breed returns a genuine hybrid blueprint, lineage reads creature_lineage.
// No mock/placeholder creatures — empty worlds render an honest empty state.

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { lensRun } from '@/lib/api/client';
import { Dna, Sparkles, GitBranch, Loader2, AlertCircle, RefreshCw } from 'lucide-react';

interface Population {
  id: string;
  world_id: string;
  biome: string;
  species_id: string;
  lifestyle: string;
  current_count: number;
  topology?: string;
  clade?: string;
}
interface LineageRow { child_id: string; parent_a: string | null; parent_b: string | null; generation: number; stability?: number; created_at?: number; }
interface BreedResult {
  ok: boolean;
  reason?: string;
  hybrid?: { id?: string; species_id?: string; topology?: string; massKg?: number; variant?: string | null };
  stability?: number;
  generation?: number;
}

export default function CreaturesLensPage() {
  const [worldId, setWorldId] = useState('concordia-hub');
  const [pops, setPops] = useState<Population[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickA, setPickA] = useState<Population | null>(null);
  const [pickB, setPickB] = useState<Population | null>(null);
  const [breeding, setBreeding] = useState(false);
  const [breedResult, setBreedResult] = useState<BreedResult | null>(null);
  const [lineageId, setLineageId] = useState('');
  const [lineage, setLineage] = useState<LineageRow[]>([]);
  // Wave 7 / E6 — the world's emotional weather (recent creature felt-moments).
  const [affect, setAffect] = useState<{ histogram: Record<string, number>; recent: Array<{ species_id?: string; dominant_drive?: string; reason?: string; v?: number }>; total: number } | null>(null);

  useEffect(() => {
    const w = typeof window !== 'undefined' ? localStorage.getItem('concordia:activeWorldId') : null;
    if (w) setWorldId(w);
  }, []);

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
      // Emotional-weather is an optional enrichment — never blocks the roster.
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

  const fetchLineage = async () => {
    if (!lineageId) return;
    try {
      const r = await lensRun('creatures', 'lineage', { creatureId: lineageId });
      const result = r?.data?.result as { ok?: boolean; lineage?: { self?: LineageRow | null; descendants?: LineageRow[] } } | null;
      if (result?.ok && result.lineage) {
        const rows: LineageRow[] = [];
        if (result.lineage.self) rows.push(result.lineage.self);
        for (const d of result.lineage.descendants || []) rows.push(d);
        setLineage(rows);
      } else {
        setLineage([]);
      }
    } catch { setLineage([]); }
  };

  return (
    <LensShell lensId="creatures">
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-violet-200">
            <Dna size={22} aria-hidden /> Creatures
          </h1>
          <p className="text-sm text-zinc-400">{worldId} populations · crossbreeding pen · lineage browser</p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          aria-label="Refresh populations"
          className="rounded border border-zinc-700 bg-zinc-900 p-2 text-zinc-300 hover:border-violet-500/50 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden />
        </button>
      </header>

      {/* Wave 7 / E6 — the world's emotional weather: what the fauna have been feeling. */}
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

        {/* ── Loading state ── */}
        {loading ? (
          <div className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/40 p-4 text-xs text-zinc-400" role="status" aria-live="polite">
            <Loader2 size={14} className="animate-spin" aria-hidden /> Loading populations…
          </div>
        ) : error ? (
          /* ── Error state (honest + retry) ── */
          <div className="rounded border border-red-500/30 bg-red-500/[0.06] p-4 text-xs" role="alert">
            <div className="mb-2 flex items-center gap-2 text-red-300">
              <AlertCircle size={14} aria-hidden /> Couldn’t load populations.
            </div>
            <p className="mb-3 text-zinc-400">{error}</p>
            <button onClick={refresh} className="rounded bg-red-500/20 px-3 py-1 text-red-100 hover:bg-red-500/30">
              Retry
            </button>
          </div>
        ) : pops.length === 0 ? (
          /* ── Empty state (genuine — no fabricated creatures) ── */
          <div className="rounded border border-dashed border-zinc-700 bg-zinc-900/30 p-6 text-center text-xs text-zinc-500">
            <Dna size={20} className="mx-auto mb-2 opacity-40" aria-hidden />
            No creature populations in <span className="font-mono text-zinc-400">{worldId}</span> yet.
            <p className="mt-1 text-[11px] text-zinc-600">Fauna populate as the world’s ecosystem spawns species per biome.</p>
          </div>
        ) : (
          /* ── Populated state ── */
          <div className="grid gap-1 md:grid-cols-2">
            {pops.map((p) => {
              const sel = pickA?.id === p.id || pickB?.id === p.id;
              return (
                <button
                  key={p.id}
                  aria-pressed={sel}
                  onClick={() => {
                    if (!pickA) setPickA(p);
                    else if (!pickB && pickA.id !== p.id) setPickB(p);
                    else { setPickA(p); setPickB(null); setBreedResult(null); }
                  }}
                  className={[
                    'rounded border p-2 text-left text-xs',
                    sel ? 'border-violet-300 bg-violet-500/30 text-violet-50' : 'border-violet-500/20 bg-violet-950/20 text-violet-200 hover:border-violet-400/50',
                  ].join(' ')}
                >
                  <div className="font-mono font-semibold">{p.species_id}</div>
                  <div className="text-[10px] opacity-80">{p.biome} · {p.lifestyle} · ×{p.current_count}{p.topology ? ` · ${p.topology}` : ''}</div>
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
          <button
            onClick={breed}
            disabled={breeding}
            className="rounded bg-violet-500/30 px-3 py-1.5 text-xs text-violet-100 hover:bg-violet-500/50 disabled:opacity-50"
          >
            {breeding ? <Loader2 className="inline animate-spin" size={11} aria-hidden /> : <Sparkles className="inline" size={11} aria-hidden />} Breed
          </button>
          {breedResult && (
            <div className="mt-2 text-xs" role="status" aria-live="polite">
              {breedResult.ok && breedResult.hybrid ? (
                <span className="text-emerald-300">
                  ✓ hybrid {breedResult.hybrid.species_id} ({breedResult.hybrid.id?.slice(0, 14)})
                  {typeof breedResult.stability === 'number' && <> · stability {Math.round(breedResult.stability * 100)}%</>}
                  {breedResult.hybrid.topology && <> · {breedResult.hybrid.topology}</>}
                </span>
              ) : (
                <span className="text-red-300">× {breedResult.reason || 'incompatible'}</span>
              )}
            </div>
          )}
        </section>
      )}

      <section aria-label="Lineage browser" className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-3">
        <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold text-zinc-200">
          <GitBranch size={14} aria-hidden /> Lineage browser
        </h3>
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="creature-lineage-id">Creature id</label>
          <input
            id="creature-lineage-id"
            value={lineageId}
            onChange={(e) => setLineageId(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') fetchLineage(); }}
            placeholder="creature id"
            className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
          />
          <button onClick={fetchLineage} className="rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-700">
            View
          </button>
        </div>
        {lineage.length > 0 && (
          <div className="mt-2 space-y-1">
            {lineage.map((l) => (
              <div key={l.child_id} className="rounded bg-zinc-950 p-2 text-[10px] font-mono text-zinc-300">
                gen {l.generation} · {l.child_id} ← [{l.parent_a || '?'}, {l.parent_b || '?'}]
                {typeof l.stability === 'number' && <span className="text-emerald-400/70"> · {Math.round(l.stability * 100)}%</span>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
    </LensShell>
  );
}
