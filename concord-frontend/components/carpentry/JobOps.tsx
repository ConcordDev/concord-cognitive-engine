'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * JobOps — Houzz Pro / Buildertrend-style trade-management surface for the
 * carpentry lens. Six purpose-built panels, every value sourced from a real
 * backend macro (no mock/seed data):
 *
 *  1. CutListOptimizer  — carpentry.cutListOptimize (first-fit-decreasing
 *                         bin packing → boards needed + waste %)
 *  2. MaterialTakeoff   — carpentry.materialTakeoff (line items → priced
 *                         estimate with labor / overhead / margin)
 *  3. CrewSchedule      — carpentry.crew* + carpentry.schedule* (dispatch
 *                         calendar timeline)
 *  4. TimeTracking      — carpentry.timer* + carpentry.timeEntry* (per-job
 *                         labor costing with live running timers)
 *  5. PhotoJobLog       — carpentry.photoLog* (before/during/after per job)
 *  6. InvoicingPortal   — carpentry.estimateToInvoice + signEstimate +
 *                         invoice* + portal* (quote sign-off, conversion,
 *                         shareable client portal)
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Scissors, ClipboardList, CalendarClock, Timer, Camera, Receipt,
  Plus, Trash2, Loader2, Play, Square, PenLine, Link2, Check, X,
  UserPlus, FileSignature,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { TimelineView, type TimelineEvent } from '@/components/viz';

async function run<T = any>(action: string, params: Record<string, unknown> = {}): Promise<{ ok: boolean; result: T | null; error: string | null }> {
  const r = await lensRun<T>('carpentry', action, params);
  return r.data;
}

const card = 'overflow-hidden rounded-xl border border-amber-700/30 bg-gradient-to-br from-zinc-950 via-amber-950/10 to-zinc-950';
const head = 'flex items-center justify-between border-b border-amber-700/30 bg-zinc-900/40 px-4 py-2';
const inp = 'rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white';
const btn = 'rounded bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50 inline-flex items-center gap-1';
const ghostBtn = 'rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-amber-500/40 inline-flex items-center gap-1';
const macroTag = (m: string) => <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">carpentry.{m}</span>;

/* ───────────────────────── 1. Cut List Optimizer ───────────────────────── */

interface CutRow { label: string; length: string; quantity: string }
interface CutLayout { board: number; cuts: { label: string; length: number }[]; usedLength: number; offcut: number }
interface CutResult {
  boardsNeeded: number; stockLength: number; kerf: number; totalCutLength: number;
  wasteLength: number; wastePct: number; materialCost: number | null; layout: CutLayout[];
}

function CutListOptimizer() {
  const [cuts, setCuts] = useState<CutRow[]>([{ label: 'rail', length: '', quantity: '1' }]);
  const [stockLength, setStockLength] = useState('96');
  const [kerf, setKerf] = useState('0.125');
  const [stockCost, setStockCost] = useState('');
  const [result, setResult] = useState<CutResult | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const optimize = async () => {
    setBusy(true); setErr('');
    const r = await run<CutResult>('cutListOptimize', {
      stockLength: parseFloat(stockLength) || 96,
      kerf: parseFloat(kerf) || 0,
      stockCostPerBoard: parseFloat(stockCost) || 0,
      cuts: cuts.filter((c) => c.length).map((c) => ({
        label: c.label, length: parseFloat(c.length), quantity: parseInt(c.quantity, 10) || 1,
      })),
    });
    if (r.ok) { setResult(r.result); } else { setErr(r.error || 'optimization failed'); setResult(null); }
    setBusy(false);
  };

  return (
    <div className={card}>
      <header className={head}>
        <div className="flex items-center gap-2">
          <Scissors className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-white">Cut list optimizer</span>
          {macroTag('cutListOptimize')}
        </div>
      </header>
      <div className="space-y-2 p-4">
        <div className="grid grid-cols-3 gap-2">
          <label className="text-[10px] text-zinc-500">Stock length (in)
            <input className={`${inp} mt-0.5 w-full font-mono`} type="number" value={stockLength} onChange={(e) => setStockLength(e.target.value)} />
          </label>
          <label className="text-[10px] text-zinc-500">Saw kerf (in)
            <input className={`${inp} mt-0.5 w-full font-mono`} type="number" step="0.001" value={kerf} onChange={(e) => setKerf(e.target.value)} />
          </label>
          <label className="text-[10px] text-zinc-500">$ / board
            <input className={`${inp} mt-0.5 w-full font-mono`} type="number" step="0.01" value={stockCost} onChange={(e) => setStockCost(e.target.value)} />
          </label>
        </div>
        <div className="grid grid-cols-[1fr_80px_60px_30px] gap-1.5 text-[9px] uppercase tracking-wider text-zinc-500">
          <span>Label</span><span>Length</span><span>Qty</span><span></span>
        </div>
        {cuts.map((c, i) => (
          <div key={i} className="grid grid-cols-[1fr_80px_60px_30px] gap-1.5">
            <input className={inp} value={c.label} placeholder="cut" onChange={(e) => setCuts((cs) => cs.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))} />
            <input className={`${inp} font-mono`} type="number" placeholder="24" value={c.length} onChange={(e) => setCuts((cs) => cs.map((x, idx) => idx === i ? { ...x, length: e.target.value } : x))} />
            <input className={`${inp} font-mono`} type="number" placeholder="1" value={c.quantity} onChange={(e) => setCuts((cs) => cs.map((x, idx) => idx === i ? { ...x, quantity: e.target.value } : x))} />
            <button type="button" onClick={() => setCuts((cs) => cs.filter((_, idx) => idx !== i))} className="rounded border border-zinc-800 text-zinc-500 hover:text-rose-300" aria-label="Remove cut"><Trash2 className="mx-auto h-3 w-3" /></button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <button type="button" className={ghostBtn} onClick={() => setCuts((cs) => [...cs, { label: 'cut', length: '', quantity: '1' }])}><Plus className="h-3 w-3" />Add cut</button>
          <button type="button" className={btn} disabled={busy || cuts.filter((c) => c.length).length === 0} onClick={optimize}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Optimize'}
          </button>
        </div>
        {err && <div className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-200">{err}</div>}
        {result && (
          <div className="space-y-2 pt-1">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border-2 border-amber-500/40 bg-amber-500/10 p-2"><div className="text-[10px] uppercase text-amber-300">Boards</div><div className="font-mono text-2xl text-amber-100">{result.boardsNeeded}</div></div>
              <div className="rounded border border-rose-500/30 bg-rose-500/10 p-2"><div className="text-[10px] uppercase text-rose-300">Waste</div><div className="font-mono text-2xl text-rose-100">{result.wastePct}%</div></div>
              <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-2"><div className="text-[10px] uppercase text-emerald-300">Material $</div><div className="font-mono text-2xl text-emerald-100">{result.materialCost == null ? '—' : `$${result.materialCost}`}</div></div>
            </div>
            <div className="space-y-1">
              {result.layout.map((b) => (
                <div key={b.board} className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
                  <div className="mb-1 flex items-center justify-between text-[10px] text-zinc-500">
                    <span className="text-zinc-300">Board {b.board}</span>
                    <span>used {b.usedLength}&quot; · offcut {b.offcut}&quot;</span>
                  </div>
                  <div className="flex h-5 w-full overflow-hidden rounded bg-zinc-900">
                    {b.cuts.map((c, ci) => (
                      <div key={ci} title={`${c.label} — ${c.length}"`} className="flex items-center justify-center border-r border-zinc-950 bg-amber-600/60 text-[8px] text-amber-50"
                        style={{ width: `${(c.length / result.stockLength) * 100}%` }}>
                        {c.length}
                      </div>
                    ))}
                    {b.offcut > 0 && <div className="bg-zinc-800/60" style={{ width: `${(b.offcut / result.stockLength) * 100}%` }} />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── 2. Material Takeoff ───────────────────────── */

interface TakeoffRow { name: string; quantity: string; unit: string; unitCost: string }
interface TakeoffResult {
  projectName: string; materialSubtotal: number; materialWithWaste: number;
  laborCost: number; overhead: number; margin: number; total: number;
  items: { name: string; quantity: number; unit: string; unitCost: number; lineTotal: number }[];
}

function MaterialTakeoff({ onEstimate }: { onEstimate: (e: TakeoffResult) => void }) {
  const [projectName, setProjectName] = useState('');
  const [items, setItems] = useState<TakeoffRow[]>([{ name: '', quantity: '', unit: 'ea', unitCost: '' }]);
  const [laborHours, setLaborHours] = useState('');
  const [laborRate, setLaborRate] = useState('65');
  const [wastePct, setWastePct] = useState('10');
  const [marginPct, setMarginPct] = useState('20');
  const [result, setResult] = useState<TakeoffResult | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const compute = async () => {
    setBusy(true); setErr('');
    const r = await run<TakeoffResult>('materialTakeoff', {
      projectName,
      laborHours: parseFloat(laborHours) || 0,
      laborRate: parseFloat(laborRate) || 0,
      wastePct: parseFloat(wastePct) || 0,
      marginPct: parseFloat(marginPct) || 0,
      items: items.filter((it) => it.quantity).map((it) => ({
        name: it.name, quantity: parseFloat(it.quantity), unit: it.unit, unitCost: parseFloat(it.unitCost) || 0,
      })),
    });
    if (r.ok) { setResult(r.result); if (r.result) onEstimate(r.result); } else { setErr(r.error || 'takeoff failed'); setResult(null); }
    setBusy(false);
  };

  return (
    <div className={card}>
      <header className={head}>
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-white">Material takeoff → estimate</span>
          {macroTag('materialTakeoff')}
        </div>
      </header>
      <div className="space-y-2 p-4">
        <input className={`${inp} w-full`} placeholder="Project name" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
        <div className="grid grid-cols-[1fr_70px_56px_70px_30px] gap-1.5 text-[9px] uppercase tracking-wider text-zinc-500">
          <span>Item</span><span>Qty</span><span>Unit</span><span>$/unit</span><span></span>
        </div>
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-[1fr_70px_56px_70px_30px] gap-1.5">
            <input className={inp} placeholder="2x4 stud" value={it.name} onChange={(e) => setItems((xs) => xs.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} />
            <input className={`${inp} font-mono`} type="number" placeholder="40" value={it.quantity} onChange={(e) => setItems((xs) => xs.map((x, idx) => idx === i ? { ...x, quantity: e.target.value } : x))} />
            <input className={inp} value={it.unit} onChange={(e) => setItems((xs) => xs.map((x, idx) => idx === i ? { ...x, unit: e.target.value } : x))} />
            <input className={`${inp} font-mono`} type="number" step="0.01" placeholder="4.50" value={it.unitCost} onChange={(e) => setItems((xs) => xs.map((x, idx) => idx === i ? { ...x, unitCost: e.target.value } : x))} />
            <button type="button" onClick={() => setItems((xs) => xs.filter((_, idx) => idx !== i))} className="rounded border border-zinc-800 text-zinc-500 hover:text-rose-300" aria-label="Remove item"><Trash2 className="mx-auto h-3 w-3" /></button>
          </div>
        ))}
        <button type="button" className={ghostBtn} onClick={() => setItems((xs) => [...xs, { name: '', quantity: '', unit: 'ea', unitCost: '' }])}><Plus className="h-3 w-3" />Add line item</button>
        <div className="grid grid-cols-4 gap-2">
          <label className="text-[10px] text-zinc-500">Labor hrs<input className={`${inp} mt-0.5 w-full font-mono`} type="number" value={laborHours} onChange={(e) => setLaborHours(e.target.value)} /></label>
          <label className="text-[10px] text-zinc-500">$ / hr<input className={`${inp} mt-0.5 w-full font-mono`} type="number" value={laborRate} onChange={(e) => setLaborRate(e.target.value)} /></label>
          <label className="text-[10px] text-zinc-500">Waste %<input className={`${inp} mt-0.5 w-full font-mono`} type="number" value={wastePct} onChange={(e) => setWastePct(e.target.value)} /></label>
          <label className="text-[10px] text-zinc-500">Margin %<input className={`${inp} mt-0.5 w-full font-mono`} type="number" value={marginPct} onChange={(e) => setMarginPct(e.target.value)} /></label>
        </div>
        <button type="button" className={`${btn} w-full justify-center`} disabled={busy || items.filter((it) => it.quantity).length === 0} onClick={compute}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Build estimate'}
        </button>
        {err && <div className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-200">{err}</div>}
        {result && (
          <div className="space-y-2 pt-1">
            <div className="rounded-lg border-2 border-emerald-500/40 bg-emerald-500/10 p-3 text-center">
              <div className="text-[10px] uppercase text-emerald-300">Estimate total</div>
              <div className="font-mono text-3xl text-emerald-100">${result.total.toLocaleString()}</div>
            </div>
            <ChartKit kind="bar" height={160} xKey="part" showLegend={false}
              data={[
                { part: 'Material', amount: result.materialWithWaste },
                { part: 'Labor', amount: result.laborCost },
                { part: 'Overhead', amount: result.overhead },
                { part: 'Margin', amount: result.margin },
              ]}
              series={[{ key: 'amount', label: 'USD', color: '#f59e0b' }]} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── 3. Crew + Schedule ───────────────────────── */

interface CrewMember { id: string; name: string; role: string; phone: string; hourlyRate: number; color: string }
interface ScheduleEntry {
  id: string; title: string; date: string; startTime: string; endTime: string;
  crewIds: string[]; crewNames: string[]; jobId: string; address: string; status: string; notes: string;
}

function CrewSchedule() {
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [sched, setSched] = useState<ScheduleEntry[]>([]);
  const [busy, setBusy] = useState(false);
  // crew form
  const [cName, setCName] = useState('');
  const [cRole, setCRole] = useState('Carpenter');
  const [cRate, setCRate] = useState('');
  // schedule form
  const [sTitle, setSTitle] = useState('');
  const [sDate, setSDate] = useState('');
  const [sStart, setSStart] = useState('08:00');
  const [sEnd, setSEnd] = useState('16:00');
  const [sCrew, setSCrew] = useState<string[]>([]);
  const [sAddress, setSAddress] = useState('');

  const reload = useCallback(async () => {
    const [c, s] = await Promise.all([
      run<{ members: CrewMember[] }>('crewList'),
      run<{ entries: ScheduleEntry[] }>('scheduleList'),
    ]);
    if (c.ok && c.result) setCrew(c.result.members);
    if (s.ok && s.result) setSched(s.result.entries);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, []);

  const addCrew = async () => {
    if (!cName.trim()) return;
    setBusy(true);
    await run('crewAdd', { name: cName, role: cRole, hourlyRate: parseFloat(cRate) || 0 });
    setCName(''); setCRate('');
    await reload(); setBusy(false);
  };
  const removeCrew = async (id: string) => { setBusy(true); await run('crewRemove', { id }); await reload(); setBusy(false); };
  const addSchedule = async () => {
    if (!sTitle.trim() || !sDate) return;
    setBusy(true);
    await run('scheduleAdd', { title: sTitle, date: sDate, startTime: sStart, endTime: sEnd, crewIds: sCrew, address: sAddress });
    setSTitle(''); setSAddress(''); setSCrew([]);
    await reload(); setBusy(false);
  };
  const cycleStatus = async (e: ScheduleEntry) => {
    const next = e.status === 'scheduled' ? 'dispatched' : e.status === 'dispatched' ? 'done' : 'scheduled';
    setBusy(true); await run('scheduleUpdate', { id: e.id, status: next }); await reload(); setBusy(false);
  };
  const removeSchedule = async (id: string) => { setBusy(true); await run('scheduleDelete', { id }); await reload(); setBusy(false); };

  const timelineEvents: TimelineEvent[] = sched.map((e) => ({
    id: e.id, label: e.title, time: `${e.date}T${e.startTime}`,
    tone: e.status === 'done' ? 'good' : e.status === 'dispatched' ? 'info' : 'default',
    detail: `${e.startTime}–${e.endTime}${e.crewNames.length ? ' · ' + e.crewNames.join(', ') : ''}`,
  }));

  return (
    <div className={card}>
      <header className={head}>
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-white">Crew dispatch calendar</span>
          {macroTag('scheduleList')}
        </div>
      </header>
      <div className="grid gap-3 p-4 md:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2 space-y-1.5">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><UserPlus className="h-3 w-3" />Crew roster</div>
            {crew.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded bg-zinc-900/60 px-2 py-1 text-[11px]">
                <span className="text-white">{m.name} <span className="text-zinc-500">· {m.role}</span></span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-emerald-300">${m.hourlyRate}/h</span>
                  <button onClick={() => removeCrew(m.id)} className="text-zinc-600 hover:text-rose-300" aria-label="Remove crew"><Trash2 className="h-3 w-3" /></button>
                </div>
              </div>
            ))}
            <input className={`${inp} w-full`} placeholder="Crew member name" value={cName} onChange={(e) => setCName(e.target.value)} />
            <div className="grid grid-cols-2 gap-1.5">
              <input className={inp} placeholder="Role" value={cRole} onChange={(e) => setCRole(e.target.value)} />
              <input className={`${inp} font-mono`} type="number" placeholder="$/hr" value={cRate} onChange={(e) => setCRate(e.target.value)} />
            </div>
            <button type="button" className={`${btn} w-full justify-center`} disabled={busy || !cName.trim()} onClick={addCrew}><Plus className="h-3 w-3" />Add crew</button>
          </div>
          <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Schedule a job</div>
            <input className={`${inp} w-full`} placeholder="Job title" value={sTitle} onChange={(e) => setSTitle(e.target.value)} />
            <input className={`${inp} w-full`} placeholder="Address" value={sAddress} onChange={(e) => setSAddress(e.target.value)} />
            <input className={`${inp} w-full font-mono`} type="date" value={sDate} onChange={(e) => setSDate(e.target.value)} />
            <div className="grid grid-cols-2 gap-1.5">
              <input className={`${inp} font-mono`} type="time" value={sStart} onChange={(e) => setSStart(e.target.value)} />
              <input className={`${inp} font-mono`} type="time" value={sEnd} onChange={(e) => setSEnd(e.target.value)} />
            </div>
            {crew.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {crew.map((m) => (
                  <button key={m.id} type="button"
                    onClick={() => setSCrew((cs) => cs.includes(m.id) ? cs.filter((x) => x !== m.id) : [...cs, m.id])}
                    className={`rounded px-1.5 py-0.5 text-[10px] ${sCrew.includes(m.id) ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}>
                    {m.name}
                  </button>
                ))}
              </div>
            )}
            <button type="button" className={`${btn} w-full justify-center`} disabled={busy || !sTitle.trim() || !sDate} onClick={addSchedule}><Plus className="h-3 w-3" />Add to calendar</button>
          </div>
        </div>
        <div className="space-y-2">
          {sched.length === 0
            ? <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-500">No jobs scheduled. Add one to populate the dispatch calendar.</div>
            : (
              <>
                <TimelineView events={timelineEvents} height={110} />
                <div className="space-y-1.5">
                  {sched.map((e) => (
                    <div key={e.id} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1.5">
                      <div>
                        <div className="text-[12px] text-white">{e.title}</div>
                        <div className="text-[10px] text-zinc-500">{e.date} · {e.startTime}–{e.endTime}{e.address ? ` · ${e.address}` : ''}{e.crewNames.length ? ` · ${e.crewNames.join(', ')}` : ''}</div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => cycleStatus(e)}
                          className={`rounded px-2 py-0.5 text-[10px] font-semibold ${e.status === 'done' ? 'bg-emerald-500/20 text-emerald-200' : e.status === 'dispatched' ? 'bg-indigo-500/20 text-indigo-200' : 'bg-zinc-700 text-zinc-300'}`}>
                          {e.status}
                        </button>
                        <button onClick={() => removeSchedule(e.id)} className="text-zinc-600 hover:text-rose-300" aria-label="Delete schedule"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── 4. Time Tracking ───────────────────────── */

interface TimeEntry { id: string; jobId: string; jobName: string; hours: number; rate: number; cost: number; source: string }
interface RunningTimer { jobId: string; jobName: string; elapsedHours: number; startedAt: string }
interface ByJob { jobId: string; jobName: string; hours: number; cost: number }
interface TimeListResult { entries: TimeEntry[]; running: RunningTimer[]; totalHours: number; totalCost: number; byJob: ByJob[] }

function TimeTracking() {
  const [data, setData] = useState<TimeListResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState('');
  const [jobName, setJobName] = useState('');
  const [rate, setRate] = useState('65');
  const [manualHours, setManualHours] = useState('');

  const reload = useCallback(async () => {
    const r = await run<TimeListResult>('timeEntryList');
    if (r.ok && r.result) setData(r.result);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); const t = setInterval(reload, 30000); return () => clearInterval(t); }, []);

  const startTimer = async () => {
    if (!jobId.trim()) return;
    setBusy(true);
    await run('timerStart', { jobId, jobName: jobName || jobId, rate: parseFloat(rate) || 0 });
    await reload(); setBusy(false);
  };
  const stopTimer = async (jid: string) => { setBusy(true); await run('timerStop', { jobId: jid }); await reload(); setBusy(false); };
  const addManual = async () => {
    if (!jobId.trim() || !manualHours) return;
    setBusy(true);
    await run('timeEntryAdd', { jobId, jobName: jobName || jobId, hours: parseFloat(manualHours), rate: parseFloat(rate) || 0 });
    setManualHours('');
    await reload(); setBusy(false);
  };
  const removeEntry = async (id: string) => { setBusy(true); await run('timeEntryDelete', { id }); await reload(); setBusy(false); };

  return (
    <div className={card}>
      <header className={head}>
        <div className="flex items-center gap-2">
          <Timer className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-white">Job time tracking</span>
          {macroTag('timeEntryList')}
        </div>
        {data && (
          <div className="flex gap-3 text-[11px]">
            <span className="text-zinc-400">{data.totalHours}h logged</span>
            <span className="font-mono text-emerald-300">${data.totalCost.toLocaleString()}</span>
          </div>
        )}
      </header>
      <div className="space-y-2 p-4">
        <div className="grid grid-cols-[1fr_1fr_70px] gap-1.5">
          <input className={inp} placeholder="Job ID" value={jobId} onChange={(e) => setJobId(e.target.value)} />
          <input className={inp} placeholder="Job name" value={jobName} onChange={(e) => setJobName(e.target.value)} />
          <input className={`${inp} font-mono`} type="number" placeholder="$/h" value={rate} onChange={(e) => setRate(e.target.value)} />
        </div>
        <div className="flex gap-1.5">
          <button type="button" className={`${btn} flex-1 justify-center`} disabled={busy || !jobId.trim()} onClick={startTimer}><Play className="h-3 w-3" />Start timer</button>
          <input className={`${inp} w-20 font-mono`} type="number" step="0.25" placeholder="hrs" value={manualHours} onChange={(e) => setManualHours(e.target.value)} />
          <button type="button" className={ghostBtn} disabled={busy || !jobId.trim() || !manualHours} onClick={addManual}><Plus className="h-3 w-3" />Log hrs</button>
        </div>
        {data && data.running.length > 0 && (
          <div className="space-y-1">
            {data.running.map((t) => (
              <div key={t.jobId} className="flex items-center justify-between rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5">
                <span className="flex items-center gap-1.5 text-[12px] text-emerald-100"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />{t.jobName} · {t.elapsedHours}h</span>
                <button onClick={() => stopTimer(t.jobId)} className="rounded bg-rose-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-rose-500"><Square className="mr-0.5 inline h-2.5 w-2.5" />Stop</button>
              </div>
            ))}
          </div>
        )}
        {data && data.byJob.length > 0 && (
          <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Labor cost by job</div>
            {data.byJob.map((j) => (
              <div key={j.jobId} className="flex items-center justify-between py-0.5 text-[11px]">
                <span className="text-zinc-300">{j.jobName}</span>
                <span className="font-mono"><span className="text-amber-200">{j.hours}h</span> <span className="text-emerald-300">${j.cost}</span></span>
              </div>
            ))}
          </div>
        )}
        {data && data.entries.length > 0 && (
          <div className="space-y-1">
            {data.entries.map((e) => (
              <div key={e.id} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1 text-[11px]">
                <span className="text-zinc-300">{e.jobName} <span className="text-zinc-600">· {e.source}</span></span>
                <div className="flex items-center gap-2">
                  <span className="font-mono"><span className="text-amber-200">{e.hours}h</span> <span className="text-emerald-300">${e.cost}</span></span>
                  <button onClick={() => removeEntry(e.id)} className="text-zinc-600 hover:text-rose-300" aria-label="Delete entry"><Trash2 className="h-3 w-3" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── 5. Photo Job Log ───────────────────────── */

interface PhotoEntry { id: string; jobId: string; jobName: string; imageUrl: string; phase: string; caption: string; takenAt: string }

function PhotoJobLog() {
  const [entries, setEntries] = useState<PhotoEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState('');
  const [jobName, setJobName] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [phase, setPhase] = useState<'before' | 'during' | 'after'>('before');
  const [caption, setCaption] = useState('');

  const reload = useCallback(async () => {
    const r = await run<{ entries: PhotoEntry[] }>('photoLogList');
    if (r.ok && r.result) setEntries(r.result.entries);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, []);

  const add = async () => {
    if (!jobId.trim() || !imageUrl.trim()) return;
    setBusy(true);
    await run('photoLogAdd', { jobId, jobName: jobName || jobId, imageUrl, phase, caption });
    setImageUrl(''); setCaption('');
    await reload(); setBusy(false);
  };
  const remove = async (id: string) => { setBusy(true); await run('photoLogDelete', { id }); await reload(); setBusy(false); };

  return (
    <div className={card}>
      <header className={head}>
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-white">Photo job log</span>
          {macroTag('photoLogList')}
        </div>
      </header>
      <div className="space-y-2 p-4">
        <div className="grid grid-cols-2 gap-1.5">
          <input className={inp} placeholder="Job ID" value={jobId} onChange={(e) => setJobId(e.target.value)} />
          <input className={inp} placeholder="Job name" value={jobName} onChange={(e) => setJobName(e.target.value)} />
        </div>
        <input className={`${inp} w-full`} placeholder="Image URL (https://...)" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
        <div className="grid grid-cols-[110px_1fr] gap-1.5">
          <select className={inp} value={phase} onChange={(e) => setPhase(e.target.value as typeof phase)}>
            <option value="before">Before</option><option value="during">During</option><option value="after">After</option>
          </select>
          <input className={inp} placeholder="Caption" value={caption} onChange={(e) => setCaption(e.target.value)} />
        </div>
        <button type="button" className={`${btn} w-full justify-center`} disabled={busy || !jobId.trim() || !imageUrl.trim()} onClick={add}><Plus className="h-3 w-3" />Add photo</button>
        {entries.length === 0
          ? <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-500">No job photos yet.</div>
          : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {entries.map((e) => (
                <div key={e.id} className="overflow-hidden rounded border border-zinc-800 bg-zinc-950/40">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={e.imageUrl} alt={e.caption || e.jobName} className="h-24 w-full object-cover" onError={(ev) => { (ev.target as HTMLImageElement).style.opacity = '0.2'; }} />
                  <div className="p-1.5">
                    <div className="flex items-center justify-between">
                      <span className={`rounded px-1.5 py-0.5 text-[9px] uppercase ${e.phase === 'before' ? 'bg-zinc-700 text-zinc-200' : e.phase === 'after' ? 'bg-emerald-500/20 text-emerald-200' : 'bg-amber-500/20 text-amber-200'}`}>{e.phase}</span>
                      <button onClick={() => remove(e.id)} className="text-zinc-600 hover:text-rose-300" aria-label="Delete photo"><Trash2 className="h-3 w-3" /></button>
                    </div>
                    <div className="mt-1 truncate text-[10px] text-zinc-400">{e.jobName}</div>
                    {e.caption && <div className="truncate text-[10px] text-zinc-500">{e.caption}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

/* ───────────────────────── 6. Invoicing + Client Portal ───────────────────────── */

interface Invoice { id: string; invoiceNumber: string; estimateId: string; client: string; subtotal: number; tax: number; total: number; status: string; signature: { signedBy: string; decision: string } | null }
interface InvoiceListResult { invoices: Invoice[]; outstanding: number; collected: number }
interface PortalShare { token: string; client: string; estimateId: string; estimateAmount: number; jobName: string; progressPct: number; status: string; clientDecision: { decision: string; signedBy: string } | null; milestones: { label: string; done: boolean }[] }

function InvoicingPortal({ estimate }: { estimate: TakeoffResult | null }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [totals, setTotals] = useState<{ outstanding: number; collected: number }>({ outstanding: 0, collected: 0 });
  const [portals, setPortals] = useState<PortalShare[]>([]);
  const [busy, setBusy] = useState(false);
  // conversion form
  const [estimateId, setEstimateId] = useState('');
  const [client, setClient] = useState('');
  const [amount, setAmount] = useState('');
  const [taxPct, setTaxPct] = useState('0');
  const [depositPct, setDepositPct] = useState('0');
  // signature form
  const [signName, setSignName] = useState('');
  // portal form
  const [pClient, setPClient] = useState('');
  const [pJobName, setPJobName] = useState('');
  const [pProgress, setPProgress] = useState('0');

  const reload = useCallback(async () => {
    const [inv, prt] = await Promise.all([
      run<InvoiceListResult>('invoiceList'),
      run<{ shares: PortalShare[] }>('portalList'),
    ]);
    if (inv.ok && inv.result) { setInvoices(inv.result.invoices); setTotals({ outstanding: inv.result.outstanding, collected: inv.result.collected }); }
    if (prt.ok && prt.result) setPortals(prt.result.shares);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, []);

  useEffect(() => {
    if (estimate) {
      setAmount(String(estimate.total));
      setClient((c) => c || estimate.projectName);
      setEstimateId((e) => e || `est_${estimate.projectName.toLowerCase().replace(/\s+/g, '-').slice(0, 24)}`);
    }
  }, [estimate]);

  const sign = async () => {
    if (!estimateId.trim() || !signName.trim()) return;
    setBusy(true);
    await run('signEstimate', { estimateId, signedBy: signName, accepted: true });
    await reload(); setBusy(false);
  };
  const convert = async () => {
    if (!estimateId.trim() || !amount) return;
    setBusy(true);
    await run('estimateToInvoice', {
      estimateId, client: client || 'Client', amount: parseFloat(amount),
      taxPct: parseFloat(taxPct) || 0, depositPct: parseFloat(depositPct) || 0,
    });
    await reload(); setBusy(false);
  };
  const markPaid = async (id: string) => { setBusy(true); await run('invoiceMarkPaid', { id }); await reload(); setBusy(false); };
  const createPortal = async () => {
    if (!pClient.trim()) return;
    setBusy(true);
    await run('portalCreate', {
      client: pClient, jobName: pJobName, estimateId, estimateAmount: parseFloat(amount) || 0,
      progressPct: parseFloat(pProgress) || 0,
    });
    setPClient(''); setPJobName('');
    await reload(); setBusy(false);
  };
  const bumpProgress = async (token: string, pct: number) => {
    setBusy(true); await run('portalUpdateProgress', { token, progressPct: pct }); await reload(); setBusy(false);
  };

  return (
    <div className={card}>
      <header className={head}>
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-white">Invoicing &amp; client portal</span>
          {macroTag('estimateToInvoice')}
        </div>
        <div className="flex gap-3 text-[11px]">
          <span className="text-amber-300">${totals.outstanding.toLocaleString()} due</span>
          <span className="text-emerald-300">${totals.collected.toLocaleString()} paid</span>
        </div>
      </header>
      <div className="grid gap-3 p-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Estimate → invoice</div>
            <div className="grid grid-cols-2 gap-1.5">
              <input className={inp} placeholder="Estimate ID" value={estimateId} onChange={(e) => setEstimateId(e.target.value)} />
              <input className={inp} placeholder="Client" value={client} onChange={(e) => setClient(e.target.value)} />
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <input className={`${inp} font-mono`} type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <input className={`${inp} font-mono`} type="number" placeholder="Tax %" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} />
              <input className={`${inp} font-mono`} type="number" placeholder="Dep %" value={depositPct} onChange={(e) => setDepositPct(e.target.value)} />
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-1.5">
              <input className={inp} placeholder="Sign-off name" value={signName} onChange={(e) => setSignName(e.target.value)} />
              <button type="button" className={ghostBtn} disabled={busy || !estimateId.trim() || !signName.trim()} onClick={sign}><FileSignature className="h-3 w-3" />Sign quote</button>
            </div>
            <button type="button" className={`${btn} w-full justify-center`} disabled={busy || !estimateId.trim() || !amount} onClick={convert}><Receipt className="h-3 w-3" />Convert to invoice</button>
          </div>
          {invoices.length > 0 && (
            <div className="space-y-1">
              {invoices.map((iv) => (
                <div key={iv.id} className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-white">{iv.invoiceNumber} · {iv.client}</span>
                    <span className="font-mono text-[12px] text-emerald-300">${iv.total.toLocaleString()}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-[10px]">
                    <span className="text-zinc-500">
                      {iv.signature ? <span className="text-emerald-400"><Check className="mr-0.5 inline h-2.5 w-2.5" />signed by {iv.signature.signedBy}</span> : 'unsigned'}
                    </span>
                    {iv.status === 'paid'
                      ? <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-200">paid</span>
                      : <button onClick={() => markPaid(iv.id)} className="rounded bg-amber-600 px-1.5 py-0.5 text-white hover:bg-amber-500">Mark paid</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-2">
          <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2 space-y-1.5">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><Link2 className="h-3 w-3" />Client portal</div>
            <div className="grid grid-cols-2 gap-1.5">
              <input className={inp} placeholder="Client name" value={pClient} onChange={(e) => setPClient(e.target.value)} />
              <input className={inp} placeholder="Job name" value={pJobName} onChange={(e) => setPJobName(e.target.value)} />
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-1.5">
              <input className={`${inp} font-mono`} type="number" placeholder="Progress %" value={pProgress} onChange={(e) => setPProgress(e.target.value)} />
              <button type="button" className={btn} disabled={busy || !pClient.trim()} onClick={createPortal}><Plus className="h-3 w-3" />Share portal</button>
            </div>
          </div>
          {portals.length === 0
            ? <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-500">No client portals yet.</div>
            : portals.map((p) => (
              <div key={p.token} className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-white">{p.client}{p.jobName ? ` · ${p.jobName}` : ''}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${p.status === 'approved' ? 'bg-emerald-500/20 text-emerald-200' : p.status === 'declined' ? 'bg-rose-500/20 text-rose-200' : 'bg-zinc-700 text-zinc-300'}`}>{p.status}</span>
                </div>
                <div className="mt-1 font-mono text-[10px] text-zinc-500">{p.token}</div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full bg-amber-500" style={{ width: `${p.progressPct}%` }} />
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-[10px] text-zinc-500">{p.progressPct}% complete</span>
                  <div className="flex gap-1">
                    {[25, 50, 75, 100].map((v) => (
                      <button key={v} onClick={() => bumpProgress(p.token, v)} disabled={busy}
                        className={`rounded px-1 py-0.5 text-[9px] ${p.progressPct >= v ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}>{v}%</button>
                    ))}
                  </div>
                </div>
                {p.clientDecision && (
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-emerald-300">
                    {p.clientDecision.decision === 'approved' ? <Check className="h-3 w-3" /> : <X className="h-3 w-3 text-rose-300" />}
                    {p.clientDecision.decision} by {p.clientDecision.signedBy}
                  </div>
                )}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Suite shell ───────────────────────── */

const SUB_TABS = [
  { id: 'cutlist', label: 'Cut list', icon: Scissors },
  { id: 'takeoff', label: 'Takeoff', icon: ClipboardList },
  { id: 'schedule', label: 'Dispatch', icon: CalendarClock },
  { id: 'time', label: 'Time', icon: Timer },
  { id: 'photos', label: 'Photos', icon: Camera },
  { id: 'invoicing', label: 'Invoicing', icon: Receipt },
] as const;
type SubTab = typeof SUB_TABS[number]['id'];

export function JobOps() {
  const [tab, setTab] = useState<SubTab>('cutlist');
  const [estimate, setEstimate] = useState<TakeoffResult | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <PenLine className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Trade job management</h3>
        <span className="text-[11px] text-zinc-500">cut lists · takeoffs · dispatch · time · photos · invoicing</span>
      </div>
      <nav className="flex flex-wrap gap-1.5">
        {SUB_TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors ${tab === t.id ? 'bg-amber-600/20 text-amber-300' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}>
            <t.icon className="h-3.5 w-3.5" />{t.label}
          </button>
        ))}
      </nav>
      {tab === 'cutlist' && <CutListOptimizer />}
      {tab === 'takeoff' && <MaterialTakeoff onEstimate={setEstimate} />}
      {tab === 'schedule' && <CrewSchedule />}
      {tab === 'time' && <TimeTracking />}
      {tab === 'photos' && <PhotoJobLog />}
      {tab === 'invoicing' && <InvoicingPortal estimate={estimate} />}
    </div>
  );
}
