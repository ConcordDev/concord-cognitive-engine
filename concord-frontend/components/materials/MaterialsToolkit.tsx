'use client';

/**
 * MaterialsToolkit — professional materials-selection workflow surface.
 * Wires six materials-domain macros that the Granta MI feature-parity
 * backlog called for: ashby-plot, multi-criteria-rank, datasheet,
 * import-test-csv, standards-crossref, sustainability.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, ScatterChart, ListChecks, FileText, Upload,
  BookMarked, Leaf, Trophy, Download,
} from 'lucide-react';
import { ChartKit } from '@/components/viz';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type ToolTab = 'ashby' | 'rank' | 'datasheet' | 'import' | 'standards' | 'carbon';

const TABS: { id: ToolTab; label: string; icon: typeof ScatterChart }[] = [
  { id: 'ashby', label: 'Ashby Chart', icon: ScatterChart },
  { id: 'rank', label: 'Multi-Criteria', icon: ListChecks },
  { id: 'datasheet', label: 'Datasheet', icon: FileText },
  { id: 'import', label: 'Test Import', icon: Upload },
  { id: 'standards', label: 'Standards', icon: BookMarked },
  { id: 'carbon', label: 'Sustainability', icon: Leaf },
];

const AXIS_OPTIONS = [
  { key: 'density', label: 'Density (g/cm³)' },
  { key: 'tensileStrengthMPa', label: 'Tensile strength (MPa)' },
  { key: 'meltingPointC', label: 'Melting point (°C)' },
  { key: 'youngsModulusGPa', label: "Young's modulus (GPa)" },
  { key: 'costPerKg', label: 'Cost per kg' },
];

interface ShortlistMaterial { id: string; name: string }

// ── Ashby chart ──────────────────────────────────────────────────────
interface AshbyPoint { id: string; name: string; category: string; x: number; y: number; materialIndex: number }
interface AshbyResult {
  xKey: string; yKey: string; xLabel: string; yLabel: string;
  points: AshbyPoint[]; count: number;
  bestIndex: { name: string; materialIndex: number } | null;
  guideNote: string; message?: string;
}

function AshbyTab() {
  const [xKey, setXKey] = useState('density');
  const [yKey, setYKey] = useState('tensileStrengthMPa');
  const [result, setResult] = useState<AshbyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plot = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<AshbyResult>('materials', 'ashby-plot', { xKey, yKey });
    setLoading(false);
    if (r.data.ok && r.data.result) setResult(r.data.result);
    else { setResult(null); setError(r.data.error || 'failed to build plot'); }
  }, [xKey, yKey]);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">
        2D material-selection scatter from your shortlist. Material index = Y/X; the top point sits in the optimal selection corner.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-zinc-400">
          X axis
          <select value={xKey} onChange={(e) => setXKey(e.target.value)}
            className="mt-0.5 block w-44 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-200">
            {AXIS_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-zinc-400">
          Y axis
          <select value={yKey} onChange={(e) => setYKey(e.target.value)}
            className="mt-0.5 block w-44 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-200">
            {AXIS_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <button onClick={() => void plot()} disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-40">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScatterChart className="h-3.5 w-3.5" />}
          Plot
        </button>
      </div>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      {result && (result.message || result.points.length === 0) && (
        <p className="text-xs italic text-zinc-400">{result.message || 'No plottable points.'}</p>
      )}
      {result && result.points.length > 0 && (
        <div className="space-y-2">
          <ChartKit
            kind="scatter"
            data={result.points.map((p) => ({ x: p.x, y: p.y, name: p.name }))}
            xKey="x"
            series={[{ key: 'y', label: `${result.yLabel} vs ${result.xLabel}` }]}
            height={260}
            showLegend={false}
          />
          {result.bestIndex && (
            <p className="text-xs text-emerald-300">
              <Trophy className="mr-1 inline h-3 w-3" />
              Best material index: <strong>{result.bestIndex.name}</strong> ({result.bestIndex.materialIndex})
            </p>
          )}
          <ul className="space-y-1">
            {result.points.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1 text-[11px]">
                <span className="font-semibold text-zinc-100">{p.name}</span>
                <span className="text-zinc-400">{result.xLabel.split(' ')[0]} {p.x}</span>
                <span className="text-zinc-400">{result.yLabel.split(' ')[0]} {p.y}</span>
                <span className="ml-auto text-cyan-300">index {p.materialIndex}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Multi-criteria selection wizard ──────────────────────────────────
interface Criterion { key: string; weight: number; goal: 'max' | 'min' }
interface RankBreakdown { key: string; value: number | null; normalized: number; weight: number; contribution: number }
interface RankRow { id: string; name: string; category: string; score: number; scorePct: number; missingCriteria: number; breakdown: RankBreakdown[] }
interface RankResult { criteria: Criterion[]; totalWeight: number; rankings: RankRow[]; count: number; recommended: string | null }

function RankTab() {
  const [criteria, setCriteria] = useState<Criterion[]>([
    { key: 'tensileStrengthMPa', weight: 50, goal: 'max' },
    { key: 'density', weight: 50, goal: 'min' },
  ]);
  const [result, setResult] = useState<RankResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(i: number, patch: Partial<Criterion>) {
    setCriteria((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function addRow() {
    const used = new Set(criteria.map((c) => c.key));
    const next = AXIS_OPTIONS.find((o) => !used.has(o.key));
    if (next) setCriteria((cs) => [...cs, { key: next.key, weight: 25, goal: 'max' }]);
  }
  function removeRow(i: number) {
    setCriteria((cs) => cs.filter((_, idx) => idx !== i));
  }

  const rank = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<RankResult>('materials', 'multi-criteria-rank', { criteria });
    setLoading(false);
    if (r.data.ok && r.data.result) setResult(r.data.result);
    else { setResult(null); setError(r.data.error || 'failed to rank'); }
  }, [criteria]);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">
        Weighted-objective ranking against your design requirements. Each criterion is min-max normalised across the shortlist.
      </p>
      <div className="space-y-1.5">
        {criteria.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1.5">
            <select value={c.key} onChange={(e) => update(i, { key: e.target.value })}
              className="w-44 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-200">
              {AXIS_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <select value={c.goal} onChange={(e) => update(i, { goal: e.target.value as 'max' | 'min' })}
              className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-200">
              <option value="max">maximize</option>
              <option value="min">minimize</option>
            </select>
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              weight
              <input type="range" min={0} max={100} value={c.weight}
                onChange={(e) => update(i, { weight: Number(e.target.value) })} className="w-24" />
              <span className="w-7 text-right text-zinc-200">{c.weight}</span>
            </label>
            {criteria.length > 1 && (
              <button onClick={() => removeRow(i)} className="ml-auto text-[11px] text-rose-400 hover:text-rose-300">remove</button>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={addRow} disabled={criteria.length >= AXIS_OPTIONS.length}
          className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-40">
          + criterion
        </button>
        <button onClick={() => void rank()} disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-40">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListChecks className="h-3.5 w-3.5" />}
          Rank shortlist
        </button>
      </div>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      {result && (
        <div className="space-y-2">
          {result.recommended && (
            <p className="text-xs text-emerald-300">
              <Trophy className="mr-1 inline h-3 w-3" />Recommended: <strong>{result.recommended}</strong>
            </p>
          )}
          <ul className="space-y-1">
            {result.rankings.map((row, i) => (
              <li key={row.id} className="rounded border border-zinc-800 bg-zinc-900/50 px-2.5 py-1.5">
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-5 text-zinc-400">#{i + 1}</span>
                  <span className="font-semibold text-zinc-100">{row.name}</span>
                  <span className="text-[10px] text-zinc-400">{row.category}</span>
                  {row.missingCriteria > 0 && (
                    <span className="text-[10px] text-amber-400">{row.missingCriteria} missing</span>
                  )}
                  <span className="ml-auto text-cyan-300">{row.scorePct}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded bg-zinc-800">
                  <div className="h-full bg-cyan-500" style={{ width: `${row.scorePct}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Datasheet generator ──────────────────────────────────────────────
interface DatasheetRow { label: string; value: number; unit: string }
interface DatasheetResult {
  datasheet: {
    name: string; formula: string | null; category: string; generatedAt: string;
    measuredProperties: DatasheetRow[]; derivedProperties: DatasheetRow[]; notes: string;
  };
  plainText: string;
}

function DatasheetTab() {
  const [shortlist, setShortlist] = useState<ShortlistMaterial[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [result, setResult] = useState<DatasheetResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadShortlist = useCallback(async () => {
    const r = await lensRun<{ materials: ShortlistMaterial[] }>('materials', 'shortlist-list', {});
    if (r.data.ok && r.data.result) setShortlist(r.data.result.materials || []);
  }, []);
  useEffect(() => { void loadShortlist(); }, [loadShortlist]);

  const generate = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    const r = await lensRun<DatasheetResult>('materials', 'datasheet', { id: selectedId });
    setLoading(false);
    if (r.data.ok && r.data.result) setResult(r.data.result);
    else { setResult(null); setError(r.data.error || 'failed to generate'); }
  }, [selectedId]);

  function download() {
    if (!result) return;
    const blob = new Blob([result.plainText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `datasheet-${result.datasheet.name.replace(/\s+/g, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">
        Generate an exportable spec sheet for a shortlisted material — measured plus derived properties.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}
          className="w-56 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200">
          <option value="">Select a shortlisted material…</option>
          {shortlist.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <button onClick={() => void generate()} disabled={!selectedId || loading}
          className="inline-flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-40">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
          Generate
        </button>
        <button onClick={loadShortlist} className="text-[11px] text-zinc-400 hover:text-zinc-300">refresh list</button>
      </div>
      {shortlist.length === 0 && (
        <p className="text-xs italic text-zinc-400">No shortlisted materials — add candidates in the shortlist panel below.</p>
      )}
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      {result && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-bold text-zinc-100">{result.datasheet.name}</h4>
            {result.datasheet.formula && <span className="font-mono text-[11px] text-cyan-300">{result.datasheet.formula}</span>}
            <span className="text-[10px] text-zinc-400">{result.datasheet.category}</span>
            <button onClick={download}
              className="ml-auto inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800">
              <Download className="h-3 w-3" />Export
            </button>
          </div>
          {result.datasheet.measuredProperties.length > 0 && (
            <div className="mt-2">
              <p className="text-[10px] uppercase tracking-wide text-zinc-400">Measured</p>
              <table className="mt-1 w-full text-xs">
                <tbody>
                  {result.datasheet.measuredProperties.map((r) => (
                    <tr key={r.label} className="border-t border-zinc-800/60">
                      <td className="py-1 text-zinc-400">{r.label}</td>
                      <td className="py-1 text-right text-zinc-100">{r.value} {r.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.datasheet.derivedProperties.length > 0 && (
            <div className="mt-2">
              <p className="text-[10px] uppercase tracking-wide text-zinc-400">Derived</p>
              <table className="mt-1 w-full text-xs">
                <tbody>
                  {result.datasheet.derivedProperties.map((r) => (
                    <tr key={r.label} className="border-t border-zinc-800/60">
                      <td className="py-1 text-zinc-400">{r.label}</td>
                      <td className="py-1 text-right text-emerald-300">{r.value} {r.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Test-data import ─────────────────────────────────────────────────
interface ColStat { count: number; mean: number; min: number; max: number; stdev: number }
interface ImportResult {
  columns: string[]; rowCount: number;
  rows: Record<string, string>[]; stats: Record<string, ColStat>;
  attachedTo: string | null;
}

function ImportTab() {
  const [shortlist, setShortlist] = useState<ShortlistMaterial[]>([]);
  const [attachId, setAttachId] = useState('');
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadShortlist = useCallback(async () => {
    const r = await lensRun<{ materials: ShortlistMaterial[] }>('materials', 'shortlist-list', {});
    if (r.data.ok && r.data.result) setShortlist(r.data.result.materials || []);
  }, []);
  useEffect(() => { void loadShortlist(); }, [loadShortlist]);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result || ''));
    reader.readAsText(file);
  }

  const importCsv = useCallback(async () => {
    if (!csv.trim()) return;
    setLoading(true);
    setError(null);
    const r = await lensRun<ImportResult>('materials', 'import-test-csv', {
      csv, id: attachId || undefined,
    });
    setLoading(false);
    if (r.data.ok && r.data.result) setResult(r.data.result);
    else { setResult(null); setError(r.data.error || 'failed to import'); }
  }, [csv, attachId]);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">
        Ingest mechanical test results from CSV — header row plus data rows. Numeric columns get count / mean / min / max / stdev.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input type="file" accept=".csv,text/csv" onChange={onFile}
          className="text-[11px] text-zinc-400 file:mr-2 file:rounded file:border-0 file:bg-zinc-800 file:px-2 file:py-1 file:text-zinc-200" />
        <select value={attachId} onChange={(e) => setAttachId(e.target.value)}
          className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-200">
          <option value="">Don&apos;t attach</option>
          {shortlist.map((m) => <option key={m.id} value={m.id}>attach to {m.name}</option>)}
        </select>
      </div>
      <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={5}
        placeholder="specimen,stress_MPa,strain_pct,modulus_GPa&#10;S1,420,12.3,201&#10;S2,431,11.8,205"
        className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-[11px] text-zinc-200" />
      <button onClick={() => void importCsv()} disabled={!csv.trim() || loading}
        className="inline-flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-40">
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
        Import
      </button>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      {result && (
        <div className="space-y-2">
          <p className="text-xs text-zinc-400">
            Imported {result.rowCount} row{result.rowCount === 1 ? '' : 's'}
            {result.attachedTo && <span className="text-emerald-300"> · attached to {result.attachedTo}</span>}
          </p>
          {Object.keys(result.stats).length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-zinc-400">
                  <th className="py-1 pr-2">Column</th>
                  <th className="py-1 px-2">N</th>
                  <th className="py-1 px-2">Mean</th>
                  <th className="py-1 px-2">Min</th>
                  <th className="py-1 px-2">Max</th>
                  <th className="py-1 pl-2">Stdev</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(result.stats).map(([col, s]) => (
                  <tr key={col} className="border-t border-zinc-800">
                    <td className="py-1 pr-2 text-zinc-300">{col}</td>
                    <td className="py-1 px-2 text-zinc-400">{s.count}</td>
                    <td className="py-1 px-2 text-cyan-300">{s.mean}</td>
                    <td className="py-1 px-2 text-zinc-400">{s.min}</td>
                    <td className="py-1 px-2 text-zinc-400">{s.max}</td>
                    <td className="py-1 pl-2 text-zinc-400">{s.stdev}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ── Standards cross-reference ────────────────────────────────────────
interface StandardEntry { body: string; id: string }
interface StandardsResult {
  material?: string; matched?: boolean; matchedKey?: string;
  standards?: StandardEntry[]; available?: string[];
  disclaimer?: string; message?: string;
}

function StandardsTab() {
  const [material, setMaterial] = useState('');
  const [result, setResult] = useState<StandardsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    const r = await lensRun<StandardsResult>('materials', 'standards-crossref', { material: q });
    setLoading(false);
    if (r.data.ok && r.data.result) setResult(r.data.result);
    else { setResult(null); setError(r.data.error || 'lookup failed'); }
  }, []);
  useEffect(() => { void lookup(''); }, [lookup]);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">
        Cross-reference a material to ASTM / ISO / EN / DIN / JIS / UNS designations from a curated equivalence table.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); void lookup(material); }} className="flex items-center gap-2">
        <input value={material} onChange={(e) => setMaterial(e.target.value)}
          placeholder="e.g. stainless 304, aluminum 6061"
          className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200" />
        <button type="submit" disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-40">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookMarked className="h-3.5 w-3.5" />}
          Cross-reference
        </button>
      </form>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      {result?.available && !result.matched && (
        <div className="text-[11px] text-zinc-400">
          {result.message || result.disclaimer}
          <div className="mt-1.5 flex flex-wrap gap-1">
            {result.available.map((a) => (
              <button key={a} onClick={() => { setMaterial(a); void lookup(a); }}
                className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300 hover:bg-zinc-700">{a}</button>
            ))}
          </div>
        </div>
      )}
      {result?.matched && result.standards && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <p className="mb-2 text-xs text-zinc-400">
            <span className="font-semibold text-zinc-100">{result.material}</span> — matched to{' '}
            <span className="text-cyan-300">{result.matchedKey}</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {result.standards.map((s) => (
              <span key={`${s.body}-${s.id}`} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px]">
                <span className="font-bold text-cyan-300">{s.body}</span>{' '}
                <span className="text-zinc-200">{s.id}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sustainability / embodied carbon ─────────────────────────────────
interface CarbonResult {
  material?: string; matched?: boolean; matchedKey?: string;
  metrics?: {
    embodiedCarbonKgCO2ePerKg: number; embodiedEnergyMJPerKg: number;
    recyclabilityPct: number; renewable: boolean; carbonGrade: string; carbonRank: string;
  };
  footprint?: { massKg: number; totalCarbonKgCO2e: number; totalEnergyMJ: number } | null;
  available?: string[]; disclaimer?: string; message?: string;
}

const GRADE_COLOR: Record<string, string> = {
  A: 'text-emerald-300', B: 'text-lime-300', C: 'text-amber-300', D: 'text-orange-300', E: 'text-rose-300',
};

function CarbonTab() {
  const [material, setMaterial] = useState('');
  const [massKg, setMassKg] = useState('');
  const [result, setResult] = useState<CarbonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = useCallback(async (q: string, mass: string) => {
    setLoading(true);
    setError(null);
    const r = await lensRun<CarbonResult>('materials', 'sustainability', {
      material: q, massKg: mass ? Number(mass) : undefined,
    });
    setLoading(false);
    if (r.data.ok && r.data.result) setResult(r.data.result);
    else { setResult(null); setError(r.data.error || 'lookup failed'); }
  }, []);
  useEffect(() => { void lookup('', ''); }, [lookup]);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">
        Embodied carbon (kg CO₂e/kg), embodied energy, and recyclability from curated ICE / industry-average data.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); void lookup(material, massKg); }} className="flex flex-wrap items-center gap-2">
        <input value={material} onChange={(e) => setMaterial(e.target.value)}
          placeholder="e.g. aluminum, steel, carbon fiber"
          className="flex-1 min-w-[160px] rounded border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200" />
        <input value={massKg} onChange={(e) => setMassKg(e.target.value)} type="number" min={0}
          placeholder="mass (kg)"
          className="w-28 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200" />
        <button type="submit" disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-40">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Leaf className="h-3.5 w-3.5" />}
          Assess
        </button>
      </form>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      {result?.available && !result.matched && (
        <div className="text-[11px] text-zinc-400">
          {result.message || result.disclaimer}
          <div className="mt-1.5 flex flex-wrap gap-1">
            {result.available.map((a) => (
              <button key={a} onClick={() => { setMaterial(a); void lookup(a, massKg); }}
                className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300 hover:bg-zinc-700">{a}</button>
            ))}
          </div>
        </div>
      )}
      {result?.matched && result.metrics && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-100">{result.material}</span>
            <span className="text-[10px] text-zinc-400">{result.matchedKey}</span>
            <span className={cn('ml-auto text-lg font-bold', GRADE_COLOR[result.metrics.carbonGrade] || 'text-zinc-300')}>
              {result.metrics.carbonGrade}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div className="rounded border border-zinc-800 bg-zinc-900/50 p-2">
              <p className="text-[10px] text-zinc-400">Embodied carbon</p>
              <p className="font-bold text-zinc-100">{result.metrics.embodiedCarbonKgCO2ePerKg}</p>
              <p className="text-[10px] text-zinc-400">kg CO₂e/kg</p>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-900/50 p-2">
              <p className="text-[10px] text-zinc-400">Embodied energy</p>
              <p className="font-bold text-zinc-100">{result.metrics.embodiedEnergyMJPerKg}</p>
              <p className="text-[10px] text-zinc-400">MJ/kg</p>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-900/50 p-2">
              <p className="text-[10px] text-zinc-400">Recyclability</p>
              <p className="font-bold text-zinc-100">{result.metrics.recyclabilityPct}%</p>
              <p className="text-[10px] text-zinc-400">{result.metrics.renewable ? 'renewable' : 'non-renewable'}</p>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-900/50 p-2">
              <p className="text-[10px] text-zinc-400">Carbon rank</p>
              <p className="font-bold text-zinc-100">{result.metrics.carbonRank}</p>
            </div>
          </div>
          {result.footprint && (
            <div className="mt-2 rounded border border-emerald-500/20 bg-emerald-500/5 p-2 text-xs text-emerald-200">
              For {result.footprint.massKg} kg: {result.footprint.totalCarbonKgCO2e} kg CO₂e ·{' '}
              {result.footprint.totalEnergyMJ} MJ
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MaterialsToolkit() {
  const [tab, setTab] = useState<ToolTab>('ashby');

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <h3 className="mb-3 text-sm font-bold text-zinc-100">Materials Selection Toolkit</h3>
      <nav className="mb-3 flex flex-wrap gap-1.5 border-b border-zinc-800 pb-2">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition-colors',
              tab === t.id ? 'bg-cyan-600 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
            )}>
            <t.icon className="h-3.5 w-3.5" />{t.label}
          </button>
        ))}
      </nav>
      {tab === 'ashby' && <AshbyTab />}
      {tab === 'rank' && <RankTab />}
      {tab === 'datasheet' && <DatasheetTab />}
      {tab === 'import' && <ImportTab />}
      {tab === 'standards' && <StandardsTab />}
      {tab === 'carbon' && <CarbonTab />}
    </div>
  );
}
