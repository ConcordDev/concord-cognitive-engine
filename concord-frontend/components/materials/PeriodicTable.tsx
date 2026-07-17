'use client';

/**
 * PeriodicTable — the classic 18-column x 7-period element browser,
 * backed by a real, cited 118-element dataset
 * (server/lib/periodic-table-data.js — IUPAC 2021 standard atomic
 * weights, NIST, CRC Handbook; see that file's header for full
 * sourcing). Click an element for its real physical constants; a
 * synthetic superheavy element with no measured bulk properties
 * renders an honest "not authoritatively known" rather than a blank
 * or a zero.
 *
 * "Find materials with {element}" deep-links into the EXISTING
 * materials.mp-search Materials Project wiring (see MpSearch.tsx) —
 * this component does not duplicate that client, it calls the same
 * macro.
 */

import { useEffect, useMemo, useState } from 'react';
import { Atom, Search, X, Loader2, ExternalLink } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface ElementRecord {
  z: number;
  symbol: string;
  name: string;
  category: string;
  categoryGroup: string;
  group: number | null;
  period: number | null;
  block: string | null;
  phase: string | null;
  gridCol: number;
  gridRow: number;
  electronConfiguration: string | null;
  standardAtomicWeight: number | null;
  massNumberOfLongestLivedIsotope: number | null;
  density: number | null;
  densityUnit: string | null;
  meltingPointC: number | null;
  boilingPointC: number | null;
  unmeasuredBulkProperties: boolean;
  predictedNotMeasured: boolean;
}

interface ElementListResult { elements: ElementRecord[]; count: number; totalElements: number }
interface ElementDetailResult {
  element: ElementRecord;
  findMaterials: { macro: string; params: { elements: string[] } };
}
interface MpMaterial {
  materialId: string; formula: string; crystalSystem?: string;
  density?: number; isStable?: boolean;
}
interface MpSearchResult { materials: MpMaterial[]; count: number }

const CATEGORY_STYLE: Record<string, { bg: string; text: string; ring: string; label: string }> = {
  'alkali-metal':          { bg: 'bg-orange-500/20',  text: 'text-orange-200',  ring: 'ring-orange-500/40',  label: 'Alkali metal' },
  'alkaline-earth-metal':  { bg: 'bg-amber-500/20',   text: 'text-amber-200',   ring: 'ring-amber-500/40',   label: 'Alkaline earth metal' },
  'transition-metal':      { bg: 'bg-sky-500/20',     text: 'text-sky-200',     ring: 'ring-sky-500/40',     label: 'Transition metal' },
  'post-transition-metal': { bg: 'bg-blue-500/20',    text: 'text-blue-200',    ring: 'ring-blue-500/40',    label: 'Post-transition metal' },
  'metalloid':             { bg: 'bg-teal-500/20',    text: 'text-teal-200',    ring: 'ring-teal-500/40',    label: 'Metalloid' },
  'nonmetal':              { bg: 'bg-emerald-500/20', text: 'text-emerald-200', ring: 'ring-emerald-500/40', label: 'Nonmetal' },
  'noble-gas':             { bg: 'bg-violet-500/20',  text: 'text-violet-200',  ring: 'ring-violet-500/40',  label: 'Noble gas' },
  lanthanide:              { bg: 'bg-pink-500/20',    text: 'text-pink-200',    ring: 'ring-pink-500/40',    label: 'Lanthanide' },
  actinide:                { bg: 'bg-rose-500/20',    text: 'text-rose-200',    ring: 'ring-rose-500/40',    label: 'Actinide' },
  unknown:                 { bg: 'bg-zinc-500/20',    text: 'text-zinc-300',    ring: 'ring-zinc-500/40',    label: 'Unclassified / predicted' },
};

function styleFor(group: string) {
  return CATEGORY_STYLE[group] || CATEGORY_STYLE.unknown;
}

const LEGEND_ORDER = ['alkali-metal', 'alkaline-earth-metal', 'lanthanide', 'actinide', 'transition-metal', 'post-transition-metal', 'metalloid', 'nonmetal', 'noble-gas', 'unknown'];

export function PeriodicTable() {
  const [elements, setElements] = useState<ElementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<ElementRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [findResult, setFindResult] = useState<MpSearchResult | null>(null);
  const [findLoading, setFindLoading] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await lensRun<ElementListResult>('materials', 'element-list', {});
      if (cancelled) return;
      if (r.data?.ok && r.data.result) setElements(r.data.result.elements);
      else setLoadError(r.data?.error || 'failed to load periodic table data');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const matchesQuery = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return new Set(
      elements
        .filter((e) => e.name.toLowerCase().includes(q) || e.symbol.toLowerCase() === q || String(e.z) === q)
        .map((e) => e.z),
    );
  }, [elements, query]);

  async function openElement(symbol: string) {
    setDetailLoading(true);
    setFindResult(null);
    setFindError(null);
    const r = await lensRun<ElementDetailResult>('materials', 'element-detail', { symbol });
    if (r.data?.ok && r.data.result) setSelected(r.data.result.element);
    setDetailLoading(false);
  }

  async function findMaterialsWithElement(symbol: string) {
    setFindLoading(true);
    setFindError(null);
    setFindResult(null);
    const r = await lensRun<MpSearchResult>('materials', 'mp-search', { elements: [symbol], limit: 12 });
    if (r.data?.ok && r.data.result) setFindResult(r.data.result);
    else setFindError(r.data?.error || 'search failed');
    setFindLoading(false);
  }

  // Two static footnote-pointer cells inside the main grid (classic
  // periodic-table convention) — La/Ac themselves render in rows 9/10.
  const footnotePointers = [
    { col: 3, row: 6, text: '57–71' },
    { col: 3, row: 7, text: '89–103' },
  ];

  if (loading) {
    return <div className="flex items-center justify-center gap-2 py-10 text-zinc-400 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading periodic table…</div>;
  }
  if (loadError) {
    return <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{loadError}</div>;
  }

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2">
          <Atom className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Periodic Table</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">{elements.length} elements &middot; IUPAC / NIST / CRC</span>
        </div>
        <div className="relative w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            type="text" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, symbol, Z…"
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
          />
        </div>
      </header>

      {/* Category legend — click a swatch to filter the grid */}
      <div className="flex flex-wrap gap-1.5">
        {LEGEND_ORDER.map((g) => {
          const s = styleFor(g);
          const active = categoryFilter === g;
          return (
            <button
              key={g} type="button"
              onClick={() => setCategoryFilter(active ? null : g)}
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 transition-opacity',
                s.bg, s.text, s.ring,
                categoryFilter && !active ? 'opacity-30' : 'opacity-100',
              )}
            >
              {s.label}
            </button>
          );
        })}
        {categoryFilter && (
          <button type="button" onClick={() => setCategoryFilter(null)} className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700">
            clear filter
          </button>
        )}
      </div>

      {/* The grid: CSS grid using the dataset's own gridCol/gridRow so the
          classic layout (rows 1-7 + spacer row 8 + f-block footnote rows
          9-10) comes directly from the cited data, not a hand-maintained
          layout table. */}
      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
        <div className="grid gap-0.5" style={{ gridTemplateColumns: 'repeat(18, minmax(38px, 1fr))', gridTemplateRows: 'repeat(10, minmax(38px, auto))', minWidth: '760px' }}>
          {footnotePointers.map((p) => (
            <div key={p.text} style={{ gridColumn: p.col, gridRow: p.row }} className="flex items-center justify-center rounded border border-dashed border-zinc-700 text-[9px] text-zinc-500">
              {p.text}
            </div>
          ))}
          {elements.map((e) => {
            const s = styleFor(e.categoryGroup);
            const dimmed = categoryFilter ? e.categoryGroup !== categoryFilter : matchesQuery ? !matchesQuery.has(e.z) : false;
            return (
              <button
                key={e.z}
                type="button"
                onClick={() => void openElement(e.symbol)}
                title={`${e.name} (Z=${e.z})`}
                style={{ gridColumn: e.gridCol, gridRow: e.gridRow }}
                className={cn(
                  'flex flex-col items-center justify-center rounded border px-0.5 py-0.5 text-left transition-all',
                  s.bg, s.ring, 'ring-1 border-transparent hover:scale-[1.08] hover:z-10 hover:shadow-lg',
                  dimmed ? 'opacity-20' : 'opacity-100',
                )}
              >
                <span className="text-[8px] leading-none text-zinc-400">{e.z}</span>
                <span className={cn('font-mono text-xs font-bold leading-tight', s.text)}>{e.symbol}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Detail panel */}
      {(selected || detailLoading) && (
        <div className="rounded-xl border border-cyan-500/20 bg-zinc-950/60 p-4">
          {detailLoading && !selected ? (
            <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading element…</div>
          ) : selected ? (
            <ElementDetail
              element={selected}
              onClose={() => { setSelected(null); setFindResult(null); setFindError(null); }}
              onFindMaterials={() => void findMaterialsWithElement(selected.symbol)}
              findLoading={findLoading}
              findResult={findResult}
              findError={findError}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function fmt(value: number | null, unit: string, digits = 2): string {
  if (value == null) return '';
  return `${value.toFixed(digits)} ${unit}`;
}

function ElementDetail({
  element, onClose, onFindMaterials, findLoading, findResult, findError,
}: {
  element: ElementRecord;
  onClose: () => void;
  onFindMaterials: () => void;
  findLoading: boolean;
  findResult: MpSearchResult | null;
  findError: string | null;
}) {
  const s = styleFor(element.categoryGroup);
  const NOT_KNOWN = <span className="italic text-zinc-500">not authoritatively known</span>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={cn('flex h-14 w-14 flex-col items-center justify-center rounded-lg ring-1', s.bg, s.ring)}>
            <span className="text-[9px] text-zinc-400">{element.z}</span>
            <span className={cn('font-mono text-xl font-bold', s.text)}>{element.symbol}</span>
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">{element.name}</h3>
            <p className={cn('text-[11px]', s.text)}>{element.category}</p>
          </div>
        </div>
        <button onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-800" aria-label="Close element detail"><X className="h-4 w-4" /></button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Cell label="Group / Period / Block" value={`${element.group ?? '—'} / ${element.period ?? '—'} / ${element.block ?? '—'}`} />
        <Cell label="Phase (STP)" value={element.phase || '—'} />
        <Cell label="Electron configuration" value={element.electronConfiguration || '—'} mono />
        <Cell
          label="Standard atomic weight"
          value={element.standardAtomicWeight != null ? String(element.standardAtomicWeight) : undefined}
          fallback={element.massNumberOfLongestLivedIsotope != null
            ? <span className="text-zinc-300">no natural isotopic mixture — longest-lived isotope mass number <span className="font-mono">[{element.massNumberOfLongestLivedIsotope}]</span></span>
            : NOT_KNOWN}
        />
        <Cell
          label="Density"
          value={element.density != null ? fmt(element.density, element.densityUnit || '', element.density < 1 ? 5 : 3) : undefined}
          fallback={NOT_KNOWN}
        />
        <Cell
          label="Melting point"
          value={element.meltingPointC != null ? `${element.meltingPointC.toFixed(2)} °C` : undefined}
          fallback={NOT_KNOWN}
        />
        <Cell
          label="Boiling point"
          value={element.boilingPointC != null ? `${element.boilingPointC.toFixed(2)} °C` : undefined}
          fallback={NOT_KNOWN}
        />
      </div>

      {element.unmeasuredBulkProperties && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200">
          Element {element.z} has never been produced in a macroscopic (weighable) sample — every atom ever synthesized has decayed within milliseconds to minutes. Bulk properties above are left blank rather than estimated.
        </div>
      )}
      {!element.unmeasuredBulkProperties && element.predictedNotMeasured && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200">
          {element.name} has never been isolated in weighable quantity. The values shown are long-standing published estimates extrapolated from periodic trends, not direct measurements.
        </div>
      )}

      <div className="border-t border-zinc-800 pt-3">
        <button
          type="button" onClick={onFindMaterials} disabled={findLoading}
          className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {findLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
          Find materials containing {element.symbol}
        </button>
        <p className="mt-1 text-[10px] text-zinc-500">Runs the real Materials Project search (materials.mp-search) — the same client as the search panel above.</p>

        {findError && <div className="mt-2 rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{findError}</div>}

        {findResult && (
          <div className="mt-2 space-y-1.5">
            {findResult.materials.length === 0 && <p className="text-xs text-zinc-400">No Materials Project entries returned for {element.symbol}.</p>}
            {findResult.materials.map((m) => (
              <div key={m.materialId} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-[11px]">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono font-semibold text-cyan-300">{m.formula}</span>
                  <span className="font-mono text-zinc-500">{m.materialId}</span>
                  {m.crystalSystem && <span className="text-zinc-400">{m.crystalSystem}</span>}
                </div>
                {m.isStable && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-bold text-emerald-300">stable</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Cell({ label, value, fallback, mono }: { label: string; value?: string; fallback?: React.ReactNode; mono?: boolean }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={cn('text-[11px] text-zinc-200', mono && 'font-mono break-all')}>
        {value != null && value !== '' ? value : (fallback ?? <span className="italic text-zinc-500">—</span>)}
      </div>
    </div>
  );
}
