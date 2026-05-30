'use client';

// Phase DC6 — Creature crossbreeding pair-picker.
// Reads /api/creatures/world/:worldId; lets the player pair two species
// and POST /api/creatures/breed for compatibility check + hybrid mint.

import { useCallback, useEffect, useState } from 'react';
import { Dna, Sparkles, Loader2 } from 'lucide-react';
import { StationOverlayShell } from './_StationOverlayShell';
import type { OverlayProps } from './StationInteractionRouter';
import { milestoneJuice, failureJuice } from '@/lib/concordia/juice';
import { playActionAtPlayer } from '@/lib/concordia/play-action';

interface Population {
  id: string;
  world_id: string;
  biome: string;
  species_id: string;
  lifestyle: string;
  current_count: number;
}

interface BreedResult {
  ok: boolean;
  hybrid?: { id?: string; species_id?: string; traits?: Record<string, unknown>; };
  reason?: string;
}

export function CreatureBreedingPanel({ building, onClose, worldId }: OverlayProps) {
  const [pops, setPops] = useState<Population[]>([]);
  const [a, setA] = useState<Population | null>(null);
  const [b, setB] = useState<Population | null>(null);
  const [result, setResult] = useState<BreedResult | null>(null);
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const j = await fetch(`/api/creatures/world/${worldId}`, { credentials: 'include' }).then(r => r.json());
      if (j?.ok) setPops(j.populations || []);
    } catch { /* swallow */ }
  }, [worldId]);

  useEffect(() => { refresh(); }, [refresh]);

  const breed = useCallback(async () => {
    if (!a || !b) return;
    setPending(true);
    setResult(null);
    try {
      const r = await fetch('/api/creatures/breed', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          a: { id: a.id, species_id: a.species_id, lifestyle: a.lifestyle },
          b: { id: b.id, species_id: b.species_id, lifestyle: b.lifestyle },
          environment: a.biome,
          sameEnvironmentBonus: a.biome === b.biome,
        }),
      });
      const j = await r.json();
      if (j?.ok && j.hybrid) { playActionAtPlayer('commune'); milestoneJuice('ui_hybrid_minted'); }
      else failureJuice('ui_breed_failed');
      setResult(j);
    } finally { setPending(false); }
  }, [a, b]);

  return (
    <StationOverlayShell
      title={building.name || 'Creature pen'}
      subtitle={`creature_pen · ${worldId}`}
      onClose={onClose}
      accent="violet"
      size="lg"
    >
      <div className="space-y-3">
        {pops.length === 0 ? (
          <p className="py-4 text-center text-xs text-zinc-500">No creature populations in this world yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              {[{ slot: 'a' as const, value: a, setter: setA }, { slot: 'b' as const, value: b, setter: setB }].map(({ slot, value, setter }) => (
                <div key={slot}>
                  <div className="mb-1 text-[10px] uppercase text-violet-300/70">parent {slot.toUpperCase()}</div>
                  <select
                    value={value?.id || ''}
                    onChange={(e) => setter(pops.find((p) => p.id === e.target.value) || null)}
                    className="w-full rounded border border-violet-500/30 bg-zinc-950 px-2 py-1.5 text-xs text-violet-100"
                  >
                    <option value="">Pick…</option>
                    {pops.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.species_id} ({p.biome}, ×{p.current_count})
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {a && b && (
              <div className="rounded border border-violet-500/30 bg-violet-950/30 p-2 text-xs">
                <div className="text-violet-200">
                  pairing: <span className="font-mono">{a.species_id}</span> + <span className="font-mono">{b.species_id}</span>
                </div>
                <div className="text-[10px] text-violet-300/60">
                  same biome: {a.biome === b.biome ? 'yes (+bond bonus)' : 'no'} · lifestyle compat: {a.lifestyle === b.lifestyle ? 'matching' : 'cross-feed'}
                </div>
              </div>
            )}

            <button
              onClick={breed}
              disabled={pending || !a || !b}
              className="flex w-full items-center justify-center gap-1 rounded bg-violet-500/30 px-3 py-2 text-sm text-violet-100 hover:bg-violet-500/50 disabled:opacity-50"
            >
              {pending ? <Loader2 className="animate-spin" size={14} /> : <Dna size={14} />} Attempt crossbreed
            </button>

            {result && (
              <div className={['rounded border p-3', result.ok && result.hybrid ? 'border-emerald-500/40 bg-emerald-950/30' : 'border-red-500/40 bg-red-950/30'].join(' ')}>
                {result.ok && result.hybrid ? (
                  <div>
                    <div className="flex items-center gap-2 text-emerald-200">
                      <Sparkles size={14} /> Hybrid created
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-emerald-300/70">
                      species: {result.hybrid.species_id} · id: {result.hybrid.id?.slice(0, 16)}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-red-200">
                    crossbreed failed: {result.reason || 'incompatible'}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </StationOverlayShell>
  );
}
