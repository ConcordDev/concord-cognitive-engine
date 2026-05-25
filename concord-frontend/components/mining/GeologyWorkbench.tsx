'use client';

/**
 * GeologyWorkbench — drill-hole database + 3D block model + grade-tonnage
 * curve. Every value is computed by the mining domain macros:
 * drillhole-add / drillhole-list / drillhole-log-interval / drillhole-delete
 * / block-model / grade-tonnage-curve.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { Drill, Plus, Trash2, Layers, BarChart3, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Interval { id: string; from: number; to: number; lithology: string; assayGrade: number; recovery: number; }
interface Hole {
  id: string; name: string; siteId: string | null;
  collarX: number; collarY: number; collarZ: number;
  azimuth: number; dip: number; totalDepth: number;
  intervals: Interval[]; intervalCount: number; loggedDepth: number;
}
interface Block { ix: number; iy: number; iz: number; cx: number; cy: number; cz: number; grade: number; isOre: boolean; confident: boolean; }
interface BlockModel {
  blocks: Block[]; composites: number; blockSize: number; cutoffGrade: number;
  dimensions: { nx: number; ny: number; nz: number };
  oreBlocks: number; totalBlocks: number; avgOreGrade: number; note?: string;
}
interface CurvePoint { cutoff: number; tonnes: number; avgGrade: number; containedMetal: number; tonnagePercent: number; }

const LITHOLOGIES = ['overburden', 'oxide', 'transition', 'fresh_ore', 'waste', 'fault', 'vein', 'host_rock'];

export function GeologyWorkbench() {
  const [holes, setHoles] = useState<Hole[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [model, setModel] = useState<BlockModel | null>(null);
  const [curve, setCurve] = useState<CurvePoint[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // new-hole form
  const [hName, setHName] = useState('');
  const [hAz, setHAz] = useState('0');
  const [hDip, setHDip] = useState('-90');
  const [hDepth, setHDepth] = useState('120');
  const [hX, setHX] = useState('0');
  const [hY, setHY] = useState('0');
  const [hZ, setHZ] = useState('0');

  // new-interval form
  const [ivFrom, setIvFrom] = useState('');
  const [ivTo, setIvTo] = useState('');
  const [ivLith, setIvLith] = useState('fresh_ore');
  const [ivGrade, setIvGrade] = useState('');
  const [ivRec, setIvRec] = useState('95');

  const loadHoles = useCallback(async () => {
    const r = await lensRun<{ holes: Hole[] }>('mining', 'drillhole-list', {});
    if (r.data.ok && r.data.result) {
      setHoles(r.data.result.holes);
      setSelected((s) => s ?? r.data.result?.holes[0]?.id ?? null);
    } else if (r.data.error) setErr(r.data.error);
  }, []);

  useEffect(() => { void loadHoles(); }, [loadHoles]);

  async function addHole() {
    if (!hName.trim()) { setErr('Drill-hole name required.'); return; }
    setBusy('add-hole'); setErr(null);
    const r = await lensRun('mining', 'drillhole-add', {
      name: hName.trim(), azimuth: Number(hAz), dip: Number(hDip), totalDepth: Number(hDepth),
      collarX: Number(hX), collarY: Number(hY), collarZ: Number(hZ),
    });
    setBusy(null);
    if (r.data.ok) { setHName(''); await loadHoles(); }
    else setErr(r.data.error || 'add failed');
  }

  async function logInterval() {
    if (!selected) { setErr('Select a drill-hole.'); return; }
    if (!ivFrom || !ivTo) { setErr('Interval from/to required.'); return; }
    setBusy('log'); setErr(null);
    const r = await lensRun('mining', 'drillhole-log-interval', {
      holeId: selected, from: Number(ivFrom), to: Number(ivTo),
      lithology: ivLith, assayGrade: Number(ivGrade), recovery: Number(ivRec),
    });
    setBusy(null);
    if (r.data.ok) { setIvFrom(ivTo); setIvTo(''); setIvGrade(''); await loadHoles(); }
    else setErr(r.data.error || 'log failed');
  }

  async function delHole(id: string) {
    setBusy('del'); setErr(null);
    const r = await lensRun('mining', 'drillhole-delete', { id });
    setBusy(null);
    if (r.data.ok) { if (selected === id) setSelected(null); await loadHoles(); }
    else setErr(r.data.error || 'delete failed');
  }

  async function buildModel() {
    setBusy('model'); setErr(null);
    const r = await lensRun<BlockModel>('mining', 'block-model', { blockSize: 15, cutoffGrade: 0.5 });
    setBusy(null);
    if (r.data.ok && r.data.result) setModel(r.data.result);
    else setErr(r.data.error || 'block model failed');
  }

  async function buildCurve() {
    setBusy('curve'); setErr(null);
    const r = await lensRun<{ curve: CurvePoint[] }>('mining', 'grade-tonnage-curve', { blockSize: 15 });
    setBusy(null);
    if (r.data.ok && r.data.result) setCurve(r.data.result.curve);
    else setErr(r.data.error || 'curve failed');
  }

  const sel = holes.find((h) => h.id === selected) || null;

  return (
    <div className="rounded-lg border border-stone-500/20 bg-zinc-950/60 p-3 space-y-4">
      <header className="flex items-center gap-2 border-b border-stone-500/10 pb-2">
        <Gem3 />
        <h3 className="text-sm font-semibold text-white">Geology — drill-hole database & orebody model</h3>
      </header>

      {err && <div className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">{err}</div>}

      {/* drill-hole creation */}
      <div className="grid grid-cols-2 md:grid-cols-8 gap-2">
        <input value={hName} onChange={(e) => setHName(e.target.value)} placeholder="Hole ID (e.g. DDH-001)"
          className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[12px] text-white" />
        <input value={hX} onChange={(e) => setHX(e.target.value.replace(/[^\d.-]/g, ''))} placeholder="Collar X"
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[12px] text-white font-mono" />
        <input value={hY} onChange={(e) => setHY(e.target.value.replace(/[^\d.-]/g, ''))} placeholder="Collar Y"
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[12px] text-white font-mono" />
        <input value={hZ} onChange={(e) => setHZ(e.target.value.replace(/[^\d.-]/g, ''))} placeholder="Collar Z"
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[12px] text-white font-mono" />
        <input value={hAz} onChange={(e) => setHAz(e.target.value.replace(/[^\d.]/g, ''))} placeholder="Azimuth°"
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[12px] text-white font-mono" />
        <input value={hDip} onChange={(e) => setHDip(e.target.value.replace(/[^\d.-]/g, ''))} placeholder="Dip°"
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[12px] text-white font-mono" />
        <input value={hDepth} onChange={(e) => setHDepth(e.target.value.replace(/[^\d.]/g, ''))} placeholder="Depth m"
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[12px] text-white font-mono" />
      </div>
      <button type="button" onClick={addHole} disabled={!!busy}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 text-white rounded text-[12px]">
        {busy === 'add-hole' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add drill-hole
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* hole list */}
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Drill-holes ({holes.length})</div>
          {holes.length === 0 && <div className="text-[11px] text-zinc-400 py-3">No holes logged. Add one above.</div>}
          {holes.map((h) => (
            <div key={h.id}
              onClick={() => setSelected(h.id)}
              className={cn('flex items-center justify-between gap-2 rounded border p-2 cursor-pointer transition-colors',
                selected === h.id ? 'border-cyan-600 bg-cyan-500/10' : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700')} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-white">
                  <Drill className="w-3 h-3 text-cyan-400" /> {h.name}
                </div>
                <div className="text-[10px] text-zinc-400">
                  {h.totalDepth}m · az {h.azimuth}° dip {h.dip}° · {h.intervalCount} intervals · logged {h.loggedDepth}m
                </div>
              </div>
              <button type="button" onClick={(e) => { e.stopPropagation(); delHole(h.id); }}
                className="p-1 text-zinc-400 hover:text-red-400" aria-label="Delete hole">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* interval log for selected hole */}
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">
            Interval log {sel ? `— ${sel.name}` : ''}
          </div>
          {!sel && <div className="text-[11px] text-zinc-400 py-3">Select a drill-hole to log assay intervals.</div>}
          {sel && (
            <>
              <div className="grid grid-cols-3 md:grid-cols-5 gap-1.5">
                <input value={ivFrom} onChange={(e) => setIvFrom(e.target.value.replace(/[^\d.]/g, ''))} placeholder="From m"
                  className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" />
                <input value={ivTo} onChange={(e) => setIvTo(e.target.value.replace(/[^\d.]/g, ''))} placeholder="To m"
                  className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" />
                <select value={ivLith} onChange={(e) => setIvLith(e.target.value)}
                  className="bg-zinc-900 border border-zinc-800 rounded px-1 py-1 text-[11px] text-white">
                  {LITHOLOGIES.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
                <input value={ivGrade} onChange={(e) => setIvGrade(e.target.value.replace(/[^\d.]/g, ''))} placeholder="Grade %"
                  className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" />
                <input value={ivRec} onChange={(e) => setIvRec(e.target.value.replace(/[^\d.]/g, ''))} placeholder="Rec %"
                  className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" />
              </div>
              <button type="button" onClick={logInterval} disabled={!!busy}
                className="flex items-center gap-1.5 px-3 py-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white rounded text-[11px]">
                {busy === 'log' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Log interval
              </button>
              <div className="space-y-1 max-h-44 overflow-y-auto">
                {sel.intervals.map((iv) => (
                  <div key={iv.id} className="flex items-center justify-between text-[11px] bg-zinc-900/60 rounded px-2 py-1">
                    <span className="font-mono text-zinc-300">{iv.from}–{iv.to}m</span>
                    <span className="text-zinc-400">{iv.lithology}</span>
                    <span className="font-mono text-amber-300">{iv.assayGrade}%</span>
                    <span className="font-mono text-zinc-400">rec {iv.recovery}%</span>
                  </div>
                ))}
                {sel.intervals.length === 0 && <div className="text-[11px] text-zinc-400">No intervals logged.</div>}
              </div>
            </>
          )}
        </div>
      </div>

      {/* block model + grade-tonnage */}
      <div className="flex flex-wrap gap-2 border-t border-zinc-800 pt-3">
        <button type="button" onClick={buildModel} disabled={!!busy}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-40 text-white rounded text-[12px]">
          {busy === 'model' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Layers className="w-3.5 h-3.5" />} Build block model
        </button>
        <button type="button" onClick={buildCurve} disabled={!!busy}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-700 hover:bg-amber-600 disabled:opacity-40 text-white rounded text-[12px]">
          {busy === 'curve' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BarChart3 className="w-3.5 h-3.5" />} Grade-tonnage curve
        </button>
      </div>

      {model && <BlockModelView model={model} />}
      {curve && curve.length > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-zinc-900/40 p-3">
          <div className="text-[11px] font-semibold text-amber-300 mb-2">Grade-Tonnage Curve</div>
          <ChartKit kind="line" data={curve as unknown as Array<Record<string, unknown>>} xKey="cutoff"
            series={[
              { key: 'tonnagePercent', label: 'Tonnage %', color: '#06b6d4' },
              { key: 'avgGrade', label: 'Avg grade %', color: '#f59e0b' },
            ]} height={220} />
          <div className="text-[10px] text-zinc-400 mt-1">X = cutoff grade %. Higher cutoff → less tonnage, higher average grade.</div>
        </div>
      )}
    </div>
  );
}

function BlockModelView({ model }: { model: BlockModel }) {
  if (model.note && model.blocks.length === 0) {
    return <div className="text-[11px] text-zinc-400 bg-zinc-900/40 rounded p-3">{model.note}</div>;
  }
  // render each Z level as a grid of grade-coloured cells.
  const { nx, ny, nz } = model.dimensions;
  const levels: Block[][] = [];
  for (let iz = 0; iz < nz; iz++) levels.push(model.blocks.filter((b) => b.iz === iz));
  const maxGrade = Math.max(0.001, ...model.blocks.map((b) => b.grade));
  const colour = (b: Block) => {
    if (!b.confident) return 'rgba(63,63,70,0.35)';
    const t = Math.min(1, b.grade / maxGrade);
    const r = Math.round(40 + t * 215), g = Math.round(60 + (1 - t) * 80), bl = Math.round(180 - t * 150);
    return `rgb(${r},${g},${bl})`;
  };
  return (
    <div className="rounded-lg border border-indigo-500/20 bg-zinc-900/40 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-semibold text-indigo-300">3D Block Model (IDW interpolated)</div>
        <div className="text-[10px] text-zinc-400">
          {model.totalBlocks} blocks · {model.oreBlocks} ore · avg ore {model.avgOreGrade}% · {model.composites} composites
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        {levels.map((lvl, iz) => (
          <div key={iz}>
            <div className="text-[9px] text-zinc-400 mb-1">Level Z{iz}</div>
            <div className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${nx}, 14px)` }}>
              {Array.from({ length: nx * ny }).map((_, idx) => {
                const ix = idx % nx, iy = Math.floor(idx / nx);
                const b = lvl.find((x) => x.ix === ix && x.iy === iy);
                return (
                  <div key={idx} title={b ? `${b.grade}% ${b.isOre ? '(ore)' : ''}` : ''}
                    className="w-[14px] h-[14px] rounded-[2px]"
                    style={{
                      background: b ? colour(b) : '#18181b',
                      outline: b?.isOre ? '1px solid #fbbf24' : 'none',
                    }} />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-2 text-[9px] text-zinc-400">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: 'rgb(255,60,30)' }} /> high grade</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: 'rgb(40,140,180)' }} /> low grade</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ outline: '1px solid #fbbf24', background: 'transparent' }} /> above cutoff</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(63,63,70,0.5)' }} /> low confidence</span>
      </div>
    </div>
  );
}

function Gem3() { return <Layers className="h-4 w-4 text-cyan-400" />; }
