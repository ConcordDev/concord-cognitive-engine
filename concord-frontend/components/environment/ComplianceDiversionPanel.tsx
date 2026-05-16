'use client';

/**
 * ComplianceDiversionPanel — environmental compliance + waste-diversion
 * surface for the environment lens. Wires environment.complianceCheck +
 * environment.diversionRate.
 *
 * Refactored to use `CalcPanel` primitive. See
 * `concord-frontend/components/lens-primitives/CalcPanel.tsx`.
 */

import { useState } from 'react';
import { Recycle, Plus, Trash2, ShieldCheck, ShieldAlert } from 'lucide-react';
import { CalcPanel } from '@/components/lens-primitives/CalcPanel';

interface Param { name: string; value: string; unit: string; min: string; max: string }
interface Stream { name: string; volume: string }
interface ComplianceResult { results?: Array<{ parameter: string; value: number; unit: string; threshold?: { min?: number; max?: number }; compliant: boolean }>; overallCompliant?: boolean; violations?: number; checkedAt?: string }
interface DiversionResult { diversionRate?: number; totalWaste?: number; diverted?: number; landfilled?: number; target?: number; meetsTarget?: boolean; streams?: Stream[] }

export function ComplianceDiversionPanel() {
  const [params, setParams] = useState<Param[]>([{ name: '', value: '', unit: '', min: '', max: '' }]);
  const [streams, setStreams] = useState<Stream[]>([{ name: '', volume: '' }]);
  const [totalWaste, setTotalWaste] = useState(0);
  const [target, setTarget] = useState(50);

  const addParam = () => setParams((ps) => [...ps, { name: '', value: '', unit: '', min: '', max: '' }]);
  const updateParam = (i: number, key: keyof Param, value: string) =>
    setParams((ps) => ps.map((p, idx) => (idx === i ? { ...p, [key]: value } : p)));
  const removeParam = (i: number) => setParams((ps) => ps.filter((_, idx) => idx !== i));

  const addStream = () => setStreams((ss) => [...ss, { name: '', volume: '' }]);
  const updateStream = (i: number, key: keyof Stream, value: string) =>
    setStreams((ss) => ss.map((s, idx) => (idx === i ? { ...s, [key]: value } : s)));
  const removeStream = (i: number) => setStreams((ss) => ss.filter((_, idx) => idx !== i));

  return (
    <CalcPanel<ComplianceResult, DiversionResult>
      title="Compliance + diversion"
      domain="environment"
      icon={<Recycle className="h-5 w-5 text-emerald-400" />}
      macroBadge="environment.complianceCheck + diversionRate"
      accent="emerald"
      left={{
        macro: 'complianceCheck',
        buildArtifact: () => ({
          data: {
            parameters: params.filter((p) => p.name.trim() && p.value.trim()).map((p) => ({
              name: p.name.trim(), value: parseFloat(p.value) || 0, unit: p.unit,
              threshold: { min: parseFloat(p.min) || 0, max: parseFloat(p.max) || Infinity },
            })),
          },
        }),
        render: (
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Parameters (water/air/soil sampling)</div>
            <div className="grid grid-cols-[1fr_80px_70px_70px_70px_30px] gap-1.5 text-[9px] uppercase tracking-wider text-zinc-500">
              <span>Name</span><span>Value</span><span>Unit</span><span>Min</span><span>Max</span><span></span>
            </div>
            {params.map((p, i) => (
              <div key={i} className="grid grid-cols-[1fr_80px_70px_70px_70px_30px] gap-1.5">
                <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" placeholder="pH" value={p.name} onChange={(e) => updateParam(i, 'name', e.target.value)} />
                <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={p.value} onChange={(e) => updateParam(i, 'value', e.target.value)} />
                <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={p.unit} onChange={(e) => updateParam(i, 'unit', e.target.value)} />
                <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={p.min} onChange={(e) => updateParam(i, 'min', e.target.value)} />
                <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={p.max} onChange={(e) => updateParam(i, 'max', e.target.value)} />
                <button type="button" onClick={() => removeParam(i)} className="rounded border border-zinc-800 text-xs text-zinc-500 hover:text-rose-300" aria-label="Remove"><Trash2 className="mx-auto h-3 w-3" /></button>
              </div>
            ))}
            <button type="button" onClick={addParam} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-emerald-500/40 hover:text-emerald-200"><Plus className="h-3 w-3" />Add parameter</button>
          </div>
        ),
      }}
      right={{
        macro: 'diversionRate',
        buildArtifact: () => {
          const cleanStreams = streams.filter((s) => s.name.trim() && s.volume.trim()).map((s) => ({ name: s.name.trim(), volume: parseFloat(s.volume) || 0 }));
          const divertedVolume = cleanStreams.reduce((sum, s) => sum + s.volume, 0);
          return { data: { totalVolume: totalWaste, divertedVolume, streams: cleanStreams }, target };
        },
        render: (
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Waste streams (diverted volume)</div>
            <div className="flex items-center gap-2">
              <label className="block flex-1">
                <span className="block text-[9px] uppercase tracking-wider text-zinc-500">Total waste</span>
                <input type="number" min={0} value={totalWaste} onChange={(e) => setTotalWaste(Math.max(0, Number(e.target.value) || 0))} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" />
              </label>
              <label className="block w-20">
                <span className="block text-[9px] uppercase tracking-wider text-zinc-500">Target %</span>
                <input type="number" min={0} max={100} value={target} onChange={(e) => setTarget(Math.max(0, Math.min(100, Number(e.target.value) || 50)))} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" />
              </label>
            </div>
            {streams.map((s, i) => (
              <div key={i} className="grid grid-cols-[1fr_100px_30px] gap-1.5">
                <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" placeholder="Stream name" value={s.name} onChange={(e) => updateStream(i, 'name', e.target.value)} />
                <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" placeholder="Volume" value={s.volume} onChange={(e) => updateStream(i, 'volume', e.target.value)} />
                <button type="button" onClick={() => removeStream(i)} className="rounded border border-zinc-800 text-xs text-zinc-500 hover:text-rose-300" aria-label="Remove"><Trash2 className="mx-auto h-3 w-3" /></button>
              </div>
            ))}
            <button type="button" onClick={addStream} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-emerald-500/40 hover:text-emerald-200"><Plus className="h-3 w-3" />Add stream</button>
          </div>
        ),
      }}
      renderResults={(compliance, diversion) => (
        <>
          <div className={`rounded-lg border p-3 ${compliance?.overallCompliant ? 'border-emerald-500/30 bg-emerald-500/5' : compliance ? 'border-rose-500/30 bg-rose-500/5' : 'border-zinc-800 bg-zinc-950/40'}`}>
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500">
              {compliance?.overallCompliant ? <ShieldCheck className="h-3 w-3 text-emerald-300" /> : <ShieldAlert className="h-3 w-3 text-rose-300" />}
              Compliance
            </div>
            {!compliance && <div className="text-[11px] text-zinc-500">Run to check.</div>}
            {compliance && (
              <div className="space-y-1 text-[11px]">
                <div className={compliance.overallCompliant ? 'text-emerald-200' : 'text-rose-200'}>{compliance.overallCompliant ? 'All parameters within range.' : `${compliance.violations} violation${compliance.violations === 1 ? '' : 's'}`}</div>
                {compliance.results?.map((r, i) => (
                  <div key={i} className={`flex items-center justify-between rounded border px-2 py-1 ${r.compliant ? 'border-emerald-500/15 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/10'}`}>
                    <span className="text-zinc-100">{r.compliant ? '✓' : '✗'} {r.parameter}</span>
                    <span className="font-mono text-[10px] text-zinc-300">{r.value} {r.unit}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className={`rounded-lg border p-3 ${diversion?.meetsTarget ? 'border-emerald-500/30 bg-emerald-500/5' : diversion ? 'border-amber-500/30 bg-amber-500/5' : 'border-zinc-800 bg-zinc-950/40'}`}>
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><Recycle className="h-3 w-3" />Diversion rate</div>
            {!diversion && <div className="text-[11px] text-zinc-500">Run to compute.</div>}
            {diversion && (
              <div className="space-y-1.5 text-[11px]">
                <div className="flex items-baseline gap-2">
                  <span className={`font-mono text-2xl ${diversion.meetsTarget ? 'text-emerald-200' : 'text-amber-200'}`}>{diversion.diversionRate}%</span>
                  <span className="text-zinc-500">target {diversion.target}%</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-500">Total</div><div className="font-mono text-zinc-200">{diversion.totalWaste}</div></div>
                  <div className="rounded border border-emerald-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-500">Diverted</div><div className="font-mono text-emerald-200">{diversion.diverted}</div></div>
                  <div className="rounded border border-amber-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-500">Landfill</div><div className="font-mono text-amber-200">{diversion.landfilled}</div></div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
      dtu={{
        apiSource: 'concord-env-compliance-diversion',
        title: (c, d) => `Env compliance + diversion — ${c.violations ?? 0} violations · ${d.diversionRate ?? 0}% diverted`,
        content: (c, d) => `Compliance: ${c.overallCompliant ? 'PASS' : 'FAIL'} (${c.violations ?? 0} violation${c.violations === 1 ? '' : 's'})\n${(c.results || []).map((r) => `  ${r.compliant ? '✓' : '✗'} ${r.parameter} = ${r.value} ${r.unit}${r.threshold ? ` (range ${r.threshold.min ?? '-'}–${r.threshold.max ?? '-'})` : ''}`).join('\n')}\n\nDiversion: ${d.diversionRate}% (target ${d.target}% — ${d.meetsTarget ? 'MET' : 'BELOW'})\n  Total: ${d.totalWaste} | Diverted: ${d.diverted} | Landfilled: ${d.landfilled}\nStreams:\n${(d.streams || []).map((s) => `  ${s.name}: ${s.volume}`).join('\n')}`,
        tags: () => ['environment', 'compliance', 'diversion'],
        rawData: (c, d) => ({ params, streams, totalWaste, target, compliance: c, diversion: d }),
      }}
    />
  );
}
