'use client';

/**
 * MinePlanWorkbench — open-pit mine planning + reserve/resource reporting.
 * Every value is computed by the mining domain macros:
 * pit-design (bench layout, pit shells, strip ratio) and
 * reserve-report (JORC 2012 / NI 43-101 measured/indicated/inferred).
 */

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { Layers, FileBarChart, Loader2, Mountain, Gem } from 'lucide-react';

interface Bench {
  bench: number; rl: number; depthFromTop: number; width: number;
  volumeM3: number; tonnage: number; slopeRun: number;
}
interface PitDesign {
  benches: Bench[]; benchCount: number; benchHeight: number; slopeAngle: number;
  pitDepth: number; surfaceRL: number; pitBottomRL: number;
  totalVolumeM3: number; totalTonnage: number; oreTonnage: number;
  wasteTonnage: number; stripRatio: number; designClass: string;
}
interface PitBlock {
  ix: number; iy: number; iz: number; cx: number; cy: number; cz: number;
  grade: number; value: number; tonnage: number; processed: boolean;
}
interface PitOptimizeResult {
  pitBlocks: PitBlock[]; blockCount: number; selectedCount: number;
  totalValue: number; totalTonnesMined: number; oreTonnes: number; wasteTonnes: number;
  containedMetal: number; recoverableMetal: number; stripRatio: number | null;
  slopeAngle: number; blockSize: number; gridCapped: boolean;
  dimensions: { nx: number; ny: number; nz: number };
  algorithm: string;
  economicParamsUsed: {
    metalPricePerTonne: number; recoveryPercent: number; miningCostPerTonne: number;
    processingCostPerTonne: number; densityTonM3: number;
  };
  defaultsUsed: string[];
  disclosure: string;
  note?: string;
}
interface ResourceCategory {
  category: string; confidence: number; tonnage: number; avgGrade: number;
  containedMetal: number; recoverableMetal: number;
}
interface ReserveReport {
  code: string; drillSpacingMeters: number; resources: ResourceCategory[];
  totalResourceTonnes: number;
  reserves: {
    proved: { category: string; tonnage: number };
    probable: { category: string; tonnage: number };
    totalReserveTonnes: number; recoverableMetal: number;
  };
  inSituValue: number; confidenceClass: string;
}

function num(s: string): number { const n = Number(s); return Number.isFinite(n) ? n : 0; }

export function MinePlanWorkbench() {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // pit-design form
  const [surfaceRL, setSurfaceRL] = useState('100');
  const [pitDepth, setPitDepth] = useState('120');
  const [benchHeight, setBenchHeight] = useState('15');
  const [slopeAngle, setSlopeAngle] = useState('45');
  const [bottomWidth, setBottomWidth] = useState('40');
  const [stripRatio, setStripRatio] = useState('3');
  const [pit, setPit] = useState<PitDesign | null>(null);

  // reserve-report form
  const [rTonnage, setRTonnage] = useState('5000000');
  const [rGrade, setRGrade] = useState('1.4');
  const [drillSpacing, setDrillSpacing] = useState('50');
  const [recovery, setRecovery] = useState('88');
  const [metalPrice, setMetalPrice] = useState('5000');
  const [code, setCode] = useState<'jorc' | 'ni43-101'>('jorc');
  const [report, setReport] = useState<ReserveReport | null>(null);

  // pit-optimize form (ultimate-pit optimizer over the drill-hole block model)
  const [optBlockSize, setOptBlockSize] = useState('20');
  const [optSlopeAngle, setOptSlopeAngle] = useState('45');
  const [optPrice, setOptPrice] = useState('5000');
  const [optRecovery, setOptRecovery] = useState('85');
  const [optMiningCost, setOptMiningCost] = useState('3');
  const [optProcessingCost, setOptProcessingCost] = useState('12');
  const [optDensity, setOptDensity] = useState('2.7');
  const [pitOpt, setPitOpt] = useState<PitOptimizeResult | null>(null);

  async function runPit() {
    setBusy('pit'); setErr(null);
    const r = await lensRun<PitDesign>('mining', 'pit-design', {
      surfaceRL: num(surfaceRL), pitDepth: num(pitDepth), benchHeight: num(benchHeight),
      slopeAngle: num(slopeAngle), bottomWidth: num(bottomWidth), targetStripRatio: num(stripRatio),
    });
    setBusy(null);
    if (r.data.ok && r.data.result) setPit(r.data.result);
    else setErr(r.data.error || 'pit design failed');
  }

  async function runReport() {
    setBusy('report'); setErr(null);
    const r = await lensRun<ReserveReport>('mining', 'reserve-report', {
      tonnage: num(rTonnage), avgGrade: num(rGrade), drillSpacingMeters: num(drillSpacing),
      recoveryPercent: num(recovery), metalPricePerTonne: num(metalPrice), code,
    });
    setBusy(null);
    if (r.data.ok && r.data.result) setReport(r.data.result);
    else setErr(r.data.error || 'reserve report failed');
  }

  async function runPitOptimize() {
    setBusy('optimize'); setErr(null);
    const r = await lensRun<PitOptimizeResult>('mining', 'pit-optimize', {
      blockSize: num(optBlockSize), slopeAngle: num(optSlopeAngle),
      metalPricePerTonne: num(optPrice), recoveryPercent: num(optRecovery),
      miningCostPerTonne: num(optMiningCost), processingCostPerTonne: num(optProcessingCost),
      densityTonM3: num(optDensity),
    });
    setBusy(null);
    if (r.data.ok && r.data.result) setPitOpt(r.data.result);
    else setErr(r.data.error || 'pit optimization failed');
  }

  return (
    <div className="rounded-lg border border-stone-500/20 bg-zinc-950/60 p-3 space-y-4">
      <header className="flex items-center gap-2 border-b border-stone-500/10 pb-2">
        <Mountain className="h-4 w-4 text-orange-400" />
        <h3 className="text-sm font-semibold text-white">Mine plan — pit design & reserve reporting</h3>
      </header>

      {err && <div className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">{err}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Pit design ── */}
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Open-pit shell design</div>
          <div className="grid grid-cols-3 gap-1.5">
            <Field label="Surface RL m" value={surfaceRL} onChange={setSurfaceRL} />
            <Field label="Pit depth m" value={pitDepth} onChange={setPitDepth} />
            <Field label="Bench ht m" value={benchHeight} onChange={setBenchHeight} />
            <Field label="Slope °" value={slopeAngle} onChange={setSlopeAngle} />
            <Field label="Bottom w m" value={bottomWidth} onChange={setBottomWidth} />
            <Field label="Strip ratio" value={stripRatio} onChange={setStripRatio} />
          </div>
          <button type="button" onClick={runPit} disabled={!!busy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-700 hover:bg-orange-600 disabled:opacity-40 text-white rounded text-[12px]">
            {busy === 'pit' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Layers className="w-3.5 h-3.5" />} Design pit shell
          </button>

          {pit && (
            <div className="rounded-lg border border-orange-500/20 bg-zinc-900/40 p-3 space-y-2">
              <div className="grid grid-cols-4 gap-2">
                <Stat label="Benches" value={String(pit.benchCount)} />
                <Stat label="Total t" value={pit.totalTonnage.toLocaleString()} />
                <Stat label="Ore t" value={pit.oreTonnage.toLocaleString()} accent="#22c55e" />
                <Stat label="Waste t" value={pit.wasteTonnage.toLocaleString()} accent="#a16207" />
              </div>
              <div className="text-[10px] text-zinc-400">
                {pit.designClass} · pit bottom RL {pit.pitBottomRL}m · strip ratio {pit.stripRatio}:1
              </div>
              <ChartKit kind="bar" data={pit.benches as unknown as Array<Record<string, unknown>>} xKey="bench"
                series={[{ key: 'tonnage', label: 'Tonnage per bench', color: '#f97316' }]} height={180} showLegend={false} />
              <div className="text-[9px] text-zinc-400">X = bench number (1 = top). Volume widens upward by slope run.</div>
              <div className="max-h-40 overflow-y-auto">
                <table className="w-full text-[10px]">
                  <thead className="text-zinc-400"><tr>
                    <th className="text-left py-0.5">Bench</th><th className="text-right">RL m</th>
                    <th className="text-right">Width m</th><th className="text-right">Volume m³</th><th className="text-right">Tonnage</th>
                  </tr></thead>
                  <tbody className="font-mono text-zinc-300">
                    {pit.benches.map((b) => (
                      <tr key={b.bench} className="border-t border-zinc-800/60">
                        <td className="py-0.5">{b.bench}</td><td className="text-right">{b.rl}</td>
                        <td className="text-right">{b.width}</td><td className="text-right">{b.volumeM3.toLocaleString()}</td>
                        <td className="text-right">{b.tonnage.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* ── Reserve report ── */}
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Reserve / resource statement</div>
          <div className="grid grid-cols-3 gap-1.5">
            <Field label="Tonnage" value={rTonnage} onChange={setRTonnage} />
            <Field label="Avg grade %" value={rGrade} onChange={setRGrade} />
            <Field label="Drill spacing m" value={drillSpacing} onChange={setDrillSpacing} />
            <Field label="Recovery %" value={recovery} onChange={setRecovery} />
            <Field label="Metal $/t" value={metalPrice} onChange={setMetalPrice} />
            <div>
              <label className="text-[9px] text-zinc-400 block mb-0.5">Code</label>
              <select value={code} onChange={(e) => setCode(e.target.value as 'jorc' | 'ni43-101')}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-1 py-1 text-[11px] text-white">
                <option value="jorc">JORC 2012</option>
                <option value="ni43-101">NI 43-101</option>
              </select>
            </div>
          </div>
          <button type="button" onClick={runReport} disabled={!!busy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-700 hover:bg-amber-600 disabled:opacity-40 text-white rounded text-[12px]">
            {busy === 'report' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileBarChart className="w-3.5 h-3.5" />} Generate statement
          </button>

          {report && (
            <div className="rounded-lg border border-amber-500/20 bg-zinc-900/40 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-amber-300">{report.code} resource categories</span>
                <span className="text-[9px] text-zinc-400">confidence: {report.confidenceClass}</span>
              </div>
              <table className="w-full text-[10px]">
                <thead className="text-zinc-400"><tr>
                  <th className="text-left py-0.5">Category</th><th className="text-right">Conf %</th>
                  <th className="text-right">Tonnage</th><th className="text-right">Metal t</th><th className="text-right">Recoverable</th>
                </tr></thead>
                <tbody className="font-mono text-zinc-300">
                  {report.resources.map((c) => (
                    <tr key={c.category} className="border-t border-zinc-800/60">
                      <td className="py-0.5 text-zinc-100">{c.category}</td><td className="text-right">{c.confidence}</td>
                      <td className="text-right">{c.tonnage.toLocaleString()}</td>
                      <td className="text-right">{c.containedMetal.toLocaleString()}</td>
                      <td className="text-right">{c.recoverableMetal.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="grid grid-cols-3 gap-2 border-t border-zinc-800 pt-2">
                <Stat label={report.reserves.proved.category} value={report.reserves.proved.tonnage.toLocaleString()} accent="#22c55e" />
                <Stat label={report.reserves.probable.category} value={report.reserves.probable.tonnage.toLocaleString()} accent="#06b6d4" />
                <Stat label="In-situ value" value={`$${report.inSituValue.toLocaleString()}`} accent="#f59e0b" />
              </div>
              <div className="text-[9px] text-zinc-400">
                Reserve = Proved + Probable ({report.reserves.totalReserveTonnes.toLocaleString()} t, {report.reserves.recoverableMetal.toLocaleString()} t recoverable metal). Inferred resource is excluded from reserves.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Ultimate-pit optimizer (economic block-value pit shell) ── */}
      <div className="space-y-2 border-t border-stone-500/10 pt-3">
        <div className="flex items-center gap-1.5">
          <Gem className="h-3.5 w-3.5 text-emerald-400" />
          <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">
            Ultimate-pit optimizer — economic block value over the drill-hole block model
          </div>
        </div>
        <div className="text-[9px] text-zinc-500">
          Maximum-weight-closure solve (Lerchs-Grossmann via max-flow/min-cut) over the same
          inverse-distance-weighted block model as Geology. Requires logged drill-holes with
          positive-grade intervals (Geology tab).
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          <Field label="Block size m" value={optBlockSize} onChange={setOptBlockSize} />
          <Field label="Slope °" value={optSlopeAngle} onChange={setOptSlopeAngle} />
          <Field label="Price $/t" value={optPrice} onChange={setOptPrice} />
          <Field label="Recovery %" value={optRecovery} onChange={setOptRecovery} />
          <Field label="Mining $/t" value={optMiningCost} onChange={setOptMiningCost} />
          <Field label="Processing $/t" value={optProcessingCost} onChange={setOptProcessingCost} />
          <Field label="Density t/m³" value={optDensity} onChange={setOptDensity} />
        </div>
        <button type="button" onClick={runPitOptimize} disabled={!!busy}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white rounded text-[12px]">
          {busy === 'optimize' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Gem className="w-3.5 h-3.5" />} Optimize pit shell
        </button>

        {pitOpt && pitOpt.note && (
          <div className="text-[11px] text-zinc-400 bg-zinc-900/40 border border-zinc-800 rounded px-2 py-1">{pitOpt.note}</div>
        )}

        {pitOpt && !pitOpt.note && (
          <div className="rounded-lg border border-emerald-500/20 bg-zinc-900/40 p-3 space-y-2">
            <div className="grid grid-cols-5 gap-2">
              <Stat label="Blocks in pit" value={`${pitOpt.selectedCount}/${pitOpt.blockCount}`} accent="#34d399" />
              <Stat label="Pit value" value={`$${pitOpt.totalValue.toLocaleString()}`} accent="#34d399" />
              <Stat label="Ore t" value={pitOpt.oreTonnes.toLocaleString()} accent="#22c55e" />
              <Stat label="Waste t" value={pitOpt.wasteTonnes.toLocaleString()} accent="#a16207" />
              <Stat label="Strip ratio" value={pitOpt.stripRatio == null ? '—' : `${pitOpt.stripRatio}:1`} />
            </div>
            <div className="text-[9px] text-zinc-400">
              Contained metal {pitOpt.containedMetal.toLocaleString()} t · recoverable {pitOpt.recoverableMetal.toLocaleString()} t ·
              grid {pitOpt.dimensions.nx}×{pitOpt.dimensions.ny}×{pitOpt.dimensions.nz}{pitOpt.gridCapped ? ' (capped for solve tractability)' : ''}
            </div>
            {pitOpt.defaultsUsed.length > 0 && (
              <div className="text-[9px] text-amber-300/80 bg-amber-500/5 border border-amber-500/20 rounded px-2 py-1">
                Using defaults — supply real values for a decision-grade result: {pitOpt.defaultsUsed.join('; ')}
              </div>
            )}
            <div className="text-[9px] text-zinc-500 italic">{pitOpt.disclosure}</div>
            <div className="max-h-40 overflow-y-auto">
              <table className="w-full text-[10px]">
                <thead className="text-zinc-400"><tr>
                  <th className="text-left py-0.5">Block (ix,iy,iz)</th><th className="text-right">Grade %</th>
                  <th className="text-right">Tonnage</th><th className="text-right">Value $</th><th className="text-right">Kind</th>
                </tr></thead>
                <tbody className="font-mono text-zinc-300">
                  {pitOpt.pitBlocks.map((b) => (
                    <tr key={`${b.ix}_${b.iy}_${b.iz}`} className="border-t border-zinc-800/60">
                      <td className="py-0.5">{b.ix},{b.iy},{b.iz}</td>
                      <td className="text-right">{b.grade}</td>
                      <td className="text-right">{b.tonnage.toLocaleString()}</td>
                      <td className="text-right">{b.value.toLocaleString()}</td>
                      <td className="text-right">{b.processed ? <span className="text-emerald-400">ore</span> : <span className="text-amber-500">waste</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-[9px] text-zinc-400 block mb-0.5">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.-]/g, ''))}
        className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" />
    </div>
  );
}

function Stat({ label, value, accent = '#e4e4e7' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-zinc-400">{label}</div>
      <div className="text-[13px] font-bold truncate" style={{ color: accent }}>{value}</div>
    </div>
  );
}
