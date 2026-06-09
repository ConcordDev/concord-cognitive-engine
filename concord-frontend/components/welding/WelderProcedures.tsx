'use client';

/**
 * WelderProcedures — Lincoln Welding Procedures / Miller WPS-style
 * calculator suite. Four bespoke widgets:
 *
 *  1. JointStrengthCalc — material/type/thickness/length → tensile
 *                        load capacity with shear strength
 *  2. RodSelector       — base metal / position / joint / thickness
 *                        → ordered electrode card list with AWS
 *                        classifications and amperage ranges
 *  3. HeatInputCalc     — voltage / amperage / travel speed →
 *                        heat-input J/mm with HAZ-risk gauge
 *  4. WeldInspection    — code (AWS D1.1 etc.) + inspection items →
 *                        pass/fail card with NDT recommendations
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Wrench, Flame, ClipboardCheck, Plus, Trash2, Loader2,
  AlertTriangle, ShieldCheck, Cpu,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

async function callWeld<T>(action: string, data: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await apiHelpers.lens.runDomain('welding', action, { input: { artifact: { data } } });
    const env = (r as { data?: { ok: boolean; result?: T } }).data;
    if (!env?.ok) return null;
    const raw = env.result as unknown as { ok?: boolean; result?: T } | T;
    if (raw && typeof raw === 'object' && 'result' in raw && (raw as { result?: T }).result) {
      return (raw as { result: T }).result;
    }
    return env.result as T;
  } catch { return null; }
}

interface JointResult { weldType?: string; material?: string; thickness?: string; length?: string; effectiveArea?: number; tensileLoadKN?: number; shearLoadKN?: number; classification?: string; recommendation?: string }
interface RodOption { electrode: string; awsClass: string; suitability: string; amperage: string; positions: string[]; tensileKsi: number; note?: string }
interface RodResult { baseMetal?: string; position?: string; recommendations?: RodOption[] }
interface HeatInputResult { voltage?: number; amperage?: number; travelSpeed?: number; efficiency?: number; heatInputJmm?: number; heatInputKjPerInch?: number; classification?: string; hazRisk?: string; recommendation?: string }
interface InspectionItem { item: string; category: string; required: boolean; passed: boolean }
interface InspectionResult { weldType?: string; code?: string; items?: InspectionItem[]; passed?: number; failed?: number; criticalFailed?: number; verdict?: string; ndtRequired?: boolean; ndtRecommendations?: string[] }

const MATERIALS = ['mild-steel', 'stainless-steel', 'aluminum', 'high-strength', 'cast-iron'] as const;
const WELD_TYPES = ['fillet', 'groove', 'butt', 'lap', 'corner', 'edge'] as const;
const POSITIONS = ['flat', 'horizontal', 'vertical-up', 'vertical-down', 'overhead'] as const;
const WELD_CODES = ['AWS D1.1', 'AWS D1.6', 'ASME IX', 'API 1104', 'ISO 3834'];

function JointStrengthCalc() {
  const [weldType, setWeldType] = useState<typeof WELD_TYPES[number]>('fillet');
  const [material, setMaterial] = useState<typeof MATERIALS[number]>('mild-steel');
  const [thickness, setThickness] = useState(0);
  const [length, setLength] = useState(0);
  const [result, setResult] = useState<JointResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const r = await callWeld<JointResult>('jointStrength', { weldType, material, thickness, length });
      setResult(r);
      return r;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-orange-500/20 bg-gradient-to-br from-zinc-950 via-orange-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-orange-500/20 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-orange-400" />
          <span className="text-sm font-semibold text-white">Joint strength</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">welding.jointStrength</span>
        </div>
        {result && (
          <SaveAsDtuButton compact apiSource="concord-welding-joint"
            title={`${result.weldType} weld in ${result.material} — ${result.tensileLoadKN} kN tensile`}
            content={`Weld: ${result.weldType}\nMaterial: ${result.material}\nThickness: ${result.thickness}\nLength: ${result.length}\nEffective area: ${result.effectiveArea} mm²\nTensile load: ${result.tensileLoadKN} kN\nShear load: ${result.shearLoadKN} kN\nClass: ${result.classification}\n${result.recommendation || ''}`}
            extraTags={['welding', 'joint-strength', weldType, material]} rawData={{ weldType, material, thickness, length, result }} />
        )}
      </header>

      <div className="grid gap-3 p-4 md:grid-cols-[220px_1fr]">
        <div className="space-y-2">
          <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Weld type</span>
            <select value={weldType} onChange={(e) => setWeldType(e.target.value as typeof weldType)} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
              {WELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Material</span>
            <select value={material} onChange={(e) => setMaterial(e.target.value as typeof material)} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
              {MATERIALS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Thickness (mm)</span>
            <input type="number" step="0.5" min={0} value={thickness || ''} onChange={(e) => setThickness(Math.max(0, Number(e.target.value) || 0))} placeholder="e.g. 6" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
          </label>
          <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Weld length (mm)</span>
            <input type="number" min={0} value={length || ''} onChange={(e) => setLength(Math.max(0, Number(e.target.value) || 0))} placeholder="e.g. 100" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
          </label>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || thickness <= 0 || length <= 0} className="w-full rounded bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Calculate strength'}
          </button>
        </div>

        <div className="space-y-2">
          {!result && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">Enter thickness + length above.</div>}
          {result && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border-2 border-orange-500/40 bg-orange-500/10 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-orange-300">Tensile load</div>
                  <div className="font-mono text-2xl text-orange-100">{result.tensileLoadKN} <span className="text-sm text-zinc-400">kN</span></div>
                </div>
                <div className="rounded-lg border-2 border-amber-500/40 bg-amber-500/10 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-amber-300">Shear load</div>
                  <div className="font-mono text-2xl text-amber-100">{result.shearLoadKN} <span className="text-sm text-zinc-400">kN</span></div>
                </div>
              </div>
              <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1.5 text-[11px]">
                <span className="text-zinc-400">Effective area:</span> <span className="font-mono text-orange-200">{result.effectiveArea} mm²</span>
              </div>
              {result.classification && <div className="rounded border border-orange-500/30 bg-orange-500/5 px-2 py-1 text-[11px] text-orange-200">{result.classification}</div>}
              {result.recommendation && <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">{result.recommendation}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RodSelector() {
  const [baseMetal, setBaseMetal] = useState<typeof MATERIALS[number]>('mild-steel');
  const [position, setPosition] = useState<typeof POSITIONS[number]>('flat');
  const [jointType, setJointType] = useState<typeof WELD_TYPES[number]>('fillet');
  const [thickness, setThickness] = useState(6);
  const [result, setResult] = useState<RodResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const r = await callWeld<RodResult>('rodSelection', { baseMetal, position, jointType, thickness });
      setResult(r);
      return r;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-500/30 bg-gradient-to-br from-zinc-950 via-stone-900/30 to-zinc-950">
      <header className="flex items-center justify-between border-b border-zinc-500/30 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-zinc-300" />
          <span className="text-sm font-semibold text-white">Rod / electrode selector</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">welding.rodSelection</span>
        </div>
        {result?.recommendations && (
          <SaveAsDtuButton compact apiSource="concord-welding-rod"
            title={`Rod selection for ${result.baseMetal} ${result.position}`}
            content={`Base metal: ${result.baseMetal}\nPosition: ${result.position}\n\nRods:\n${result.recommendations.map((r, i) => `${i + 1}. ${r.electrode} (AWS ${r.awsClass}) — ${r.suitability}\n   amperage: ${r.amperage}\n   positions: ${r.positions.join(', ')}\n   tensile: ${r.tensileKsi} ksi${r.note ? `\n   ${r.note}` : ''}`).join('\n')}`}
            extraTags={['welding', 'rod-selection', baseMetal]} rawData={{ baseMetal, position, jointType, thickness, result }} />
        )}
      </header>

      <div className="p-4 space-y-3">
        <div className="grid gap-2 sm:grid-cols-4">
          <select value={baseMetal} onChange={(e) => setBaseMetal(e.target.value as typeof baseMetal)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
            {MATERIALS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={position} onChange={(e) => setPosition(e.target.value as typeof position)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
            {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={jointType} onChange={(e) => setJointType(e.target.value as typeof jointType)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
            {WELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <div className="grid grid-cols-[1fr_80px] gap-1">
            <input type="number" min={0} step="0.5" value={thickness || ''} onChange={(e) => setThickness(Math.max(0, Number(e.target.value) || 0))} placeholder="thick mm" className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
            <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending} className="rounded bg-zinc-500 px-2 py-1.5 text-xs font-semibold text-white hover:bg-zinc-400 disabled:opacity-50">
              {compute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Pick'}
            </button>
          </div>
        </div>

        {result?.recommendations && (
          <div className="space-y-1.5">
            {result.recommendations.map((r, i) => (
              <div key={i} className={`rounded-lg border p-3 ${i === 0 ? 'border-zinc-400/40 bg-zinc-500/10' : 'border-zinc-500/15 bg-zinc-950/40'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-lg font-semibold text-white">{r.electrode}</span>
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">AWS {r.awsClass}</span>
                  </div>
                  <span className={`rounded px-2 py-0.5 text-[10px] ${r.suitability === 'excellent' ? 'bg-emerald-500/20 text-emerald-200' : r.suitability === 'good' ? 'bg-amber-500/20 text-amber-200' : 'bg-zinc-700 text-zinc-300'}`}>{r.suitability}</span>
                </div>
                <div className="mt-1 grid grid-cols-3 gap-1 text-[10px]">
                  <span className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-zinc-300">amps: <span className="font-mono text-zinc-100">{r.amperage}</span></span>
                  <span className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-zinc-300">tensile: <span className="font-mono text-zinc-100">{r.tensileKsi} ksi</span></span>
                  <span className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-zinc-300">positions: <span className="font-mono text-zinc-100">{r.positions.join(',')}</span></span>
                </div>
                {r.note && <div className="mt-1 text-[10px] text-amber-300">{r.note}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HeatInputCalc() {
  const [voltage, setVoltage] = useState(0);
  const [amperage, setAmperage] = useState(0);
  const [travelSpeed, setTravelSpeed] = useState(0);
  const [efficiency, setEfficiency] = useState(0.8);
  const [result, setResult] = useState<HeatInputResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const r = await callWeld<HeatInputResult>('heatInput', { voltage, amperage, travelSpeed, efficiency });
      setResult(r);
      return r;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-red-500/20 bg-gradient-to-br from-zinc-950 via-red-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-red-500/20 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-red-400" />
          <span className="text-sm font-semibold text-white">Heat input</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">welding.heatInput</span>
        </div>
        {result && (
          <SaveAsDtuButton compact apiSource="concord-welding-heat"
            title={`Heat input — ${result.heatInputJmm} J/mm (${result.classification})`}
            content={`V=${result.voltage} I=${result.amperage}A v=${result.travelSpeed} mm/s η=${result.efficiency}\nHeat input: ${result.heatInputJmm} J/mm (${result.heatInputKjPerInch} kJ/in)\nClass: ${result.classification}\nHAZ risk: ${result.hazRisk}\n${result.recommendation || ''}`}
            extraTags={['welding', 'heat-input']} rawData={{ voltage, amperage, travelSpeed, efficiency, result }} />
        )}
      </header>

      <div className="grid gap-3 p-4 md:grid-cols-[220px_1fr]">
        <div className="space-y-2">
          <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Voltage (V)</span>
            <input type="number" min={0} value={voltage || ''} onChange={(e) => setVoltage(Math.max(0, Number(e.target.value) || 0))} placeholder="e.g. 25" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
          </label>
          <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Amperage (A)</span>
            <input type="number" min={0} value={amperage || ''} onChange={(e) => setAmperage(Math.max(0, Number(e.target.value) || 0))} placeholder="e.g. 150" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
          </label>
          <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Travel speed (mm/s)</span>
            <input type="number" min={0} step="0.5" value={travelSpeed || ''} onChange={(e) => setTravelSpeed(Math.max(0, Number(e.target.value) || 0))} placeholder="e.g. 5" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
          </label>
          <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Efficiency η ({(efficiency * 100).toFixed(0)}%)</span>
            <input type="range" min={0.5} max={1} step={0.05} value={efficiency} onChange={(e) => setEfficiency(Number(e.target.value))} className="mt-1 w-full" />
            <div className="text-[9px] text-zinc-400">SMAW 0.8 · GMAW 0.85 · GTAW 0.6</div>
          </label>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || voltage <= 0 || amperage <= 0 || travelSpeed <= 0} className="w-full rounded bg-red-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Compute heat input'}
          </button>
        </div>

        <div className="space-y-2">
          {!result && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">Enter V/I/travel speed.</div>}
          {result && (
            <>
              <div className="rounded-lg border-2 border-red-500/40 bg-red-500/10 p-3">
                <div className="text-[10px] uppercase tracking-wider text-red-300">Heat input</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-mono text-3xl text-red-100">{result.heatInputJmm}</span>
                  <span className="text-sm text-zinc-400">J/mm</span>
                </div>
                <div className="text-[10px] text-zinc-400">({result.heatInputKjPerInch} kJ/in)</div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1.5"><div className="text-[9px] text-zinc-400">Classification</div><div className="font-mono text-red-200">{result.classification}</div></div>
                <div className={`rounded border px-2 py-1.5 ${result.hazRisk === 'low' ? 'border-emerald-500/30 bg-emerald-500/10' : result.hazRisk === 'high' ? 'border-rose-500/30 bg-rose-500/10' : 'border-amber-500/30 bg-amber-500/10'}`}>
                  <div className={`text-[9px] ${result.hazRisk === 'low' ? 'text-emerald-300' : result.hazRisk === 'high' ? 'text-rose-300' : 'text-amber-300'}`}>HAZ risk</div>
                  <div className="font-mono">{result.hazRisk}</div>
                </div>
              </div>
              {result.recommendation && <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">{result.recommendation}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function WeldInspection() {
  const [weldType, setWeldType] = useState<typeof WELD_TYPES[number]>('fillet');
  const [code, setCode] = useState('AWS D1.1');
  const [items, setItems] = useState<Array<{ item: string; passed: boolean }>>([{ item: '', passed: true }]);
  const [result, setResult] = useState<InspectionResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const inspections = items.filter((i) => i.item.trim()).map((i) => ({ item: i.item, passed: i.passed }));
      const r = await callWeld<InspectionResult>('inspectionChecklist', { weldType, code, inspections });
      setResult(r);
      return r;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-emerald-500/20 bg-gradient-to-br from-zinc-950 via-emerald-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-emerald-500/20 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-semibold text-white">Weld inspection</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">welding.inspectionChecklist</span>
        </div>
        {result && (
          <SaveAsDtuButton compact apiSource="concord-welding-inspect"
            title={`Inspection — ${result.passed}/${(result.passed || 0) + (result.failed || 0)} passed (${result.verdict})`}
            content={`Code: ${result.code}\nWeld type: ${result.weldType}\nPassed: ${result.passed}\nFailed: ${result.failed}\nCritical failed: ${result.criticalFailed}\nVerdict: ${result.verdict}\nNDT required: ${result.ndtRequired ? 'YES' : 'no'}\n${(result.ndtRecommendations || []).map((r) => `  - ${r}`).join('\n')}\n\nItems:\n${(result.items || []).map((it) => `  ${it.passed ? '✓' : '✗'} [${it.category}] ${it.item}${it.required ? ' (required)' : ''}`).join('\n')}`}
            extraTags={['welding', 'inspection', code, weldType]} rawData={{ weldType, code, items, result }} />
        )}
      </header>

      <div className="p-4 space-y-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <select value={weldType} onChange={(e) => setWeldType(e.target.value as typeof weldType)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
            {WELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={code} onChange={(e) => setCode(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
            {WELD_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending} className="rounded bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Run inspection'}
          </button>
        </div>

        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Findings (your inspection items)</div>
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-[1fr_70px_30px] gap-1.5">
              <input className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" placeholder="Inspection item finding" value={it.item} onChange={(e) => setItems((is) => is.map((x, idx) => idx === i ? { ...x, item: e.target.value } : x))} />
              <label className="flex items-center justify-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-1 text-[10px] text-zinc-300">
                <input type="checkbox" checked={it.passed} onChange={(e) => setItems((is) => is.map((x, idx) => idx === i ? { ...x, passed: e.target.checked } : x))} />Pass
              </label>
              <button aria-label="Delete" type="button" onClick={() => setItems((is) => is.filter((_, idx) => idx !== i))} className="rounded border border-zinc-800 text-zinc-400 hover:text-rose-300"><Trash2 className="mx-auto h-3 w-3" /></button>
            </div>
          ))}
          <button type="button" onClick={() => setItems((is) => [...is, { item: '', passed: true }])} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-emerald-500/40"><Plus className="h-3 w-3" />Add finding</button>
        </div>

        {result && (
          <>
            <div className={`rounded-lg border-2 p-3 text-center ${result.verdict?.includes('PASS') ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-rose-500/40 bg-rose-500/10'}`}>
              {result.verdict?.includes('PASS') ? <ShieldCheck className="mx-auto h-5 w-5 text-emerald-300" /> : <AlertTriangle className="mx-auto h-5 w-5 text-rose-300" />}
              <div className="mt-1 font-mono text-xl font-bold text-white">{result.verdict}</div>
              <div className="mt-0.5 text-[11px] text-zinc-300">{result.passed}/{(result.passed || 0) + (result.failed || 0)} items passed{result.criticalFailed ? ` · ${result.criticalFailed} critical` : ''}</div>
            </div>
            {result.ndtRequired && result.ndtRecommendations && (
              <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                <div className="font-semibold">NDT required</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {result.ndtRecommendations.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            )}
            {result.items && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-zinc-400">Full checklist</div>
                {result.items.map((it, i) => (
                  <div key={i} className={`flex items-center justify-between rounded border px-2 py-1 ${it.passed ? 'border-emerald-500/15 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/10'} text-[10px]`}>
                    <span className="text-zinc-100">{it.passed ? '✓' : '✗'} {it.item}</span>
                    <span className="flex items-center gap-1">
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">{it.category}</span>
                      {it.required && <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-rose-200">required</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function WelderProcedures() {
  return (
    <div className="space-y-4">
      <JointStrengthCalc />
      <RodSelector />
      <HeatInputCalc />
      <WeldInspection />
    </div>
  );
}
