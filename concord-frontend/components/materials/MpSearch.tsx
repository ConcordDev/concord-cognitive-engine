'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Atom, Loader2 } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Material {
  materialId: string; formula: string; elementCount?: number;
  crystalSystem?: string; spaceGroup?: string;
  density?: number; bandGapEv?: number;
  formationEnergyPerAtomEv?: number; energyAboveHullEv?: number;
  isStable?: boolean; isMagnetic?: boolean;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('materials', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

export function MpSearch() {
  const [formula, setFormula] = useState('');
  const [materials, setMaterials] = useState<Material[]>([]);
  const [error, setError] = useState<string | null>(null);

  const search = useMutation({
    mutationFn: async () => callMacro<{ materials: Material[] }>('mp-search', { formula: formula.trim() }),
    onSuccess: (env) => { if (env.ok && env.result) { setMaterials(env.result.materials); setError(null); } else { setMaterials([]); setError(env.error || 'failed'); } },
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Atom className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Materials Project</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">free api key required</span>
        </div>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); if (formula.trim()) search.mutate(); }} className="flex items-center gap-2">
        <input type="text" value={formula} onChange={(e) => setFormula(e.target.value)} placeholder="Chemical formula — Si, Fe2O3, LiCoO2, BaTiO3…" className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 font-mono text-sm text-white" />
        <button type="submit" disabled={!formula.trim() || search.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {search.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Atom className="h-3.5 w-3.5" />}
          Search
        </button>
      </form>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      <div className="space-y-1.5">
        {materials.map((m) => (
          <motion.div key={m.materialId} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="rounded border border-zinc-800 bg-zinc-950 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-base font-bold text-cyan-300">{m.formula}</span>
                  <span className="font-mono text-[10px] text-zinc-500">{m.materialId}</span>
                  {m.isStable && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-bold text-emerald-300">stable</span>}
                  {m.isMagnetic && <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[9px] font-bold text-violet-300">magnetic</span>}
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 text-[10px] text-zinc-500 sm:grid-cols-4">
                  {m.crystalSystem && <Cell label="Crystal" value={m.crystalSystem} />}
                  {m.spaceGroup && <Cell label="Space group" value={m.spaceGroup} />}
                  {m.density != null && <Cell label="Density" value={`${m.density.toFixed(2)} g/cm³`} />}
                  {m.bandGapEv != null && <Cell label="Band gap" value={`${m.bandGapEv.toFixed(2)} eV`} />}
                  {m.formationEnergyPerAtomEv != null && <Cell label="ΔHf/atom" value={`${m.formationEnergyPerAtomEv.toFixed(3)} eV`} />}
                  {m.energyAboveHullEv != null && <Cell label="Above hull" value={`${m.energyAboveHullEv.toFixed(3)} eV`} />}
                </div>
              </div>
              <SaveAsDtuButton
                compact
                apiSource="materials-project"
                apiUrl={`https://next-gen.materialsproject.org/materials/${m.materialId}`}
                title={`${m.formula} — ${m.materialId}`}
                content={JSON.stringify(m, null, 2)}
                extraTags={['materials', 'mp', m.formula.toLowerCase(), m.crystalSystem || 'unknown']}
                rawData={m}
              />
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="font-mono text-cyan-300">{value}</div>
    </div>
  );
}
