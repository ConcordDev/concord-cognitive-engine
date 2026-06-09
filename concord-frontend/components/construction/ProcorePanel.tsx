'use client';

/**
 * ProcorePanel — Procore-lite construction project suite.
 * Four bespoke widgets:
 *
 *  1. TakeoffEstimate    — line-item table with quantity/unit/cost/
 *                         waste → adjusted qty + line totals + materials
 *                         subtotal
 *  2. CriticalPath       — task list (name + duration + deps) → CPM
 *                         analysis with critical-path highlight
 *  3. SafetyCompliance   — OSHA-style checklist + incidents +
 *                         worker hours → compliance rate + IIR
 *  4. ProgressReport     — phase-by-phase planned vs actual %
 *                         → variance bars + overall schedule verdict
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Hammer, GitBranch, HardHat, BarChart3, Plus, Trash2, Loader2,
  AlertTriangle, ShieldCheck, TrendingUp, TrendingDown,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

async function callCon<T>(action: string, data: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await apiHelpers.lens.runDomain('construction', action, { input: { artifact: { data } } });
    const env = (r as { data?: { ok: boolean; result?: T } }).data;
    if (!env?.ok) return null;
    const raw = env.result as unknown as { ok?: boolean; result?: T } | T;
    if (raw && typeof raw === 'object' && 'result' in raw && (raw as { result?: T }).result) {
      return (raw as { result: T }).result;
    }
    return env.result as T;
  } catch { return null; }
}

interface LineItem { description: string; quantity: string; unit: string; unitCost: string; wastePercent: string }
interface TakeoffResult { lineItems?: Array<{ description: string; quantity: number; unit: string; unitCost: number; wastePercent: number; adjustedQuantity: number; lineCost: number }>; subtotalMaterials?: number; tax?: number; total?: number; itemCount?: number }
interface CpmTask { name: string; duration: string; deps: string }
interface CpmResult { tasks?: Record<string, { name: string; duration: number; earlyStart: number; earlyFinish: number; lateStart: number; lateFinish: number; slack: number; deps: string[] }>; criticalPath?: string[]; projectDuration?: number; criticalTaskCount?: number }
interface SafetyItem { name: string; passed: boolean; critical: boolean }
interface SafetyResult { complianceRate?: number; checklistResults?: { passed: number; failed: number; total: number }; incidentRate?: number; incidentRateLabel?: string; incidents?: number; workers?: number; hoursWorked?: number; rating?: string; criticalFailures?: string[] }
interface Phase { name: string; plannedPercent: string; actualPercent: string }
interface ProgressResult { phases?: Array<{ phase: string; plannedPercent: number; actualPercent: number; variance: number; status: string }>; overallPlanned?: number; overallActual?: number; overallVariance?: number; verdict?: string }

function TakeoffEstimate() {
  const [items, setItems] = useState<LineItem[]>([{ description: '', quantity: '', unit: 'each', unitCost: '', wastePercent: '10' }]);
  const [result, setResult] = useState<TakeoffResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const lineItems = items.filter((i) => i.description.trim()).map((i) => ({
        description: i.description, quantity: parseFloat(i.quantity) || 0, unit: i.unit,
        unitCost: parseFloat(i.unitCost) || 0, wastePercent: parseFloat(i.wastePercent) || 0,
      }));
      const r = await callCon<TakeoffResult>('takeoffEstimate', { lineItems });
      setResult(r);
      return r;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-orange-500/20 bg-gradient-to-br from-zinc-950 via-orange-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-orange-500/20 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Hammer className="h-4 w-4 text-orange-400" />
          <span className="text-sm font-semibold text-white">Takeoff estimate</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">construction.takeoffEstimate</span>
        </div>
        {result && (
          <SaveAsDtuButton compact apiSource="concord-construction-takeoff"
            title={`Takeoff — ${result.itemCount} items, $${result.total} total`}
            content={`Items: ${result.itemCount}\nMaterials subtotal: $${result.subtotalMaterials}\nTax: $${result.tax}\nTotal: $${result.total}\n\n${(result.lineItems || []).map((l) => `  ${l.description}: ${l.quantity} ${l.unit} +${l.wastePercent}% waste → ${l.adjustedQuantity} × $${l.unitCost} = $${l.lineCost}`).join('\n')}`}
            extraTags={['construction', 'takeoff', 'estimate']} rawData={{ items, result }} />
        )}
      </header>

      <div className="p-4 space-y-2">
        <div className="grid grid-cols-[1fr_70px_70px_80px_70px_30px] gap-1.5 text-[9px] uppercase tracking-wider text-zinc-400">
          <span>Description</span><span>Qty</span><span>Unit</span><span>Unit $</span><span>Waste %</span><span></span>
        </div>
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-[1fr_70px_70px_80px_70px_30px] gap-1.5">
            <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" placeholder="2x4 stud 8ft" value={it.description} onChange={(e) => setItems((is) => is.map((x, idx) => idx === i ? { ...x, description: e.target.value } : x))} />
            <input type="number" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={it.quantity} onChange={(e) => setItems((is) => is.map((x, idx) => idx === i ? { ...x, quantity: e.target.value } : x))} />
            <select className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" value={it.unit} onChange={(e) => setItems((is) => is.map((x, idx) => idx === i ? { ...x, unit: e.target.value } : x))}>
              <option value="each">each</option><option value="lf">LF</option><option value="sf">SF</option><option value="cy">CY</option><option value="lb">lb</option><option value="bag">bag</option>
            </select>
            <input type="number" step="0.01" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={it.unitCost} onChange={(e) => setItems((is) => is.map((x, idx) => idx === i ? { ...x, unitCost: e.target.value } : x))} />
            <input type="number" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={it.wastePercent} onChange={(e) => setItems((is) => is.map((x, idx) => idx === i ? { ...x, wastePercent: e.target.value } : x))} />
            <button aria-label="Delete" type="button" onClick={() => setItems((is) => is.filter((_, idx) => idx !== i))} className="rounded border border-zinc-800 text-zinc-400 hover:text-rose-300"><Trash2 className="mx-auto h-3 w-3" /></button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setItems((is) => [...is, { description: '', quantity: '', unit: 'each', unitCost: '', wastePercent: '10' }])} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-orange-500/40"><Plus className="h-3 w-3" />Add line</button>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || items.filter((i) => i.description.trim()).length === 0} className="rounded bg-orange-500 px-3 py-1 text-xs font-semibold text-white hover:bg-orange-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Estimate'}
          </button>
        </div>

        {result?.lineItems && (
          <div className="space-y-1 pt-2">
            {result.lineItems.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_120px_90px] gap-2 rounded border border-orange-500/15 bg-zinc-950/40 px-2 py-1 text-[11px]">
                <span className="text-zinc-100 truncate">{l.description}</span>
                <span className="font-mono text-zinc-400">{l.adjustedQuantity} {l.unit} × ${l.unitCost}</span>
                <span className="text-right font-mono text-orange-200">${l.lineCost}</span>
              </div>
            ))}
            <div className="grid grid-cols-3 gap-2 pt-1">
              <div className="rounded border border-orange-500/15 bg-zinc-950/40 px-2 py-1.5"><div className="text-[9px] text-zinc-400">Materials</div><div className="font-mono text-orange-200">${result.subtotalMaterials}</div></div>
              <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1.5"><div className="text-[9px] text-zinc-400">Tax</div><div className="font-mono text-zinc-300">${result.tax}</div></div>
              <div className="rounded border-2 border-orange-500/40 bg-orange-500/10 px-2 py-1.5"><div className="text-[9px] text-orange-300">Total</div><div className="font-mono text-orange-100">${result.total}</div></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CriticalPathView() {
  const [tasks, setTasks] = useState<CpmTask[]>([{ name: '', duration: '', deps: '' }]);
  const [result, setResult] = useState<CpmResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const cleanTasks = tasks.filter((t) => t.name.trim()).map((t) => ({
        name: t.name, duration: parseInt(t.duration) || 1,
        dependencies: t.deps.split(',').map((d) => d.trim()).filter(Boolean),
      }));
      const r = await callCon<CpmResult>('criticalPath', { tasks: cleanTasks });
      setResult(r);
      return r;
    },
  });

  const taskList = result?.tasks ? Object.values(result.tasks) : [];
  const critSet = new Set(result?.criticalPath || []);

  return (
    <div className="overflow-hidden rounded-xl border border-purple-500/20 bg-gradient-to-br from-zinc-950 via-purple-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-purple-500/20 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-purple-400" />
          <span className="text-sm font-semibold text-white">Critical path</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">construction.criticalPath</span>
        </div>
        {result && (
          <SaveAsDtuButton compact apiSource="concord-construction-cpm"
            title={`CPM — ${result.projectDuration} days, ${result.criticalTaskCount} critical tasks`}
            content={`Project duration: ${result.projectDuration} days\nCritical tasks: ${result.criticalTaskCount}\nCritical path: ${result.criticalPath?.join(' → ')}\n\n${taskList.map((t) => `  ${t.name}: ${t.duration}d (ES=${t.earlyStart}, EF=${t.earlyFinish}, slack=${t.slack})${critSet.has(t.name) ? ' [CRITICAL]' : ''}`).join('\n')}`}
            extraTags={['construction', 'cpm', 'schedule']} rawData={{ tasks, result }} />
        )}
      </header>

      <div className="p-4 space-y-2">
        <div className="grid grid-cols-[1fr_70px_1fr_30px] gap-1.5 text-[9px] uppercase tracking-wider text-zinc-400">
          <span>Task</span><span>Days</span><span>Deps (comma)</span><span></span>
        </div>
        {tasks.map((t, i) => (
          <div key={i} className="grid grid-cols-[1fr_70px_1fr_30px] gap-1.5">
            <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" placeholder="Foundation" value={t.name} onChange={(e) => setTasks((ts) => ts.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} />
            <input type="number" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={t.duration} onChange={(e) => setTasks((ts) => ts.map((x, idx) => idx === i ? { ...x, duration: e.target.value } : x))} />
            <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" placeholder="Excavation, Permits" value={t.deps} onChange={(e) => setTasks((ts) => ts.map((x, idx) => idx === i ? { ...x, deps: e.target.value } : x))} />
            <button aria-label="Delete" type="button" onClick={() => setTasks((ts) => ts.filter((_, idx) => idx !== i))} className="rounded border border-zinc-800 text-zinc-400 hover:text-rose-300"><Trash2 className="mx-auto h-3 w-3" /></button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setTasks((ts) => [...ts, { name: '', duration: '', deps: '' }])} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-purple-500/40"><Plus className="h-3 w-3" />Add task</button>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || tasks.filter((t) => t.name.trim()).length === 0} className="rounded bg-purple-500 px-3 py-1 text-xs font-semibold text-white hover:bg-purple-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Compute CPM'}
          </button>
        </div>

        {result?.tasks && (
          <div className="space-y-2 pt-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border-2 border-purple-500/40 bg-purple-500/10 p-3"><div className="text-[10px] uppercase tracking-wider text-purple-300">Project duration</div><div className="font-mono text-2xl text-purple-100">{result.projectDuration} <span className="text-sm text-zinc-400">days</span></div></div>
              <div className="rounded-lg border-2 border-rose-500/40 bg-rose-500/10 p-3"><div className="text-[10px] uppercase tracking-wider text-rose-300">Critical tasks</div><div className="font-mono text-2xl text-rose-100">{result.criticalTaskCount}</div></div>
            </div>
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-zinc-400">Task schedule (CPM analysis)</div>
              {taskList.map((t, i) => (
                <div key={i} className={`grid grid-cols-[1fr_60px_60px_60px_70px] gap-2 rounded border px-2 py-1.5 text-[11px] ${critSet.has(t.name) ? 'border-rose-500/40 bg-rose-500/10' : 'border-purple-500/15 bg-zinc-950/40'}`}>
                  <span className={critSet.has(t.name) ? 'font-semibold text-rose-100' : 'text-zinc-100'}>{critSet.has(t.name) && '⚠ '}{t.name}</span>
                  <span className="font-mono text-zinc-400">{t.duration}d</span>
                  <span className="font-mono text-zinc-400">ES {t.earlyStart}</span>
                  <span className="font-mono text-zinc-400">EF {t.earlyFinish}</span>
                  <span className={`font-mono ${t.slack === 0 ? 'text-rose-300' : 'text-emerald-300'}`}>slack {t.slack}</span>
                </div>
              ))}
            </div>
            {result.criticalPath && (
              <div className="rounded border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-[11px] text-rose-200">
                <span className="text-rose-300 font-semibold">Critical path:</span> {result.criticalPath.join(' → ')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SafetyCompliance() {
  const [items, setItems] = useState<SafetyItem[]>([{ name: '', passed: true, critical: false }]);
  const [incidents, setIncidents] = useState(0);
  const [workers, setWorkers] = useState(0);
  const [hours, setHours] = useState(0);
  const [result, setResult] = useState<SafetyResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const checklist = items.filter((i) => i.name.trim()).map((i) => ({ name: i.name, passed: i.passed, critical: i.critical }));
      const r = await callCon<SafetyResult>('safetyCompliance', { safetyChecklist: checklist, incidents: Array.from({ length: incidents }, (_, n) => ({ id: n + 1 })), workerCount: workers, totalHoursWorked: hours });
      setResult(r);
      return r;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-amber-500/20 bg-gradient-to-br from-zinc-950 via-amber-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-amber-500/20 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <HardHat className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-white">Safety compliance</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">construction.safetyCompliance</span>
        </div>
        {result && (
          <SaveAsDtuButton compact apiSource="concord-construction-safety"
            title={`Safety ${result.complianceRate}% (IIR ${result.incidentRate})`}
            content={`Compliance rate: ${result.complianceRate}% (${result.rating})\nChecklist: ${result.checklistResults?.passed}/${result.checklistResults?.total} passed\nIncidents: ${result.incidents} in ${result.hoursWorked}h with ${result.workers} workers\nIncident rate: ${result.incidentRate} ${result.incidentRateLabel}\nCritical failures:\n${(result.criticalFailures || []).map((f) => `  - ${f}`).join('\n')}`}
            extraTags={['construction', 'safety', 'osha']} rawData={{ items, incidents, workers, hours, result }} />
        )}
      </header>

      <div className="p-4 space-y-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Incidents</span>
            <input type="number" min={0} value={incidents || ''} onChange={(e) => setIncidents(Math.max(0, Number(e.target.value) || 0))} placeholder="0" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
          </label>
          <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Worker count</span>
            <input type="number" min={0} value={workers || ''} onChange={(e) => setWorkers(Math.max(0, Number(e.target.value) || 0))} placeholder="e.g. 12" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
          </label>
          <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Hours worked</span>
            <input type="number" min={0} value={hours || ''} onChange={(e) => setHours(Math.max(0, Number(e.target.value) || 0))} placeholder="e.g. 4800" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" />
          </label>
        </div>

        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Checklist items</div>
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-[1fr_70px_60px_30px] gap-1.5">
              <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" placeholder="Fall protection on Level 3" value={it.name} onChange={(e) => setItems((is) => is.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} />
              <label className="flex items-center justify-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-1 text-[10px] text-zinc-300">
                <input type="checkbox" checked={it.passed} onChange={(e) => setItems((is) => is.map((x, idx) => idx === i ? { ...x, passed: e.target.checked } : x))} />Pass
              </label>
              <label className="flex items-center justify-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-1 text-[10px] text-rose-300">
                <input type="checkbox" checked={it.critical} onChange={(e) => setItems((is) => is.map((x, idx) => idx === i ? { ...x, critical: e.target.checked } : x))} />Crit
              </label>
              <button aria-label="Delete" type="button" onClick={() => setItems((is) => is.filter((_, idx) => idx !== i))} className="rounded border border-zinc-800 text-zinc-400 hover:text-rose-300"><Trash2 className="mx-auto h-3 w-3" /></button>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setItems((is) => [...is, { name: '', passed: true, critical: false }])} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-amber-500/40"><Plus className="h-3 w-3" />Add item</button>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || items.filter((i) => i.name.trim()).length === 0} className="rounded bg-amber-500 px-3 py-1 text-xs font-semibold text-black hover:bg-amber-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Audit compliance'}
          </button>
        </div>

        {result && (
          <div className="grid grid-cols-2 gap-2 pt-2">
            <div className={`rounded-lg border-2 p-3 text-center ${result.rating === 'excellent' ? 'border-emerald-500/40 bg-emerald-500/10' : result.rating === 'acceptable' ? 'border-amber-500/40 bg-amber-500/10' : 'border-rose-500/40 bg-rose-500/10'}`}>
              {result.rating === 'excellent' ? <ShieldCheck className="mx-auto h-5 w-5 text-emerald-300" /> : <AlertTriangle className="mx-auto h-5 w-5 text-amber-300" />}
              <div className="mt-1 font-mono text-3xl text-white">{result.complianceRate}%</div>
              <div className="text-[10px] uppercase text-zinc-400">compliance · {result.rating}</div>
            </div>
            <div className="rounded-lg border-2 border-amber-500/40 bg-amber-500/10 p-3 text-center">
              <div className="font-mono text-2xl text-amber-100">{result.incidentRate}</div>
              <div className="text-[10px] uppercase text-amber-300">OSHA IIR</div>
              <div className="mt-0.5 text-[9px] text-zinc-400">per 200k hrs</div>
            </div>
            {result.criticalFailures && result.criticalFailures.length > 0 && (
              <div className="col-span-2 rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
                <div className="font-semibold">Critical failures</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {result.criticalFailures.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressReport() {
  const [phases, setPhases] = useState<Phase[]>([{ name: '', plannedPercent: '', actualPercent: '' }]);
  const [result, setResult] = useState<ProgressResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const phaseList = phases.filter((p) => p.name.trim()).map((p) => ({
        name: p.name, plannedPercent: parseFloat(p.plannedPercent) || 0, actualPercent: parseFloat(p.actualPercent) || 0,
      }));
      const r = await callCon<ProgressResult>('progressReport', { phases: phaseList });
      setResult(r);
      return r;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-cyan-500/20 bg-gradient-to-br from-zinc-950 via-cyan-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-cyan-500/20 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white">Progress report</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">construction.progressReport</span>
        </div>
        {result && (
          <SaveAsDtuButton compact apiSource="concord-construction-progress"
            title={`Progress ${result.overallActual?.toFixed(0)}% / planned ${result.overallPlanned?.toFixed(0)}% (${result.verdict})`}
            content={`Overall planned: ${result.overallPlanned?.toFixed(1)}%\nOverall actual: ${result.overallActual?.toFixed(1)}%\nOverall variance: ${result.overallVariance?.toFixed(1)}%\nVerdict: ${result.verdict}\n\nPhases:\n${(result.phases || []).map((p) => `  ${p.phase}: planned ${p.plannedPercent}% / actual ${p.actualPercent}% (${p.variance > 0 ? '+' : ''}${p.variance}, ${p.status})`).join('\n')}`}
            extraTags={['construction', 'progress', 'schedule']} rawData={{ phases, result }} />
        )}
      </header>

      <div className="p-4 space-y-2">
        <div className="grid grid-cols-[1fr_90px_90px_30px] gap-1.5 text-[9px] uppercase tracking-wider text-zinc-400">
          <span>Phase</span><span>Planned %</span><span>Actual %</span><span></span>
        </div>
        {phases.map((p, i) => (
          <div key={i} className="grid grid-cols-[1fr_90px_90px_30px] gap-1.5">
            <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" placeholder="Foundation" value={p.name} onChange={(e) => setPhases((ps) => ps.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} />
            <input type="number" min={0} max={100} className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={p.plannedPercent} onChange={(e) => setPhases((ps) => ps.map((x, idx) => idx === i ? { ...x, plannedPercent: e.target.value } : x))} />
            <input type="number" min={0} max={100} className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={p.actualPercent} onChange={(e) => setPhases((ps) => ps.map((x, idx) => idx === i ? { ...x, actualPercent: e.target.value } : x))} />
            <button aria-label="Delete" type="button" onClick={() => setPhases((ps) => ps.filter((_, idx) => idx !== i))} className="rounded border border-zinc-800 text-zinc-400 hover:text-rose-300"><Trash2 className="mx-auto h-3 w-3" /></button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setPhases((ps) => [...ps, { name: '', plannedPercent: '', actualPercent: '' }])} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-cyan-500/40"><Plus className="h-3 w-3" />Add phase</button>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || phases.filter((p) => p.name.trim()).length === 0} className="rounded bg-cyan-500 px-3 py-1 text-xs font-semibold text-white hover:bg-cyan-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Report'}
          </button>
        </div>

        {result?.phases && (
          <div className="space-y-1.5 pt-2">
            {result.phases.map((p, i) => (
              <div key={i} className="rounded border border-cyan-500/15 bg-zinc-950/40 px-3 py-1.5">
                <div className="flex items-baseline justify-between text-[11px]">
                  <span className="text-white">{p.phase}</span>
                  <span className="font-mono">
                    <span className="text-cyan-200">{p.actualPercent}%</span>
                    <span className="text-zinc-400"> / planned </span>
                    <span className="text-zinc-300">{p.plannedPercent}%</span>
                    <span className={`ml-2 ${p.variance >= 0 ? 'text-emerald-300' : p.variance >= -10 ? 'text-amber-300' : 'text-rose-300'}`}>{p.variance > 0 ? '+' : ''}{p.variance}</span>
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-800">
                  <div className="absolute h-2 w-[1px] bg-zinc-500" style={{ marginLeft: `${p.plannedPercent}%` }} />
                  <div className={`h-full ${p.status === 'on-track' ? 'bg-emerald-500' : p.status === 'slightly-behind' ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${p.actualPercent}%` }} />
                </div>
              </div>
            ))}
            <div className={`rounded-lg border-2 p-3 text-center ${result.verdict?.includes('ahead') ? 'border-emerald-500/40 bg-emerald-500/10' : result.verdict?.includes('behind') ? 'border-rose-500/40 bg-rose-500/10' : 'border-amber-500/40 bg-amber-500/10'}`}>
              {(result.overallVariance || 0) >= 0 ? <TrendingUp className="mx-auto h-5 w-5 text-emerald-300" /> : <TrendingDown className="mx-auto h-5 w-5 text-rose-300" />}
              <div className="mt-1 font-mono text-xl font-bold text-white">{result.verdict}</div>
              <div className="text-[11px] text-zinc-300">Overall: {result.overallActual?.toFixed(0)}% actual / {result.overallPlanned?.toFixed(0)}% planned ({(result.overallVariance || 0) > 0 ? '+' : ''}{result.overallVariance?.toFixed(1)})</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ProcorePanel() {
  return (
    <div className="space-y-4">
      <TakeoffEstimate />
      <CriticalPathView />
      <SafetyCompliance />
      <ProgressReport />
    </div>
  );
}
