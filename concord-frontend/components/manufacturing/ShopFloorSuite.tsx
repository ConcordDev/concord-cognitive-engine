/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

/**
 * ShopFloorSuite — full shop-floor execution layer for the manufacturing lens.
 * Wires the 8 MES parity features (work instructions, IoT, finite-capacity
 * scheduling, lot traceability, andon, NCR/CAPA, preventive maintenance,
 * WIP inventory) end-to-end against server/domains/manufacturing.js macros.
 * Every value rendered comes from a real macro call — no seed/mock data.
 */

import { useState, useCallback, useEffect } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import {
  ClipboardCheck, Cpu, CalendarRange, GitBranch, Siren, AlertOctagon,
  Wrench, Boxes, Plus, RefreshCw, CheckCircle2, X, ChevronRight,
} from 'lucide-react';

type SuiteTab =
  | 'instructions' | 'iot' | 'scheduling' | 'traceability'
  | 'andon' | 'ncr' | 'maintenance' | 'inventory';

const SUITE_TABS: { id: SuiteTab; label: string; icon: typeof Cpu }[] = [
  { id: 'instructions', label: 'Work Instructions', icon: ClipboardCheck },
  { id: 'iot', label: 'Machine / IoT', icon: Cpu },
  { id: 'scheduling', label: 'Gantt Schedule', icon: CalendarRange },
  { id: 'traceability', label: 'Lot Traceability', icon: GitBranch },
  { id: 'andon', label: 'Andon', icon: Siren },
  { id: 'ncr', label: 'NCR / CAPA', icon: AlertOctagon },
  { id: 'maintenance', label: 'Maintenance', icon: Wrench },
  { id: 'inventory', label: 'WIP Inventory', icon: Boxes },
];

const card = 'rounded-xl border border-zinc-800 bg-zinc-950/50 p-4';
const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors';
const btnPrimary = `${btn} bg-amber-600 hover:bg-amber-500 text-white`;
const btnGhost = `${btn} border border-zinc-700 text-zinc-300 hover:bg-zinc-800`;
const input = 'w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none';
const label = 'mb-1 block text-xs font-medium text-zinc-400';

function Field({ name, value, onChange, type = 'text', placeholder }: {
  name: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className={label}>{name}</label>
      <input
        className={input}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

async function run<T = any>(action: string, params: Record<string, unknown> = {}) {
  const r = await lensRun<T>('manufacturing', action, params);
  return r.data;
}

// ─── Feature 1: Digital work instructions ─────────────────────────────────
function WorkInstructionsTab() {
  const [sets, setSets] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState('');
  const [product, setProduct] = useState('');
  const [stepText, setStepText] = useState('');
  const [steps, setSteps] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const d = await run<{ instructionSets: any[] }>('work-instructions-list');
    if (d.ok && d.result) setSets(d.result.instructionSets || []);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const create = async () => {
    setErr(''); setBusy(true);
    const d = await run('work-instruction-create', {
      title, product: product || null,
      steps: steps.map((instruction, i) => ({ instruction, checkpoint: i === steps.length - 1 })),
    });
    setBusy(false);
    if (!d.ok) { setErr(d.error || 'failed'); return; }
    setTitle(''); setProduct(''); setSteps([]); setShowNew(false);
    load();
  };

  const completeStep = async (instructionSetId: string, stepIndex: number, completed: boolean) => {
    const d = await run('work-instruction-step-complete', { instructionSetId, stepIndex, completed });
    if (d.ok) load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">Digital Work Instructions</h3>
        <div className="flex gap-2">
          <button className={btnGhost} onClick={load}><RefreshCw className="h-4 w-4" /> Refresh</button>
          <button className={btnPrimary} onClick={() => setShowNew(!showNew)}>
            <Plus className="h-4 w-4" /> New Set
          </button>
        </div>
      </div>

      {showNew && (
        <div className={card}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field name="Title" value={title} onChange={setTitle} placeholder="Assembly of HA-400" />
            <Field name="Product (optional)" value={product} onChange={setProduct} placeholder="HA-400" />
          </div>
          <div className="mt-3">
            <label className={label}>Add step</label>
            <div className="flex gap-2">
              <input
                className={input}
                value={stepText}
                placeholder="Torque bolts to 40 Nm"
                onChange={(e) => setStepText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && stepText.trim()) { setSteps([...steps, stepText.trim()]); setStepText(''); }
                }}
              />
              <button
                className={btnGhost}
                onClick={() => { if (stepText.trim()) { setSteps([...steps, stepText.trim()]); setStepText(''); } }}
              >Add</button>
            </div>
          </div>
          {steps.length > 0 && (
            <ol className="mt-3 space-y-1 text-sm text-zinc-300">
              {steps.map((s, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="text-amber-500">{i + 1}.</span> {s}
                  <button className="ml-auto text-zinc-600 hover:text-rose-400" onClick={() => setSteps(steps.filter((_, j) => j !== i))} aria-label="Remove">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ol>
          )}
          {err && <p className="mt-2 text-xs text-rose-400">{err}</p>}
          <div className="mt-3 flex gap-2">
            <button className={btnPrimary} disabled={busy || !title.trim() || steps.length === 0} onClick={create}>
              {busy ? 'Saving…' : 'Create instruction set'}
            </button>
            <button className={btnGhost} onClick={() => setShowNew(false)}>Cancel</button>
          </div>
        </div>
      )}

      {sets.length === 0 ? (
        <p className="text-sm text-zinc-500">No work instruction sets yet. Create one to guide operators step-by-step.</p>
      ) : (
        sets.map((set) => {
          const done = set.steps.filter((s: any) => s.completed).length;
          const pct = Math.round((done / set.steps.length) * 100);
          return (
            <div key={set.id} className={card}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-zinc-100">{set.title}</p>
                  <p className="text-xs text-zinc-500">Rev {set.revision} · {set.product || 'no product'}</p>
                </div>
                <span className="text-sm font-mono text-amber-400">{pct}%</span>
              </div>
              <div className="my-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full rounded-full bg-amber-500" style={{ width: `${pct}%` }} />
              </div>
              <ol className="space-y-1.5">
                {set.steps.map((st: any) => (
                  <li key={st.index} className="flex items-center gap-2 text-sm">
                    <button
                      onClick={() => completeStep(set.id, st.index, !st.completed)}
                      className={st.completed ? 'text-emerald-400' : 'text-zinc-600 hover:text-amber-400'}
                      aria-label="Toggle step"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </button>
                    <span className={st.completed ? 'text-zinc-500 line-through' : 'text-zinc-300'}>
                      {st.index}. {st.instruction}
                    </span>
                    {st.checkpoint && <span className="rounded bg-indigo-950 px-1.5 py-0.5 text-[10px] text-indigo-300">QC</span>}
                  </li>
                ))}
              </ol>
            </div>
          );
        })
      )}
    </div>
  );
}

// ─── Feature 2: Machine / IoT data integration ────────────────────────────
function IoTTab() {
  const [machineId, setMachineId] = useState('CNC-01');
  const [state, setState] = useState<any>(null);
  const [err, setErr] = useState('');
  const [ingest, setIngest] = useState({ machineState: 'running', cycleCount: '', spindleLoad: '', temperature: '', downtimeReason: '' });

  const fetchState = useCallback(async (id: string) => {
    setErr('');
    const d = await run('iot-machine-state', { machineId: id });
    if (!d.ok) { setErr(d.error || 'failed'); setState(null); return; }
    setState(d.result);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchState('CNC-01'); }, []);

  const doIngest = async () => {
    setErr('');
    const d = await run('iot-reading-ingest', {
      machineId,
      machineState: ingest.machineState,
      cycleCount: ingest.cycleCount ? Number(ingest.cycleCount) : 0,
      spindleLoad: ingest.spindleLoad ? Number(ingest.spindleLoad) : null,
      temperature: ingest.temperature ? Number(ingest.temperature) : null,
      downtimeReason: ingest.downtimeReason || null,
    });
    if (!d.ok) { setErr(d.error || 'failed'); return; }
    setIngest({ ...ingest, cycleCount: '', downtimeReason: '' });
    fetchState(machineId);
  };

  const chartData = (state?.readings || []).map((r: any, i: number) => ({
    idx: i + 1,
    cycles: r.cycleCount,
    spindle: r.spindleLoad ?? 0,
    temp: r.temperature ?? 0,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div className="flex-1"><Field name="Machine ID" value={machineId} onChange={setMachineId} /></div>
        <button className={btnGhost} onClick={() => fetchState(machineId)}><RefreshCw className="h-4 w-4" /> Load</button>
      </div>

      <div className={card}>
        <p className="mb-2 text-xs font-medium text-zinc-400">Ingest live machine reading (OPC-UA / MQTT Sparkplug B bridge)</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={label}>Machine state</label>
            <select className={input} value={ingest.machineState} onChange={(e) => setIngest({ ...ingest, machineState: e.target.value })}>
              <option value="running">running</option>
              <option value="idle">idle</option>
              <option value="down">down</option>
              <option value="setup">setup</option>
            </select>
          </div>
          <Field name="Cycle count" type="number" value={ingest.cycleCount} onChange={(v) => setIngest({ ...ingest, cycleCount: v })} />
          <Field name="Spindle load %" type="number" value={ingest.spindleLoad} onChange={(v) => setIngest({ ...ingest, spindleLoad: v })} />
          <Field name="Temperature °C" type="number" value={ingest.temperature} onChange={(v) => setIngest({ ...ingest, temperature: v })} />
          <Field name="Downtime reason" value={ingest.downtimeReason} onChange={(v) => setIngest({ ...ingest, downtimeReason: v })} placeholder="tool change" />
          <div className="flex items-end">
            <button className={btnPrimary} onClick={doIngest}><Plus className="h-4 w-4" /> Ingest reading</button>
          </div>
        </div>
      </div>

      {err && <p className="text-xs text-rose-400">{err}</p>}

      {state && state.source === 'empty' ? (
        <p className="text-sm text-zinc-500">{state.notes}</p>
      ) : state && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              { k: 'State', v: state.currentState },
              { k: 'Uptime', v: `${state.uptimePct}%` },
              { k: 'Latest cycles', v: state.latestCycleCount },
              { k: 'Cycles in window', v: state.cyclesInWindow },
            ].map((m) => (
              <div key={m.k} className={card}>
                <p className="text-xs text-zinc-500">{m.k}</p>
                <p className="text-lg font-bold text-zinc-100">{m.v}</p>
              </div>
            ))}
          </div>
          {chartData.length > 1 && (
            <div className={card}>
              <p className="mb-2 text-xs font-medium text-zinc-400">Spindle load + temperature trend</p>
              <ChartKit
                kind="line" data={chartData} xKey="idx"
                series={[{ key: 'spindle', label: 'Spindle %' }, { key: 'temp', label: 'Temp °C' }]}
                height={200}
              />
            </div>
          )}
          {state.downtimeReasons?.length > 0 && (
            <div className={card}>
              <p className="mb-2 text-xs font-medium text-zinc-400">Downtime reasons (Pareto)</p>
              <ChartKit
                kind="bar"
                data={state.downtimeReasons.map((d: any) => ({ reason: d.reason, count: d.count }))}
                xKey="reason" series={[{ key: 'count', label: 'Occurrences' }]} height={180}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Feature 3: Production scheduling Gantt ───────────────────────────────
function SchedulingTab() {
  const [gantt, setGantt] = useState<any>(null);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ name: '', resource: 'Line A', durationHours: '', priority: '3', dueDate: '' });

  const load = useCallback(async () => {
    const d = await run('schedule-gantt');
    if (d.ok) setGantt(d.result);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const addJob = async () => {
    setErr('');
    const d = await run('schedule-job-add', {
      name: form.name, resource: form.resource,
      durationHours: Number(form.durationHours),
      priority: Number(form.priority), dueDate: form.dueDate || null,
    });
    if (!d.ok) { setErr(d.error || 'failed'); return; }
    setForm({ ...form, name: '', durationHours: '', dueDate: '' });
    load();
  };

  const reschedule = async (jobId: string, resource: string) => {
    const d = await run('schedule-job-reschedule', { jobId, resource });
    if (d.ok) load();
  };

  const jobs: any[] = gantt?.jobs || [];
  const resources: string[] = gantt?.resources || [];
  const minStart = jobs.length ? Math.min(...jobs.map((j) => Date.parse(j.startAt))) : 0;
  const maxEnd = jobs.length ? Math.max(...jobs.map((j) => Date.parse(j.endAt))) : 1;
  const span = Math.max(1, maxEnd - minStart);

  return (
    <div className="space-y-4">
      <div className={card}>
        <p className="mb-2 text-xs font-medium text-zinc-400">Add job to finite-capacity schedule</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="Job / product" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="WO-0301 Pump body" />
          <div>
            <label className={label}>Resource</label>
            <select className={input} value={form.resource} onChange={(e) => setForm({ ...form, resource: e.target.value })}>
              {['Line A', 'Line B', 'Line C', 'CNC Cell', 'Weld Bay'].map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <Field name="Duration (hours)" type="number" value={form.durationHours} onChange={(v) => setForm({ ...form, durationHours: v })} />
          <div>
            <label className={label}>Priority (1=high)</label>
            <select className={input} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {[1, 2, 3, 4, 5].map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <Field name="Due date" type="date" value={form.dueDate} onChange={(v) => setForm({ ...form, dueDate: v })} />
          <div className="flex items-end">
            <button className={btnPrimary} disabled={!form.name.trim() || !(Number(form.durationHours) > 0)} onClick={addJob}>
              <Plus className="h-4 w-4" /> Add job
            </button>
          </div>
        </div>
        {err && <p className="mt-2 text-xs text-rose-400">{err}</p>}
      </div>

      {jobs.length === 0 ? (
        <p className="text-sm text-zinc-500">No scheduled jobs. Add a job to see the finite-capacity Gantt.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className={card}><p className="text-xs text-zinc-500">Jobs</p><p className="text-lg font-bold text-zinc-100">{jobs.length}</p></div>
            <div className={card}><p className="text-xs text-zinc-500">Resources</p><p className="text-lg font-bold text-zinc-100">{resources.length}</p></div>
            <div className={card}><p className="text-xs text-zinc-500">Late jobs</p><p className={`text-lg font-bold ${gantt.lateJobs > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{gantt.lateJobs}</p></div>
          </div>
          <div className={card}>
            <p className="mb-3 text-xs font-medium text-zinc-400">Gantt — drag-free reschedule via resource dropdown</p>
            <div className="space-y-2">
              {resources.map((res) => (
                <div key={res} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 truncate text-xs text-zinc-400">{res}</span>
                  <div className="relative h-8 flex-1 rounded bg-zinc-900">
                    {(gantt.byResource[res] || []).map((j: any) => {
                      const left = ((Date.parse(j.startAt) - minStart) / span) * 100;
                      const width = ((Date.parse(j.endAt) - Date.parse(j.startAt)) / span) * 100;
                      return (
                        <div
                          key={j.id}
                          className={`absolute top-0.5 flex h-7 items-center overflow-hidden rounded px-1.5 text-[10px] text-white ${j.late ? 'bg-rose-600' : 'bg-amber-600'}`}
                          style={{ left: `${left}%`, width: `${Math.max(width, 4)}%` }}
                          title={`${j.name} · ${j.durationHours}h${j.late ? ` · ${j.lateHours}h late` : ''}`}
                        >
                          {j.name}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className={card}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                  <th className="pb-2">Job</th><th className="pb-2">Resource</th><th className="pb-2">Start</th>
                  <th className="pb-2">End</th><th className="pb-2">Status</th><th className="pb-2">Move</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className="border-b border-zinc-800/50">
                    <td className="py-1.5 text-zinc-200">{j.name}</td>
                    <td className="py-1.5 text-zinc-400">{j.resource}</td>
                    <td className="py-1.5 text-zinc-500">{new Date(j.startAt).toLocaleString()}</td>
                    <td className="py-1.5 text-zinc-500">{new Date(j.endAt).toLocaleString()}</td>
                    <td className="py-1.5">
                      {j.late
                        ? <span className="text-rose-400">{j.lateHours}h late</span>
                        : <span className="text-emerald-400">on time</span>}
                    </td>
                    <td className="py-1.5">
                      <select
                        className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-200"
                        value={j.resource}
                        onChange={(e) => reschedule(j.id, e.target.value)}
                      >
                        {['Line A', 'Line B', 'Line C', 'CNC Cell', 'Weld Bay'].map((r) => <option key={r}>{r}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Feature 4: Material traceability ─────────────────────────────────────
interface GenNode { lotNumber: string; material: string; kind: string; children?: GenNode[] }

function GenealogyTree({ nodes, depth = 0 }: { nodes: GenNode[]; depth?: number }) {
  return (
    <div>
      {nodes.map((n) => (
        <div key={n.lotNumber + depth} style={{ paddingLeft: depth * 16 }}>
          <div className="flex items-center gap-1.5 py-0.5 text-sm">
            <ChevronRight className="h-3 w-3 text-zinc-600" />
            <span className="font-mono text-amber-400">{n.lotNumber}</span>
            <span className="text-zinc-400">{n.material}</span>
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{n.kind}</span>
          </div>
          {n.children && n.children.length > 0 && <GenealogyTree nodes={n.children} depth={depth + 1} />}
        </div>
      ))}
    </div>
  );
}

function TraceabilityTab() {
  const [lots, setLots] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ lotNumber: '', material: '', kind: 'raw_material', quantity: '', supplier: '', parentLots: '' });
  const [genealogy, setGenealogy] = useState<any>(null);

  const load = useCallback(async () => {
    const d = await run<{ lots: any[] }>('lots-list');
    if (d.ok && d.result) setLots(d.result.lots || []);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const register = async () => {
    setErr('');
    const d = await run('lot-register', {
      lotNumber: form.lotNumber, material: form.material, kind: form.kind,
      quantity: form.quantity ? Number(form.quantity) : 0,
      supplier: form.supplier || null,
      parentLots: form.parentLots ? form.parentLots.split(',').map((x) => x.trim()).filter(Boolean) : [],
    });
    if (!d.ok) { setErr(d.error || 'failed'); return; }
    setForm({ lotNumber: '', material: '', kind: 'raw_material', quantity: '', supplier: '', parentLots: '' });
    load();
  };

  const trace = async (lotNumber: string) => {
    const d = await run('lot-genealogy', { lotNumber });
    if (d.ok) setGenealogy(d.result);
  };

  return (
    <div className="space-y-4">
      <div className={card}>
        <p className="mb-2 text-xs font-medium text-zinc-400">Register lot (raw material → WIP → finished good)</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="Lot number" value={form.lotNumber} onChange={(v) => setForm({ ...form, lotNumber: v })} placeholder="LOT-A1024" />
          <Field name="Material" value={form.material} onChange={(v) => setForm({ ...form, material: v })} placeholder="6061-T6 Aluminium" />
          <div>
            <label className={label}>Kind</label>
            <select className={input} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="raw_material">raw_material</option>
              <option value="wip">wip</option>
              <option value="finished_good">finished_good</option>
            </select>
          </div>
          <Field name="Quantity" type="number" value={form.quantity} onChange={(v) => setForm({ ...form, quantity: v })} />
          <Field name="Supplier" value={form.supplier} onChange={(v) => setForm({ ...form, supplier: v })} />
          <Field name="Parent lots (comma-sep)" value={form.parentLots} onChange={(v) => setForm({ ...form, parentLots: v })} placeholder="LOT-R001, LOT-R002" />
        </div>
        {err && <p className="mt-2 text-xs text-rose-400">{err}</p>}
        <button className={`${btnPrimary} mt-3`} disabled={!form.lotNumber.trim() || !form.material.trim()} onClick={register}>
          <Plus className="h-4 w-4" /> Register lot
        </button>
      </div>

      <div className={card}>
        <p className="mb-2 text-xs font-medium text-zinc-400">Lots ({lots.length})</p>
        {lots.length === 0 ? (
          <p className="text-sm text-zinc-500">No lots registered.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                <th className="pb-2">Lot</th><th className="pb-2">Material</th><th className="pb-2">Kind</th>
                <th className="pb-2">Qty</th><th className="pb-2">Trace</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((l) => (
                <tr key={l.id} className="border-b border-zinc-800/50">
                  <td className="py-1.5 font-mono text-amber-400">{l.lotNumber}</td>
                  <td className="py-1.5 text-zinc-300">{l.material}</td>
                  <td className="py-1.5 text-zinc-400">{l.kind}</td>
                  <td className="py-1.5 text-zinc-400">{l.quantity}</td>
                  <td className="py-1.5">
                    <button className={btnGhost} onClick={() => trace(l.lotNumber)}>
                      <GitBranch className="h-3.5 w-3.5" /> Genealogy
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {genealogy && (
        <div className={card}>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-zinc-200">Genealogy: <span className="font-mono text-amber-400">{genealogy.lot.lotNumber}</span></p>
            <button className="text-zinc-600 hover:text-zinc-300" onClick={() => setGenealogy(null)} aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-medium text-zinc-500">Upstream (what it came from)</p>
              {genealogy.upstream ? <GenealogyTree nodes={[genealogy.upstream]} /> : <p className="text-xs text-zinc-600">No upstream lots.</p>}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-zinc-500">Downstream (what consumed it)</p>
              {genealogy.downstream?.length > 0 ? <GenealogyTree nodes={genealogy.downstream} /> : <p className="text-xs text-zinc-600">No downstream lots.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Feature 5: Andon / downtime alerting ─────────────────────────────────
function AndonTab() {
  const [board, setBoard] = useState<any>(null);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ station: '', reason: '', category: 'downtime', severity: 'medium' });

  const load = useCallback(async () => {
    const d = await run('andon-board');
    if (d.ok) setBoard(d.result);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const raise = async () => {
    setErr('');
    const d = await run('andon-raise', { ...form });
    if (!d.ok) { setErr(d.error || 'failed'); return; }
    setForm({ station: '', reason: '', category: 'downtime', severity: 'medium' });
    load();
  };

  const update = async (alertId: string, action: string) => {
    const d = await run('andon-update', { alertId, action });
    if (d.ok) load();
  };

  const sevColor: Record<string, string> = {
    low: 'text-zinc-400', medium: 'text-amber-400', high: 'text-orange-400', critical: 'text-rose-400',
  };
  const alerts: any[] = board?.alerts || [];

  return (
    <div className="space-y-4">
      <div className={card}>
        <p className="mb-2 text-xs font-medium text-zinc-400">Raise andon alert</p>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field name="Station / machine" value={form.station} onChange={(v) => setForm({ ...form, station: v })} placeholder="CNC-01" />
          <Field name="Reason" value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} placeholder="Coolant low" />
          <div>
            <label className={label}>Category</label>
            <select className={input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {['downtime', 'quality', 'material', 'safety'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Severity</label>
            <select className={input} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              {['low', 'medium', 'high', 'critical'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        {err && <p className="mt-2 text-xs text-rose-400">{err}</p>}
        <button className={`${btnPrimary} mt-3`} disabled={!form.reason.trim()} onClick={raise}>
          <Siren className="h-4 w-4" /> Raise alert
        </button>
      </div>

      {board && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className={card}><p className="text-xs text-zinc-500">Open alerts</p><p className="text-lg font-bold text-zinc-100">{board.openCount}</p></div>
          <div className={card}><p className="text-xs text-zinc-500">Critical open</p><p className={`text-lg font-bold ${board.criticalOpen > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{board.criticalOpen}</p></div>
          <div className={card}><p className="text-xs text-zinc-500">Avg response</p><p className="text-lg font-bold text-zinc-100">{board.avgResponseSeconds}s</p></div>
        </div>
      )}

      {alerts.length === 0 ? (
        <p className="text-sm text-zinc-500">No andon alerts. The floor is calm.</p>
      ) : (
        alerts.map((a) => (
          <div key={a.id} className={card}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-zinc-100">
                  <span className={sevColor[a.severity]}>● </span>{a.reason}
                </p>
                <p className="text-xs text-zinc-500">{a.station} · {a.category} · raised {new Date(a.raisedAt).toLocaleTimeString()}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-[10px] uppercase ${a.status === 'resolved' ? 'bg-emerald-950 text-emerald-300' : a.status === 'acknowledged' ? 'bg-amber-950 text-amber-300' : 'bg-rose-950 text-rose-300'}`}>
                  {a.status}
                </span>
                {a.status === 'open' && <button className={btnGhost} onClick={() => update(a.id, 'acknowledge')}>Acknowledge</button>}
                {a.status !== 'resolved' && <button className={btnPrimary} onClick={() => update(a.id, 'resolve')}>Resolve</button>}
              </div>
            </div>
            {a.responseSeconds != null && <p className="mt-1 text-xs text-emerald-400">Resolved in {a.responseSeconds}s</p>}
          </div>
        ))
      )}
    </div>
  );
}

// ─── Feature 6: NCR / CAPA workflow ───────────────────────────────────────
function NCRTab() {
  const [ncrs, setNcrs] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ title: '', product: '', defectType: '', severity: 'minor', quantityAffected: '' });
  const [capa, setCapa] = useState<Record<string, { rootCause: string; correctiveAction: string; preventiveAction: string }>>({});

  const load = useCallback(async () => {
    const d = await run<{ ncrs: any[] }>('ncr-list');
    if (d.ok && d.result) setNcrs(d.result.ncrs || []);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const create = async () => {
    setErr('');
    const d = await run('ncr-create', {
      title: form.title, product: form.product || null, defectType: form.defectType || 'unspecified',
      severity: form.severity, quantityAffected: form.quantityAffected ? Number(form.quantityAffected) : 0,
    });
    if (!d.ok) { setErr(d.error || 'failed'); return; }
    setForm({ title: '', product: '', defectType: '', severity: 'minor', quantityAffected: '' });
    load();
  };

  const advance = async (ncrId: string, extra: Record<string, unknown> = {}) => {
    const d = await run('ncr-advance', { ncrId, ...extra });
    if (d.ok) load();
  };

  const STAGES = ['open', 'investigation', 'capa', 'verification', 'closed'];

  return (
    <div className="space-y-4">
      <div className={card}>
        <p className="mb-2 text-xs font-medium text-zinc-400">Log non-conformance</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="Title" value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder="Surface scratch on housing" />
          <Field name="Product" value={form.product} onChange={(v) => setForm({ ...form, product: v })} />
          <Field name="Defect type" value={form.defectType} onChange={(v) => setForm({ ...form, defectType: v })} placeholder="cosmetic" />
          <div>
            <label className={label}>Severity</label>
            <select className={input} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              {['minor', 'major', 'critical'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <Field name="Qty affected" type="number" value={form.quantityAffected} onChange={(v) => setForm({ ...form, quantityAffected: v })} />
        </div>
        {err && <p className="mt-2 text-xs text-rose-400">{err}</p>}
        <button className={`${btnPrimary} mt-3`} disabled={!form.title.trim()} onClick={create}>
          <Plus className="h-4 w-4" /> Create NCR
        </button>
      </div>

      {ncrs.length === 0 ? (
        <p className="text-sm text-zinc-500">No non-conformance reports.</p>
      ) : (
        ncrs.map((n) => {
          const c = capa[n.id] || { rootCause: n.rootCause || '', correctiveAction: n.correctiveAction || '', preventiveAction: n.preventiveAction || '' };
          const stageIdx = STAGES.indexOf(n.stage);
          return (
            <div key={n.id} className={card}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-zinc-100">{n.number} · {n.title}</p>
                  <p className="text-xs text-zinc-500">{n.product || 'no product'} · {n.defectType} · {n.severity} · {n.quantityAffected} affected</p>
                </div>
                <span className={`rounded px-2 py-0.5 text-[10px] uppercase ${n.stage === 'closed' ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-950 text-amber-300'}`}>{n.stage}</span>
              </div>
              <div className="my-2 flex gap-1">
                {STAGES.map((st, i) => (
                  <div key={st} className={`h-1.5 flex-1 rounded-full ${i <= stageIdx ? 'bg-amber-500' : 'bg-zinc-800'}`} title={st} />
                ))}
              </div>
              {n.stage !== 'closed' && (
                <div className="mt-2 space-y-2">
                  <textarea className={input} rows={2} placeholder="Root cause"
                    value={c.rootCause} onChange={(e) => setCapa({ ...capa, [n.id]: { ...c, rootCause: e.target.value } })} />
                  <textarea className={input} rows={2} placeholder="Corrective action"
                    value={c.correctiveAction} onChange={(e) => setCapa({ ...capa, [n.id]: { ...c, correctiveAction: e.target.value } })} />
                  <textarea className={input} rows={2} placeholder="Preventive action"
                    value={c.preventiveAction} onChange={(e) => setCapa({ ...capa, [n.id]: { ...c, preventiveAction: e.target.value } })} />
                  <button className={btnPrimary} onClick={() => advance(n.id, c)}>
                    <ChevronRight className="h-4 w-4" /> Save &amp; advance to next stage
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// ─── Feature 7: Maintenance management ────────────────────────────────────
function MaintenanceTab() {
  const [sched, setSched] = useState<any>(null);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ machineId: '', task: '', intervalDays: '', assignedTo: '' });

  const load = useCallback(async () => {
    const d = await run('maintenance-schedule');
    if (d.ok) setSched(d.result);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const create = async () => {
    setErr('');
    const d = await run('maintenance-plan-create', {
      machineId: form.machineId, task: form.task,
      intervalDays: Number(form.intervalDays), assignedTo: form.assignedTo || null,
    });
    if (!d.ok) { setErr(d.error || 'failed'); return; }
    setForm({ machineId: '', task: '', intervalDays: '', assignedTo: '' });
    load();
  };

  const complete = async (planId: string) => {
    const d = await run('maintenance-complete', { planId });
    if (d.ok) load();
  };

  const plans: any[] = sched?.plans || [];
  const stateColor: Record<string, string> = {
    overdue: 'text-rose-400', due_soon: 'text-amber-400', scheduled: 'text-emerald-400',
  };

  return (
    <div className="space-y-4">
      <div className={card}>
        <p className="mb-2 text-xs font-medium text-zinc-400">Create preventive maintenance plan</p>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field name="Machine ID" value={form.machineId} onChange={(v) => setForm({ ...form, machineId: v })} placeholder="CNC-01" />
          <Field name="Task" value={form.task} onChange={(v) => setForm({ ...form, task: v })} placeholder="Spindle lubrication" />
          <Field name="Interval (days)" type="number" value={form.intervalDays} onChange={(v) => setForm({ ...form, intervalDays: v })} />
          <Field name="Assigned to" value={form.assignedTo} onChange={(v) => setForm({ ...form, assignedTo: v })} />
        </div>
        {err && <p className="mt-2 text-xs text-rose-400">{err}</p>}
        <button className={`${btnPrimary} mt-3`} disabled={!form.machineId.trim() || !form.task.trim() || !(Number(form.intervalDays) > 0)} onClick={create}>
          <Plus className="h-4 w-4" /> Create plan
        </button>
      </div>

      {sched && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className={card}><p className="text-xs text-zinc-500">Plans</p><p className="text-lg font-bold text-zinc-100">{plans.length}</p></div>
          <div className={card}><p className="text-xs text-zinc-500">Overdue</p><p className={`text-lg font-bold ${sched.overdueCount > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{sched.overdueCount}</p></div>
          <div className={card}><p className="text-xs text-zinc-500">Due soon</p><p className={`text-lg font-bold ${sched.dueSoonCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{sched.dueSoonCount}</p></div>
        </div>
      )}

      {plans.length === 0 ? (
        <p className="text-sm text-zinc-500">No maintenance plans.</p>
      ) : (
        <div className={card}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                <th className="pb-2">Machine</th><th className="pb-2">Task</th><th className="pb-2">Interval</th>
                <th className="pb-2">Next due</th><th className="pb-2">Status</th><th className="pb-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} className="border-b border-zinc-800/50">
                  <td className="py-1.5 text-zinc-200">{p.machineName}</td>
                  <td className="py-1.5 text-zinc-300">{p.task}</td>
                  <td className="py-1.5 text-zinc-400">{p.intervalDays}d</td>
                  <td className="py-1.5 text-zinc-500">{new Date(p.nextDue).toLocaleDateString()}</td>
                  <td className={`py-1.5 ${stateColor[p.state]}`}>{p.state.replace('_', ' ')} ({p.daysUntilDue}d)</td>
                  <td className="py-1.5">
                    <button className={btnGhost} onClick={() => complete(p.id)}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Mark done
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Feature 8: Inventory / WIP tracking ──────────────────────────────────
function InventoryTab() {
  const [status, setStatus] = useState<any>(null);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ sku: '', name: '', kind: 'raw_material', onHand: '', reorderPoint: '', unitCost: '' });
  const [alloc, setAlloc] = useState({ sku: '', quantity: '', workOrderId: '' });

  const load = useCallback(async () => {
    const d = await run('inventory-status');
    if (d.ok) setStatus(d.result);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const upsert = async () => {
    setErr('');
    const d = await run('inventory-upsert', {
      sku: form.sku, name: form.name || form.sku, kind: form.kind,
      onHand: form.onHand ? Number(form.onHand) : 0,
      reorderPoint: form.reorderPoint ? Number(form.reorderPoint) : 0,
      unitCost: form.unitCost ? Number(form.unitCost) : 0,
    });
    if (!d.ok) { setErr(d.error || 'failed'); return; }
    setForm({ sku: '', name: '', kind: 'raw_material', onHand: '', reorderPoint: '', unitCost: '' });
    load();
  };

  const allocate = async () => {
    setErr('');
    const d = await run('inventory-allocate', {
      sku: alloc.sku, quantity: Number(alloc.quantity), workOrderId: alloc.workOrderId || null,
    });
    if (!d.ok) { setErr(d.error || 'failed'); return; }
    setAlloc({ sku: '', quantity: '', workOrderId: '' });
    load();
  };

  const items: any[] = status?.items || [];

  return (
    <div className="space-y-4">
      <div className={card}>
        <p className="mb-2 text-xs font-medium text-zinc-400">Upsert inventory item</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="SKU" value={form.sku} onChange={(v) => setForm({ ...form, sku: v })} placeholder="RM-AL6061" />
          <Field name="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <div>
            <label className={label}>Kind</label>
            <select className={input} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="raw_material">raw_material</option>
              <option value="wip">wip</option>
              <option value="finished_good">finished_good</option>
            </select>
          </div>
          <Field name="On hand" type="number" value={form.onHand} onChange={(v) => setForm({ ...form, onHand: v })} />
          <Field name="Reorder point" type="number" value={form.reorderPoint} onChange={(v) => setForm({ ...form, reorderPoint: v })} />
          <Field name="Unit cost" type="number" value={form.unitCost} onChange={(v) => setForm({ ...form, unitCost: v })} />
        </div>
        <button className={`${btnPrimary} mt-3`} disabled={!form.sku.trim()} onClick={upsert}>
          <Plus className="h-4 w-4" /> Save item
        </button>
      </div>

      <div className={card}>
        <p className="mb-2 text-xs font-medium text-zinc-400">Allocate stock to work order</p>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field name="SKU" value={alloc.sku} onChange={(v) => setAlloc({ ...alloc, sku: v })} />
          <Field name="Quantity" type="number" value={alloc.quantity} onChange={(v) => setAlloc({ ...alloc, quantity: v })} />
          <Field name="Work order ID" value={alloc.workOrderId} onChange={(v) => setAlloc({ ...alloc, workOrderId: v })} />
          <div className="flex items-end">
            <button className={btnPrimary} disabled={!alloc.sku.trim() || !(Number(alloc.quantity) > 0)} onClick={allocate}>
              Allocate
            </button>
          </div>
        </div>
        {err && <p className="mt-2 text-xs text-rose-400">{err}</p>}
      </div>

      {status && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className={card}><p className="text-xs text-zinc-500">Total value</p><p className="text-lg font-bold text-zinc-100">${status.totalValue?.toLocaleString()}</p></div>
          <div className={card}><p className="text-xs text-zinc-500">Below reorder</p><p className={`text-lg font-bold ${status.belowReorderCount > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{status.belowReorderCount}</p></div>
          <div className={card}><p className="text-xs text-zinc-500">WIP items</p><p className="text-lg font-bold text-zinc-100">{status.wipCount}</p></div>
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">No inventory items.</p>
      ) : (
        <div className={card}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                <th className="pb-2">SKU</th><th className="pb-2">Name</th><th className="pb-2">Kind</th>
                <th className="pb-2">On hand</th><th className="pb-2">Allocated</th><th className="pb-2">Available</th>
                <th className="pb-2">Value</th><th className="pb-2">WO</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-b border-zinc-800/50">
                  <td className="py-1.5 font-mono text-amber-400">{it.sku}</td>
                  <td className="py-1.5 text-zinc-300">{it.name}</td>
                  <td className="py-1.5 text-zinc-400">{it.kind}</td>
                  <td className="py-1.5 text-zinc-400">{it.onHand}</td>
                  <td className="py-1.5 text-zinc-400">{it.allocated}</td>
                  <td className={`py-1.5 ${it.belowReorder ? 'text-rose-400' : 'text-emerald-400'}`}>{it.available}</td>
                  <td className="py-1.5 text-zinc-400">${it.value?.toLocaleString()}</td>
                  <td className="py-1.5 text-zinc-500">{it.workOrderId || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ShopFloorSuite() {
  const [tab, setTab] = useState<SuiteTab>('instructions');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-bold text-zinc-100">Shop-Floor Execution Suite</h2>
        <span className="rounded bg-amber-950 px-2 py-0.5 text-[10px] uppercase text-amber-400">MES</span>
      </div>
      <nav className="flex flex-wrap gap-1 border-b border-zinc-800 pb-2">
        {SUITE_TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t.id ? 'bg-amber-600/20 text-amber-400' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </nav>
      {tab === 'instructions' && <WorkInstructionsTab />}
      {tab === 'iot' && <IoTTab />}
      {tab === 'scheduling' && <SchedulingTab />}
      {tab === 'traceability' && <TraceabilityTab />}
      {tab === 'andon' && <AndonTab />}
      {tab === 'ncr' && <NCRTab />}
      {tab === 'maintenance' && <MaintenanceTab />}
      {tab === 'inventory' && <InventoryTab />}
    </div>
  );
}
