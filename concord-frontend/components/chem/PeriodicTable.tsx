'use client';

/**
 * PeriodicTable — bespoke 118-element periodic table for the chem lens.
 * Backed by chem.periodic-table (authored 118-element corpus) +
 * chem.molecular-weight (formula → MW computation).
 *
 * Per category-leader research (PubChem, RSC Visual Elements, Wikipedia):
 *   • 18×7 CSS grid with lanthanide/actinide series broken out below
 *   • Element cell: atomic-number top-left, symbol centered (20px),
 *     atomic mass bottom (9px), color-coded by category
 *   • Click → detail card with full element data + Save-as-DTU
 */

import { useState, useEffect, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Atom, Loader2, X } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Element {
  z: number;
  symbol: string;
  name: string;
  atomicMass?: number;
  category?: string;
  group?: number;
  period?: number;
  electronegativity?: number;
  density?: number;
  meltingPoint?: number;
  boilingPoint?: number;
  phase?: string;
  block?: string;
  electronConfiguration?: string;
  discoveredBy?: string;
  yearDiscovered?: number;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('chem', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

// Keys match the underscored category strings the chem.periodic-table handler
// returns (alkali_metal, noble_gas, …) — NOT the space-separated forms that
// were here before, which never matched a single element and painted the whole
// table 'unknown'. ChemWorkbench's PeriodicTab uses the same underscored keys.
const CATEGORY_COLOR: Record<string, string> = {
  'alkali_metal': 'bg-rose-500/15 text-rose-200 border-rose-500/30',
  'alkaline_earth': 'bg-amber-500/15 text-amber-200 border-amber-500/30',
  'transition_metal': 'bg-cyan-500/15 text-cyan-200 border-cyan-500/30',
  'post_transition': 'bg-sky-500/15 text-sky-200 border-sky-500/30',
  'metalloid': 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30',
  'nonmetal': 'bg-lime-500/15 text-lime-200 border-lime-500/30',
  'halogen': 'bg-yellow-500/15 text-yellow-200 border-yellow-500/30',
  'noble_gas': 'bg-violet-500/15 text-violet-200 border-violet-500/30',
  'lanthanide': 'bg-fuchsia-500/15 text-fuchsia-200 border-fuchsia-500/30',
  'actinide': 'bg-pink-500/15 text-pink-200 border-pink-500/30',
  'unknown': 'bg-zinc-800 text-zinc-400 border-zinc-700',
};

// Period+group positions for the 18×7 main grid; lanthanides + actinides
// rendered below with their own positions.
function gridPos(e: Element): { row: number; col: number } | null {
  if (e.z >= 57 && e.z <= 71) return { row: 8, col: e.z - 56 + 2 };       // lanthanides
  if (e.z >= 89 && e.z <= 103) return { row: 9, col: e.z - 88 + 2 };      // actinides
  if (!e.group || !e.period) return null;
  return { row: e.period, col: e.group };
}

export function PeriodicTable() {
  const [elements, setElements] = useState<Element[]>([]);
  const [focus, setFocus] = useState<Element | null>(null);

  const load = useMutation({
    mutationFn: async () => callMacro<{ elements: Record<string, Element> | Element[] }>('periodic-table', {}),
    onSuccess: (env) => {
      if (env.ok && env.result) {
        const raw = env.result.elements;
        const arr = Array.isArray(raw) ? raw : Object.values(raw);
        setElements(arr.sort((a, b) => a.z - b.z));
      }
    },
  });

  useEffect(() => {
    load.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutate is stable
  }, []);

  // Build a quick (row, col) → element lookup
  const byPos = useMemo(() => {
    const m = new Map<string, Element>();
    for (const e of elements) {
      const p = gridPos(e);
      if (p) m.set(`${p.row}-${p.col}`, e);
    }
    return m;
  }, [elements]);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Atom className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Periodic Table</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            118 elements
          </span>
        </div>
      </header>

      {load.isPending && (
        <div className="flex items-center justify-center py-6 text-xs text-zinc-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading periodic table…
        </div>
      )}

      {elements.length > 0 && (
        <div className="overflow-x-auto">
          <div
            className="grid gap-0.5"
            style={{ gridTemplateColumns: 'repeat(18, minmax(36px, 1fr))', gridTemplateRows: 'repeat(9, minmax(44px, auto))' }}
          >
            {Array.from({ length: 9 }, (_, r) => r + 1).flatMap((row) =>
              Array.from({ length: 18 }, (_, c) => c + 1).map((col) => {
                const e = byPos.get(`${row}-${col}`);
                if (!e) {
                  // Placeholder for La/Ac series gap in row 6/7 (col 3)
                  if ((row === 6 || row === 7) && col === 3) {
                    return (
                      <div key={`${row}-${col}`} className="rounded border border-dashed border-zinc-800 bg-zinc-950/30 text-center text-[8px] text-zinc-400" style={{ gridRow: row, gridColumn: col }}>
                        {row === 6 ? '57-71' : '89-103'}
                      </div>
                    );
                  }
                  return null;
                }
                const cat = (e.category || 'unknown').toLowerCase();
                const colorClass = CATEGORY_COLOR[cat] || CATEGORY_COLOR.unknown;
                return (
                  <button
                    key={`${row}-${col}`}
                    type="button"
                    onClick={() => setFocus(e)}
                    style={{ gridRow: row, gridColumn: col }}
                    className={`flex flex-col items-center justify-center rounded border ${colorClass} px-0.5 py-1 text-center transition-transform hover:scale-110 hover:z-10 hover:ring-1 hover:ring-cyan-500/50`}
                    title={`${e.name} (${e.symbol}) · Z=${e.z}`}
                  >
                    <div className="self-start text-[8px] font-mono opacity-70">{e.z}</div>
                    <div className="-mt-0.5 text-base font-bold leading-none">{e.symbol}</div>
                    {e.atomicMass != null && <div className="text-[8px] opacity-60">{e.atomicMass.toFixed(1)}</div>}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {focus && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-xs text-zinc-400">Z={focus.z}</span>
                <h3 className="text-2xl font-bold text-white">{focus.symbol}</h3>
                <span className="text-base text-cyan-300">{focus.name}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${CATEGORY_COLOR[focus.category?.toLowerCase() || 'unknown']}`}>
                  {focus.category}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                {focus.atomicMass != null && <Cell label="Atomic mass" value={`${focus.atomicMass.toFixed(3)} u`} />}
                {focus.group && <Cell label="Group" value={String(focus.group)} />}
                {focus.period && <Cell label="Period" value={String(focus.period)} />}
                {focus.electronegativity != null && <Cell label="Electronegativity" value={String(focus.electronegativity)} />}
                {focus.density != null && <Cell label="Density" value={`${focus.density} g/cm³`} />}
                {focus.meltingPoint != null && <Cell label="Melting point" value={`${focus.meltingPoint} K`} />}
                {focus.boilingPoint != null && <Cell label="Boiling point" value={`${focus.boilingPoint} K`} />}
                {focus.phase && <Cell label="Phase (STP)" value={focus.phase} />}
                {focus.block && <Cell label="Block" value={focus.block.toUpperCase()} />}
                {focus.electronConfiguration && <Cell label="Config" value={focus.electronConfiguration} mono />}
                {focus.discoveredBy && <Cell label="Discovered by" value={focus.discoveredBy} />}
                {focus.yearDiscovered != null && <Cell label="Year" value={String(focus.yearDiscovered)} />}
              </dl>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <SaveAsDtuButton
                compact
                apiSource="concord-periodic-table"
                apiUrl={`https://pubchem.ncbi.nlm.nih.gov/element/${focus.z}`}
                title={`${focus.symbol} — ${focus.name} (Z=${focus.z})`}
                content={[
                  `Element: ${focus.name} (${focus.symbol})`,
                  `Atomic number: ${focus.z}`,
                  focus.atomicMass != null ? `Atomic mass: ${focus.atomicMass}` : '',
                  focus.category ? `Category: ${focus.category}` : '',
                  focus.electronConfiguration ? `Electron config: ${focus.electronConfiguration}` : '',
                  focus.density != null ? `Density: ${focus.density} g/cm³` : '',
                  focus.meltingPoint != null ? `Melting point: ${focus.meltingPoint} K` : '',
                  focus.boilingPoint != null ? `Boiling point: ${focus.boilingPoint} K` : '',
                  focus.discoveredBy ? `Discovered by: ${focus.discoveredBy}` : '',
                  focus.yearDiscovered != null ? `Year: ${focus.yearDiscovered}` : '',
                ].filter(Boolean).join('\n')}
                extraTags={['chem', 'element', focus.symbol.toLowerCase(), focus.category || 'element']}
                rawData={focus}
              />
              <button type="button" onClick={() => setFocus(null)} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

function Cell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className={`mt-0.5 text-sm text-white ${mono ? 'font-mono text-xs' : ''}`}>{value}</div>
    </div>
  );
}
