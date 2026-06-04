'use client';

// Phase DC6 — Creatures lens.
// List creature populations in the current world; click two to attempt
// crossbreeding; view lineage of any creature by id.

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { Dna, Sparkles, GitBranch, Loader2 } from 'lucide-react';

interface Population {
  id: string;
  world_id: string;
  biome: string;
  species_id: string;
  lifestyle: string;
  current_count: number;
}
interface LineageEntry { id: string; parent_a: string | null; parent_b: string | null; generation: number; created_at?: number; }

export default function CreaturesLensPage() {
  const [worldId, setWorldId] = useState('concordia-hub');
  const [pops, setPops] = useState<Population[]>([]);
  const [pickA, setPickA] = useState<Population | null>(null);
  const [pickB, setPickB] = useState<Population | null>(null);
  const [breeding, setBreeding] = useState(false);
  const [breedResult, setBreedResult] = useState<{ ok: boolean; reason?: string; hybrid?: { id?: string; species_id?: string } } | null>(null);
  const [lineageId, setLineageId] = useState('');
  const [lineage, setLineage] = useState<LineageEntry[]>([]);
  // Wave 7 / E6 — the world's emotional weather (recent creature felt-moments).
  const [affect, setAffect] = useState<{ histogram: Record<string, number>; recent: Array<{ species_id?: string; dominant_drive?: string; reason?: string; v?: number }>; total: number } | null>(null);

  useEffect(() => {
    const w = typeof window !== 'undefined' ? localStorage.getItem('concordia:activeWorldId') : null;
    if (w) setWorldId(w);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [j, em] = await Promise.all([
        fetch(`/api/creatures/world/${worldId}`, { credentials: 'include' }).then(r => r.json()),
        fetch(`/api/creatures/world/${worldId}/affect`, { credentials: 'include' }).then(r => r.json()).catch(() => null),
      ]);
      if (j?.ok) setPops(j.populations || []);
      if (em?.ok) setAffect({ histogram: em.histogram || {}, recent: em.recent || [], total: em.total || 0 });
    } catch { /* swallow */ }
  }, [worldId]);

  useEffect(() => { refresh(); }, [refresh]);

  const breed = async () => {
    if (!pickA || !pickB) return;
    setBreeding(true);
    setBreedResult(null);
    try {
      const r = await fetch('/api/creatures/breed', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          a: { id: pickA.id, species_id: pickA.species_id, lifestyle: pickA.lifestyle },
          b: { id: pickB.id, species_id: pickB.species_id, lifestyle: pickB.lifestyle },
          environment: pickA.biome,
          sameEnvironmentBonus: pickA.biome === pickB.biome,
        }),
      });
      const j = await r.json();
      setBreedResult(j);
    } finally { setBreeding(false); }
  };

  const fetchLineage = async () => {
    if (!lineageId) return;
    try {
      const j = await fetch(`/api/creatures/${lineageId}/lineage`, { credentials: 'include' }).then(r => r.json());
      if (j?.ok) setLineage(j.lineage || []);
    } catch { /* swallow */ }
  };

  return (
    <LensShell lensId="creatures">
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-violet-200">
          <Dna size={22} /> Creatures
        </h1>
        <p className="text-sm text-zinc-400">{worldId} populations · crossbreeding pen · lineage browser</p>
      </header>

      {/* Wave 7 / E6 — the world's emotional weather: what the fauna have been feeling. */}
      {affect && affect.total > 0 && (
        <section className="rounded-lg border border-fuchsia-500/20 bg-fuchsia-500/[0.04] p-3">
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

      <section>
        <h2 className="mb-2 text-sm font-semibold text-violet-300">Populations</h2>
        {pops.length === 0 ? (
          <p className="text-xs text-zinc-500">No populations yet in this world.</p>
        ) : (
          <div className="grid gap-1 md:grid-cols-2">
            {pops.map((p) => {
              const sel = pickA?.id === p.id || pickB?.id === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    if (!pickA) setPickA(p);
                    else if (!pickB && pickA.id !== p.id) setPickB(p);
                    else { setPickA(p); setPickB(null); }
                  }}
                  className={[
                    'rounded border p-2 text-left text-xs',
                    sel ? 'border-violet-300 bg-violet-500/30 text-violet-50' : 'border-violet-500/20 bg-violet-950/20 text-violet-200 hover:border-violet-400/50',
                  ].join(' ')}
                >
                  <div className="font-mono font-semibold">{p.species_id}</div>
                  <div className="text-[10px] opacity-80">{p.biome} · {p.lifestyle} · ×{p.current_count}</div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {pickA && pickB && (
        <section className="rounded-lg border border-violet-500/40 bg-zinc-900/50 p-3">
          <h3 className="mb-2 text-sm font-semibold text-violet-200">Cross: {pickA.species_id} × {pickB.species_id}</h3>
          <button
            onClick={breed}
            disabled={breeding}
            className="rounded bg-violet-500/30 px-3 py-1.5 text-xs text-violet-100 hover:bg-violet-500/50 disabled:opacity-50"
          >
            {breeding ? <Loader2 className="inline animate-spin" size={11} /> : <Sparkles className="inline" size={11} />} Breed
          </button>
          {breedResult && (
            <div className="mt-2 text-xs">
              {breedResult.ok && breedResult.hybrid ? (
                <span className="text-emerald-300">✓ hybrid {breedResult.hybrid.species_id} ({breedResult.hybrid.id?.slice(0, 12)})</span>
              ) : (
                <span className="text-red-300">× {breedResult.reason || 'incompatible'}</span>
              )}
            </div>
          )}
        </section>
      )}

      <section className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-3">
        <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold text-zinc-200">
          <GitBranch size={14} /> Lineage browser
        </h3>
        <div className="flex gap-2">
          <input
            value={lineageId}
            onChange={(e) => setLineageId(e.target.value)}
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
              <div key={l.id} className="rounded bg-zinc-950 p-2 text-[10px] font-mono">
                gen {l.generation} · {l.id} ← [{l.parent_a || '?'}, {l.parent_b || '?'}]
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
    </LensShell>
  );
}
