'use client';

/**
 * ManualJCalc — Manual J / Wrightsoft-style HVAC load calculator
 * suite. Four bespoke widgets, each visually distinct:
 *
 *  1. LoadCalculator      — square footage / climate / insulation →
 *                          BTU heating + cooling, tonnage, equipment
 *  2. EnergyAudit         — bill / sqft / age → annual cost, savings
 *                          opportunities, ROI score
 *  3. MaintenanceCalendar — system type + last service → ordered
 *                          task list (DIY / pro badges)
 *  4. ZoneBalanceMonitor  — editable zone temps → per-zone deviation
 *                          bars, system balance verdict
 *
 * All four call existing hvac.* macros. No mock data.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Thermometer, Snowflake, Flame, AlertCircle, Wrench, Plus, Trash2,
  Loader2, Home, DollarSign, Wind,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

async function callHvac<T>(action: string, data: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await apiHelpers.lens.runDomain('hvac', action, { input: { artifact: { data } } });
    const env = (r as { data?: { ok: boolean; result?: T } }).data;
    if (!env?.ok) return null;
    const raw = env.result as unknown as { ok?: boolean; result?: T } | T;
    if (raw && typeof raw === 'object' && 'result' in raw && (raw as { result?: T }).result) {
      return (raw as { result: T }).result;
    }
    return env.result as T;
  } catch { return null; }
}

interface LoadResult { squareFootage?: number; heatingBTU?: number; coolingBTU?: number; tonnageRecommended?: string; equipmentSize?: string; recommendation?: string }
interface AuditResult { monthlyBill?: number; annualCost?: number; costPerSqFt?: number; systemEfficiency?: string; expectedLifespan?: string; savingsOpportunities?: string[]; estimatedAnnualSavings?: number; roiScore?: number; recommendation?: string }
interface MaintTask { task: string; frequency: string; priority: string; diy: boolean; nextDue?: string }
interface MaintResult { systemType?: string; tasks?: MaintTask[]; lastServiceDate?: string | null; overdueCount?: number; recommendation?: string }
interface Zone { name: string; currentTemp: string; targetTemp: string }
interface ZoneResult { zones?: Array<{ zone: string; current: number; target: number; deviation: number }>; maxDeviation?: number; avgDeviation?: number; balanceScore?: number; verdict?: string; recommendation?: string }

function LoadCalculator() {
  const [sqft, setSqft] = useState(0);
  const [stories, setStories] = useState(1);
  const [insulation, setInsulation] = useState<'poor' | 'average' | 'good' | 'excellent'>('average');
  const [climate, setClimate] = useState<'hot-humid' | 'hot-dry' | 'temperate' | 'cold' | 'very-cold'>('temperate');
  const [result, setResult] = useState<LoadResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const r = await callHvac<LoadResult>('loadCalculation', { squareFootage: sqft, stories, insulation, climate });
      setResult(r);
      return r;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-blue-500/20 bg-gradient-to-br from-zinc-950 via-blue-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-blue-500/20 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Home className="h-4 w-4 text-blue-400" />
          <span className="text-sm font-semibold text-white">Manual J load</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">hvac.loadCalculation</span>
        </div>
        {result && (
          <SaveAsDtuButton compact apiSource="concord-hvac-load"
            title={`Load calc — ${sqft}sf / ${climate} → ${result.tonnageRecommended}`}
            content={`House: ${result.squareFootage} sf, ${stories} story\nInsulation: ${insulation}\nClimate: ${climate}\nHeating: ${result.heatingBTU} BTU\nCooling: ${result.coolingBTU} BTU\nTonnage: ${result.tonnageRecommended}\nEquipment: ${result.equipmentSize}\nNote: ${result.recommendation}`}
            extraTags={['hvac', 'load-calc', 'manual-j', climate]}
            rawData={{ sqft, stories, insulation, climate, result }} />
        )}
      </header>

      <div className="grid gap-3 p-4 md:grid-cols-[220px_1fr]">
        <div className="space-y-2">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400">Square footage</span>
            <input type="number" min={0} value={sqft || ''} onChange={(e) => setSqft(Math.max(0, Number(e.target.value) || 0))} placeholder="e.g. 1800" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400">Stories</span>
            <input type="number" min={1} max={4} value={stories} onChange={(e) => setStories(Math.max(1, Math.min(4, Number(e.target.value) || 1)))} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400">Insulation</span>
            <select value={insulation} onChange={(e) => setInsulation(e.target.value as typeof insulation)} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
              <option value="poor">Poor (pre-1970)</option>
              <option value="average">Average (1970–2000)</option>
              <option value="good">Good (2000–2015)</option>
              <option value="excellent">Excellent (Energy Star)</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400">Climate</span>
            <select value={climate} onChange={(e) => setClimate(e.target.value as typeof climate)} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
              <option value="hot-humid">Hot &amp; humid (FL/Gulf)</option>
              <option value="hot-dry">Hot &amp; dry (SW desert)</option>
              <option value="temperate">Temperate (most US)</option>
              <option value="cold">Cold (NE/upper Midwest)</option>
              <option value="very-cold">Very cold (MN/MT/AK)</option>
            </select>
          </label>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || sqft <= 0} className="w-full rounded bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Calculate load'}
          </button>
        </div>

        <div className="space-y-2">
          {!result && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">Enter dimensions above.</div>}
          {result && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border-2 border-rose-500/40 bg-rose-500/10 p-3">
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-rose-300"><Flame className="h-3 w-3" />Heating</div>
                  <div className="mt-1 font-mono text-2xl text-rose-100">{result.heatingBTU?.toLocaleString()}</div>
                  <div className="text-[10px] text-zinc-400">BTU/hr</div>
                </div>
                <div className="rounded-lg border-2 border-cyan-500/40 bg-cyan-500/10 p-3">
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-cyan-300"><Snowflake className="h-3 w-3" />Cooling</div>
                  <div className="mt-1 font-mono text-2xl text-cyan-100">{result.coolingBTU?.toLocaleString()}</div>
                  <div className="text-[10px] text-zinc-400">BTU/hr</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded border border-blue-500/30 bg-zinc-950/40 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-400">Tonnage</div>
                  <div className="font-mono text-xl text-blue-200">{result.tonnageRecommended}</div>
                </div>
                <div className="rounded border border-blue-500/30 bg-zinc-950/40 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-400">Equipment</div>
                  <div className="font-mono text-xl text-blue-200">{result.equipmentSize}</div>
                </div>
              </div>
              {result.recommendation && <div className="rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-[11px] text-amber-200">{result.recommendation}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EnergyAudit() {
  const [monthlyBill, setMonthlyBill] = useState(0);
  const [sqft, setSqft] = useState(0);
  const [systemAge, setSystemAge] = useState(0);
  const [result, setResult] = useState<AuditResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const r = await callHvac<AuditResult>('energyAudit', { monthlyBill, squareFootage: sqft, systemAge });
      setResult(r);
      return r;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-green-500/20 bg-gradient-to-br from-zinc-950 via-green-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-green-500/20 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-green-400" />
          <span className="text-sm font-semibold text-white">Energy audit</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">hvac.energyAudit</span>
        </div>
        {result && (
          <SaveAsDtuButton compact apiSource="concord-hvac-audit"
            title={`Energy audit — $${result.annualCost}/yr · ROI ${result.roiScore}`}
            content={`Monthly bill: $${result.monthlyBill}\nAnnual: $${result.annualCost}\nCost/sqft: $${result.costPerSqFt}\nSystem efficiency: ${result.systemEfficiency}\nExpected lifespan: ${result.expectedLifespan}\nEstimated annual savings: $${result.estimatedAnnualSavings}\nROI: ${result.roiScore}\n${result.recommendation}\n\nOpportunities:\n${(result.savingsOpportunities || []).map((o) => `  - ${o}`).join('\n')}`}
            extraTags={['hvac', 'energy-audit']} rawData={{ monthlyBill, sqft, systemAge, result }} />
        )}
      </header>

      <div className="grid gap-3 p-4 md:grid-cols-[220px_1fr]">
        <div className="space-y-2">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400">Monthly bill ($)</span>
            <input type="number" min={0} value={monthlyBill || ''} onChange={(e) => setMonthlyBill(Math.max(0, Number(e.target.value) || 0))} placeholder="e.g. 180" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400">Square footage</span>
            <input type="number" min={0} value={sqft || ''} onChange={(e) => setSqft(Math.max(0, Number(e.target.value) || 0))} placeholder="e.g. 1800" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400">System age (yr)</span>
            <input type="number" min={0} max={50} value={systemAge || ''} onChange={(e) => setSystemAge(Math.max(0, Math.min(50, Number(e.target.value) || 0)))} placeholder="e.g. 12" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
          </label>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || monthlyBill <= 0 || sqft <= 0} className="w-full rounded bg-green-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Run audit'}
          </button>
        </div>

        <div className="space-y-2">
          {!result && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">Enter bill + sqft + age.</div>}
          {result && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded border border-green-500/30 bg-zinc-950/40 px-2 py-1.5"><div className="text-[9px] text-zinc-400">Annual cost</div><div className="font-mono text-lg text-green-200">${result.annualCost?.toLocaleString()}</div></div>
                <div className="rounded border border-green-500/30 bg-zinc-950/40 px-2 py-1.5"><div className="text-[9px] text-zinc-400">$/sqft</div><div className="font-mono text-lg text-green-200">${result.costPerSqFt}</div></div>
                <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5"><div className="text-[9px] text-emerald-300">Save up to</div><div className="font-mono text-lg text-emerald-100">${result.estimatedAnnualSavings?.toLocaleString()}/yr</div></div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1.5"><div className="text-[9px] text-zinc-400">Efficiency</div><div className="font-mono text-zinc-300">{result.systemEfficiency}</div></div>
                <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1.5"><div className="text-[9px] text-zinc-400">Lifespan</div><div className="font-mono text-zinc-300">{result.expectedLifespan}</div></div>
              </div>
              {result.savingsOpportunities && (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-400">Opportunities</div>
                  <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-zinc-300">
                    {result.savingsOpportunities.map((o, i) => <li key={i}>{o}</li>)}
                  </ul>
                </div>
              )}
              {result.recommendation && <div className="rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-[11px] text-amber-200">{result.recommendation}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MaintenanceCalendar() {
  const [systemType, setSystemType] = useState<'central-ac' | 'heat-pump' | 'furnace' | 'boiler' | 'mini-split'>('central-ac');
  const [lastServiceDate, setLastServiceDate] = useState('');
  const [result, setResult] = useState<MaintResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const r = await callHvac<MaintResult>('maintenanceSchedule', { systemType, lastServiceDate });
      setResult(r);
      return r;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-amber-500/20 bg-gradient-to-br from-zinc-950 via-amber-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-amber-500/20 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-white">Maintenance calendar</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">hvac.maintenanceSchedule</span>
        </div>
        {result && (
          <SaveAsDtuButton compact apiSource="concord-hvac-maintenance"
            title={`HVAC maintenance — ${result.systemType} (${result.overdueCount || 0} overdue)`}
            content={`System: ${result.systemType}\nLast service: ${result.lastServiceDate || 'unknown'}\nOverdue: ${result.overdueCount || 0}\n\nTasks:\n${(result.tasks || []).map((t) => `  [${t.priority}] ${t.task} (${t.frequency})${t.diy ? ' [DIY]' : ' [pro]'}${t.nextDue ? ` — next: ${t.nextDue}` : ''}`).join('\n')}\n\n${result.recommendation || ''}`}
            extraTags={['hvac', 'maintenance', systemType]} rawData={{ systemType, lastServiceDate, result }} />
        )}
      </header>

      <div className="p-4 space-y-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_180px_140px]">
          <select value={systemType} onChange={(e) => setSystemType(e.target.value as typeof systemType)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
            <option value="central-ac">Central AC</option>
            <option value="heat-pump">Heat pump</option>
            <option value="furnace">Gas furnace</option>
            <option value="boiler">Boiler</option>
            <option value="mini-split">Ductless mini-split</option>
          </select>
          <input type="date" value={lastServiceDate} onChange={(e) => setLastServiceDate(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending} className="rounded bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Generate schedule'}
          </button>
        </div>

        {result?.tasks && (
          <div className="space-y-1.5">
            {result.tasks.map((t, i) => (
              <div key={i} className={`flex items-start gap-2 rounded border px-3 py-2 ${t.priority === 'high' ? 'border-rose-500/30 bg-rose-500/5' : t.priority === 'medium' ? 'border-amber-500/30 bg-amber-500/5' : 'border-zinc-800 bg-zinc-950/40'}`}>
                <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${t.priority === 'high' ? 'bg-rose-500 text-white' : t.priority === 'medium' ? 'bg-amber-500 text-black' : 'bg-zinc-700 text-zinc-300'}`}>{t.diy ? 'D' : 'P'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold text-white">{t.task}</div>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-400">
                    <span>{t.frequency}</span>
                    <span className={`rounded px-1.5 py-0.5 ${t.diy ? 'bg-emerald-500/20 text-emerald-200' : 'bg-blue-500/20 text-blue-200'}`}>{t.diy ? 'DIY' : 'Pro'}</span>
                    {t.nextDue && <span className="text-amber-300">next: {t.nextDue}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {result?.overdueCount && result.overdueCount > 0 ? (
          <div className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
            <AlertCircle className="mr-1 inline h-3 w-3" />{result.overdueCount} task{result.overdueCount === 1 ? '' : 's'} overdue.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ZoneBalanceMonitor() {
  const [zones, setZones] = useState<Zone[]>([{ name: '', currentTemp: '', targetTemp: '' }]);
  const [result, setResult] = useState<ZoneResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const z = zones.filter((x) => x.name.trim() && x.currentTemp && x.targetTemp).map((x) => ({
        name: x.name, currentTemp: parseFloat(x.currentTemp), targetTemp: parseFloat(x.targetTemp),
      }));
      const r = await callHvac<ZoneResult>('zoneBalance', { zones: z });
      setResult(r);
      return r;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-cyan-500/20 bg-gradient-to-br from-zinc-950 via-cyan-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-cyan-500/20 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Wind className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white">Zone balance monitor</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">hvac.zoneBalance</span>
        </div>
        {result && result.zones && (
          <SaveAsDtuButton compact apiSource="concord-hvac-zone-balance"
            title={`Zone balance — ${result.verdict} (max dev ${result.maxDeviation}°F)`}
            content={`Verdict: ${result.verdict}\nMax dev: ${result.maxDeviation}°F · Avg: ${result.avgDeviation}°F\nBalance score: ${result.balanceScore}\n\nZones:\n${result.zones.map((z) => `  ${z.zone}: ${z.current}°F (target ${z.target}°F, ±${z.deviation}°F)`).join('\n')}\n\n${result.recommendation || ''}`}
            extraTags={['hvac', 'zone-balance']} rawData={{ zones, result }} />
        )}
      </header>

      <div className="p-4 space-y-3">
        <div className="space-y-1.5">
          {zones.map((z, i) => (
            <div key={i} className="grid grid-cols-[1fr_90px_90px_30px] gap-2">
              <input className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" placeholder="Room name" value={z.name} onChange={(e) => setZones((zs) => zs.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} />
              <input type="number" className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" placeholder="Current °F" value={z.currentTemp} onChange={(e) => setZones((zs) => zs.map((x, idx) => idx === i ? { ...x, currentTemp: e.target.value } : x))} />
              <input type="number" className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" placeholder="Target °F" value={z.targetTemp} onChange={(e) => setZones((zs) => zs.map((x, idx) => idx === i ? { ...x, targetTemp: e.target.value } : x))} />
              <button aria-label="Delete" type="button" onClick={() => setZones((zs) => zs.filter((_, idx) => idx !== i))} className="rounded border border-zinc-800 text-zinc-400 hover:text-rose-300"><Trash2 className="mx-auto h-3 w-3" /></button>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setZones((zs) => [...zs, { name: '', currentTemp: '', targetTemp: '' }])} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-cyan-500/40"><Plus className="h-3 w-3" />Add zone</button>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || zones.filter((z) => z.name && z.currentTemp && z.targetTemp).length === 0} className="rounded bg-cyan-500 px-3 py-1 text-xs font-semibold text-white hover:bg-cyan-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Check balance'}
          </button>
        </div>

        {result?.zones && (
          <div className="space-y-1.5">
            {result.zones.map((z, i) => {
              const maxBar = result.maxDeviation || 1;
              const pct = (z.deviation / maxBar) * 100;
              const colour = z.deviation < 1 ? 'bg-emerald-500' : z.deviation < 3 ? 'bg-amber-500' : 'bg-rose-500';
              return (
                <div key={i} className="rounded border border-cyan-500/15 bg-zinc-950/40 px-3 py-1.5">
                  <div className="flex items-baseline justify-between text-[11px]">
                    <span className="text-white">{z.zone}</span>
                    <span className="font-mono">
                      <span className="text-cyan-200">{z.current}°F</span>
                      <span className="text-zinc-400"> / </span>
                      <span className="text-zinc-300">{z.target}°F</span>
                      <span className={`ml-2 ${z.deviation < 1 ? 'text-emerald-300' : z.deviation < 3 ? 'text-amber-300' : 'text-rose-300'}`}>±{z.deviation.toFixed(1)}</span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                    <div className={`h-full ${colour}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
            <div className={`rounded-lg border-2 p-3 text-center ${result.verdict?.includes('balanced') ? 'border-emerald-500/40 bg-emerald-500/10' : result.verdict?.includes('imbalanced') ? 'border-rose-500/40 bg-rose-500/10' : 'border-amber-500/40 bg-amber-500/10'}`}>
              <Thermometer className="mx-auto h-5 w-5 text-cyan-300" />
              <div className="mt-1 font-mono text-lg font-semibold text-white">{result.verdict}</div>
              {result.recommendation && <div className="mt-1 text-[11px] text-zinc-300">{result.recommendation}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ManualJCalc() {
  return (
    <div className="space-y-4">
      <LoadCalculator />
      <EnergyAudit />
      <MaintenanceCalendar />
      <ZoneBalanceMonitor />
    </div>
  );
}
