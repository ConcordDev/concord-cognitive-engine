'use client';

/**
 * ComplianceDiversionPanel — bespoke environmental compliance +
 * waste diversion surface for the environment lens. Wires
 * environment.complianceCheck + environment.diversionRate against
 * editable parameter / waste-stream tables.
 *
 *   • Compliance: parameter rows (name/value/unit/min/max) → pass/fail
 *     per row + overall verdict + violation count
 *   • Diversion: total + diverted volume + per-stream split + target%
 *     → rate %, landfill share, target-met badge
 *   • Save-as-DTU captures inputs + both reports
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Recycle, Loader2, Plus, Trash2, ShieldCheck, ShieldAlert } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Param { name: string; value: string; unit: string; min: string; max: string }
interface Stream { name: string; volume: string }
interface ComplianceResult { results?: Array<{ parameter: string; value: number; unit: string; threshold?: { min?: number; max?: number }; compliant: boolean }>; overallCompliant?: boolean; violations?: number; checkedAt?: string }
interface DiversionResult { diversionRate?: number; totalWaste?: number; diverted?: number; landfilled?: number; target?: number; meetsTarget?: boolean; streams?: Stream[] }

async function callEnv<T>(action: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await apiHelpers.lens.runDomain('environment', action, { input });
    const env = (r as { data?: { ok: boolean; result?: T } }).data;
    if (!env?.ok) return null;
    const result = env.result as unknown as { ok?: boolean; result?: T } | T;
    if (result && typeof result === 'object' && 'ok' in result && 'result' in result) {
      return (result as { result: T }).result;
    }
    return env.result as T;
  } catch { return null; }
}

const DEFAULT_PARAMS: Param[] = [
  { name: 'pH', value: '7.2', unit: 'pH', min: '6.5', max: '8.5' },
  { name: 'Lead (Pb)', value: '0.008', unit: 'mg/L', min: '0', max: '0.015' },
  { name: 'Turbidity', value: '0.9', unit: 'NTU', min: '0', max: '1.0' },
  { name: 'Nitrate', value: '12', unit: 'mg/L', min: '0', max: '10' },
];

const DEFAULT_STREAMS: Stream[] = [
  { name: 'Cardboard', volume: '850' },
  { name: 'Glass', volume: '320' },
  { name: 'Aluminum', volume: '180' },
  { name: 'Organics (compost)', volume: '450' },
];

export function ComplianceDiversionPanel() {
  const [params, setParams] = useState<Param[]>(DEFAULT_PARAMS);
  const [streams, setStreams] = useState<Stream[]>(DEFAULT_STREAMS);
  const [totalWaste, setTotalWaste] = useState(3500);
  const [target, setTarget] = useState(50);
  const [compliance, setCompliance] = useState<ComplianceResult | null>(null);
  const [diversion, setDiversion] = useState<DiversionResult | null>(null);

  const analyze = useMutation({
    mutationFn: async () => {
      const parameters = params.filter((p) => p.name.trim() && p.value.trim()).map((p) => ({
        name: p.name.trim(), value: parseFloat(p.value) || 0, unit: p.unit, threshold: { min: parseFloat(p.min) || 0, max: parseFloat(p.max) || Infinity },
      }));
      const cleanStreams = streams.filter((s) => s.name.trim() && s.volume.trim()).map((s) => ({ name: s.name.trim(), volume: parseFloat(s.volume) || 0 }));
      const divertedVolume = cleanStreams.reduce((sum, s) => sum + s.volume, 0);
      const [c, d] = await Promise.all([
        callEnv<ComplianceResult>('complianceCheck', { artifact: { data: { parameters } } }),
        callEnv<DiversionResult>('diversionRate', { artifact: { data: { totalVolume: totalWaste, divertedVolume, streams: cleanStreams } }, target }),
      ]);
      setCompliance(c);
      setDiversion(d);
      return { c, d };
    },
  });

  const addParam = () => setParams((ps) => [...ps, { name: '', value: '', unit: '', min: '', max: '' }]);
  const updateParam = (i: number, key: keyof Param, value: string) =>
    setParams((ps) => ps.map((p, idx) => (idx === i ? { ...p, [key]: value } : p)));
  const removeParam = (i: number) => setParams((ps) => ps.filter((_, idx) => idx !== i));

  const addStream = () => setStreams((ss) => [...ss, { name: '', volume: '' }]);
  const updateStream = (i: number, key: keyof Stream, value: string) =>
    setStreams((ss) => ss.map((s, idx) => (idx === i ? { ...s, [key]: value } : s)));
  const removeStream = (i: number) => setStreams((ss) => ss.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Recycle className="h-5 w-5 text-emerald-400" />
          <h2 className="text-sm font-semibold text-white">Compliance + diversion</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">environment.complianceCheck + diversionRate</span>
        </div>
        {(compliance || diversion) && (
          <SaveAsDtuButton
            compact
            apiSource="concord-env-compliance-diversion"
            title={`Env compliance + diversion — ${compliance?.violations ?? 0} violations · ${diversion?.diversionRate ?? 0}% diverted`}
            content={`Compliance: ${compliance?.overallCompliant ? 'PASS' : 'FAIL'} (${compliance?.violations ?? 0} violation${compliance?.violations === 1 ? '' : 's'})\n${(compliance?.results || []).map((r) => `  ${r.compliant ? '✓' : '✗'} ${r.parameter} = ${r.value} ${r.unit}${r.threshold ? ` (range ${r.threshold.min ?? '-'}–${r.threshold.max ?? '-'})` : ''}`).join('\n')}\n\nDiversion: ${diversion?.diversionRate}% (target ${diversion?.target}% — ${diversion?.meetsTarget ? 'MET' : 'BELOW'})\n  Total: ${diversion?.totalWaste} | Diverted: ${diversion?.diverted} | Landfilled: ${diversion?.landfilled}\nStreams:\n${(diversion?.streams || []).map((s) => `  ${s.name}: ${s.volume}`).join('\n')}`}
            extraTags={['environment', 'compliance', 'diversion']}
            rawData={{ params, streams, totalWaste, target, compliance, diversion }}
          />
        )}
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
      </div>

      <div className="flex items-center">
        <button type="button" onClick={() => analyze.mutate()} disabled={analyze.isPending} className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-mono text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50">
          {analyze.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Recycle className="h-3.5 w-3.5" />}
          Run analysis
        </button>
      </div>

      {analyze.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Analysis failed.</div>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
      </div>
    </div>
  );
}
