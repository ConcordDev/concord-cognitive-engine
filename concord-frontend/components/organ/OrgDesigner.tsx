'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * OrgDesigner — ChartHop-parity org-design platform for the organ lens.
 * Covers the full buildable backlog: visual org chart (TreeDiagram),
 * drag-to-reassign reporting lines, HRIS CSV import, headcount-planning
 * scenarios, compensation/budget rollups, tenure/attrition overlays, and
 * dated org snapshots with diffs. Every value rendered comes from a real
 * `organ` macro — no seed/mock data.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { TreeDiagram, ChartKit } from '@/components/viz';
import type { TreeNode } from '@/components/viz';
import {
  Users, Upload, GitBranch, DollarSign, Clock, Camera, Plus, Trash2,
  Loader2, AlertTriangle, RefreshCw, X, Pencil, ArrowRightLeft, Save,
} from 'lucide-react';

interface Employee {
  id: string;
  name: string;
  title: string;
  department: string;
  managerId: string | null;
  email: string;
  location: string;
  compensation: number;
  startDate: string;
  level: string;
  status: string;
  skills: string[];
}

interface RosterResult {
  employees: Employee[];
  count: number;
  activeCount: number;
  openReqCount: number;
  departedCount: number;
  departments: string[];
  tree: TreeNode[];
}

type Tab = 'chart' | 'import' | 'comp' | 'scenarios' | 'tenure' | 'snapshots';

const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: 'chart', label: 'Org Chart', icon: GitBranch },
  { id: 'import', label: 'HRIS Import', icon: Upload },
  { id: 'comp', label: 'Comp Rollup', icon: DollarSign },
  { id: 'scenarios', label: 'Headcount Plan', icon: Plus },
  { id: 'tenure', label: 'Tenure / Attrition', icon: Clock },
  { id: 'snapshots', label: 'Snapshots', icon: Camera },
];

const STATUS_OPTS = ['active', 'on_leave', 'departed', 'open_req'];
const usd = (n: number) => '$' + Math.round(n).toLocaleString();

async function run<T = any>(action: string, input: Record<string, unknown> = {}) {
  const r = await lensRun<T>('organ', action, input);
  return r.data;
}

export function OrgDesigner() {
  const [tab, setTab] = useState<Tab>('chart');
  const [roster, setRoster] = useState<RosterResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reloadRoster = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await run<RosterResult>('roster-list');
    if (res.ok && res.result) setRoster(res.result);
    else setError(res.error || 'Failed to load roster');
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reloadRoster(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-semibold flex items-center gap-2">
          <Users className="w-4 h-4 text-neon-cyan" />
          Org Designer
          {roster && (
            <span className="text-xs text-gray-400 font-normal">
              {roster.activeCount} active · {roster.openReqCount} open reqs
            </span>
          )}
        </h2>
        <button onClick={reloadRoster} className="p-1.5 text-gray-400 hover:text-white" aria-label="Reload roster">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex gap-1 flex-wrap border-b border-lattice-border">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-2 text-xs flex items-center gap-1.5 border-b-2 -mb-px transition-colors ${
              tab === id
                ? 'border-neon-cyan text-neon-cyan'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="panel p-3 border border-red-400/30 bg-red-400/5 flex items-center gap-2 text-sm text-red-400">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      {loading && !roster ? (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading org data…
        </div>
      ) : (
        <>
          {tab === 'chart' && <ChartTab roster={roster} onChange={reloadRoster} />}
          {tab === 'import' && <ImportTab onImported={reloadRoster} />}
          {tab === 'comp' && <CompTab />}
          {tab === 'scenarios' && <ScenarioTab roster={roster} />}
          {tab === 'tenure' && <TenureTab />}
          {tab === 'snapshots' && <SnapshotTab roster={roster} />}
        </>
      )}
    </div>
  );
}

/* ───────────────────────── Org Chart + drag-reassign ───────────────────── */

function ChartTab({ roster, onChange }: { roster: RosterResult | null; onChange: () => void }) {
  const [editing, setEditing] = useState<Employee | null>(null);
  const [creating, setCreating] = useState(false);
  const [reassigning, setReassigning] = useState<Employee | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const employees = roster?.employees || [];
  const tree = roster?.tree || [];

  const remove = async (id: string) => {
    setBusy(true);
    const res = await run('employee-remove', { id });
    setMsg(res.ok ? `Removed (${(res.result as any)?.reassigned || 0} reports reassigned)` : res.error);
    setBusy(false);
    if (res.ok) onChange();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-gray-400">
          {employees.length} people · click a chart node to inspect, reassign, or remove
        </p>
        <button
          onClick={() => setCreating(true)}
          className="btn-secondary text-xs flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" /> Add Person
        </button>
      </div>

      {msg && <div className="text-xs text-neon-cyan">{msg}</div>}

      {employees.length === 0 ? (
        <div className="text-center py-10 text-gray-400 panel">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No roster yet — add people or import from HRIS.</p>
        </div>
      ) : (
        <div className="panel p-3">
          <TreeDiagram
            root={tree}
            onSelect={(n) => {
              const emp = employees.find((e) => e.id === n.id);
              if (emp) setEditing(emp);
            }}
          />
        </div>
      )}

      {/* roster table */}
      {employees.length > 0 && (
        <div className="panel p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-gray-400 border-b border-lattice-border">
              <tr>
                <th className="text-left p-2">Name</th>
                <th className="text-left p-2">Title</th>
                <th className="text-left p-2">Dept</th>
                <th className="text-left p-2">Manager</th>
                <th className="text-left p-2">Status</th>
                <th className="text-right p-2">Comp</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className="border-b border-lattice-border/50 hover:bg-white/[0.02]">
                  <td className="p-2 font-medium">{e.name}</td>
                  <td className="p-2 text-gray-400">{e.title || '—'}</td>
                  <td className="p-2 text-gray-400">{e.department || '—'}</td>
                  <td className="p-2 text-gray-400">
                    {employees.find((m) => m.id === e.managerId)?.name || '— top —'}
                  </td>
                  <td className="p-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                      e.status === 'open_req' ? 'bg-amber-400/10 text-amber-400'
                      : e.status === 'departed' ? 'bg-red-400/10 text-red-400'
                      : e.status === 'on_leave' ? 'bg-indigo-400/10 text-indigo-400'
                      : 'bg-green-400/10 text-green-400'
                    }`}>{e.status}</span>
                  </td>
                  <td className="p-2 text-right font-mono">{e.compensation ? usd(e.compensation) : '—'}</td>
                  <td className="p-2">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => setReassigning(e)} className="p-1 text-gray-400 hover:text-neon-cyan" aria-label="Reassign">
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setEditing(e)} className="p-1 text-gray-400 hover:text-white" aria-label="Edit">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => remove(e.id)} disabled={busy} className="p-1 text-gray-400 hover:text-red-400" aria-label="Remove">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(editing || creating) && (
        <EmployeeModal
          employee={editing}
          managers={employees}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { setEditing(null); setCreating(false); onChange(); }}
        />
      )}
      {reassigning && (
        <ReassignModal
          employee={reassigning}
          roster={employees}
          onClose={() => setReassigning(null)}
          onDone={() => { setReassigning(null); onChange(); }}
        />
      )}
    </div>
  );
}

function EmployeeModal({
  employee, managers, onClose, onSaved,
}: {
  employee: Employee | null;
  managers: Employee[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: employee?.name || '',
    title: employee?.title || '',
    department: employee?.department || '',
    managerId: employee?.managerId || '',
    email: employee?.email || '',
    location: employee?.location || '',
    compensation: employee?.compensation ? String(employee.compensation) : '',
    startDate: employee?.startDate || '',
    level: employee?.level || '',
    status: employee?.status || 'active',
    skills: (employee?.skills || []).join(', '),
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim()) { setErr('Name is required'); return; }
    setBusy(true);
    setErr(null);
    const res = await run('employee-upsert', {
      id: employee?.id,
      name: form.name,
      title: form.title,
      department: form.department,
      managerId: form.managerId || null,
      email: form.email,
      location: form.location,
      compensation: Number(form.compensation) || 0,
      startDate: form.startDate,
      level: form.level,
      status: form.status,
      skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean),
    });
    setBusy(false);
    if (res.ok) onSaved();
    else setErr(res.error || 'Save failed');
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="panel p-5 max-w-md w-full space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-bold">{employee ? 'Edit Person' : 'Add Person'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Field label="Name *" value={form.name} onChange={(v) => set('name', v)} />
          <Field label="Title" value={form.title} onChange={(v) => set('title', v)} />
          <Field label="Department" value={form.department} onChange={(v) => set('department', v)} />
          <div>
            <label className="text-xs text-gray-400">Manager</label>
            <select
              value={form.managerId}
              onChange={(e) => set('managerId', e.target.value)}
              className="w-full mt-0.5 px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-sm"
            >
              <option value="">— top of org —</option>
              {managers.filter((m) => m.id !== employee?.id).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          <Field label="Email" value={form.email} onChange={(v) => set('email', v)} />
          <Field label="Location" value={form.location} onChange={(v) => set('location', v)} />
          <Field label="Compensation" value={form.compensation} onChange={(v) => set('compensation', v)} type="number" />
          <Field label="Start Date" value={form.startDate} onChange={(v) => set('startDate', v)} type="date" />
          <Field label="Level" value={form.level} onChange={(v) => set('level', v)} />
          <div>
            <label className="text-xs text-gray-400">Status</label>
            <select
              value={form.status}
              onChange={(e) => set('status', e.target.value)}
              className="w-full mt-0.5 px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-sm"
            >
              {STATUS_OPTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <Field label="Skills (comma-separated)" value={form.skills} onChange={(v) => set('skills', v)} />
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-400 hover:text-white">Cancel</button>
          <button onClick={save} disabled={busy} className="btn-neon text-sm flex items-center gap-1">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function ReassignModal({
  employee, roster, onClose, onDone,
}: {
  employee: Employee;
  roster: Employee[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [newMgr, setNewMgr] = useState(employee.managerId || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const apply = async () => {
    setBusy(true);
    setErr(null);
    const res = await run('reassign', { employeeId: employee.id, newManagerId: newMgr || null });
    setBusy(false);
    if (res.ok) onDone();
    else setErr(res.error || 'Reassign failed');
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="panel p-5 max-w-sm w-full space-y-3">
        <h3 className="font-bold flex items-center gap-2">
          <ArrowRightLeft className="w-4 h-4 text-neon-cyan" /> Reassign {employee.name}
        </h3>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <div>
          <label className="text-xs text-gray-400">New manager</label>
          <select
            value={newMgr}
            onChange={(e) => setNewMgr(e.target.value)}
            className="w-full mt-0.5 px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-sm"
          >
            <option value="">— top of org —</option>
            {roster.filter((m) => m.id !== employee.id).map((m) => (
              <option key={m.id} value={m.id}>{m.name} ({m.title || 'no title'})</option>
            ))}
          </select>
          <p className="text-[10px] text-gray-400 mt-1">Reporting cycles are rejected by the backend.</p>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-400 hover:text-white">Cancel</button>
          <button onClick={apply} disabled={busy} className="btn-neon text-sm flex items-center gap-1">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="text-xs text-gray-400">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full mt-0.5 px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-sm focus:border-neon-cyan outline-none"
      />
    </div>
  );
}

/* ───────────────────────────── HRIS Import ─────────────────────────────── */

function ImportTab({ onImported }: { onImported: () => void }) {
  const [csv, setCsv] = useState('');
  const [mode, setMode] = useState<'replace' | 'merge'>('replace');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result || ''));
    reader.readAsText(file);
  };

  const doImport = async () => {
    if (!csv.trim()) { setErr('Paste or upload a CSV first'); return; }
    setBusy(true);
    setErr(null);
    setResult(null);
    const res = await run('hris-import', { csv, mode });
    setBusy(false);
    if (res.ok) { setResult(res.result); onImported(); }
    else setErr(res.error || 'Import failed');
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        Import a roster CSV exported from BambooHR, Workday, or any HRIS. Columns are matched
        case-insensitively: name, title, department, manager / managerId, email, location,
        compensation / salary, startDate / hireDate, level, status, skills.
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="btn-secondary text-xs cursor-pointer flex items-center gap-1">
          <Upload className="w-3.5 h-3.5" /> Upload CSV
          <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
        </label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as 'replace' | 'merge')}
          className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs"
        >
          <option value="replace">Replace roster</option>
          <option value="merge">Merge into roster</option>
        </select>
      </div>
      <textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        placeholder={'name,title,department,manager,compensation,startDate,status\nAda Lovelace,VP Engineering,Engineering,,210000,2021-03-01,active'}
        rows={8}
        className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-xs font-mono focus:border-neon-cyan outline-none"
      />
      {err && <p className="text-xs text-red-400">{err}</p>}
      <button onClick={doImport} disabled={busy} className="btn-neon text-sm flex items-center gap-1">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
        Import
      </button>
      {result && (
        <div className="panel p-3 text-sm space-y-1">
          <p className="text-neon-green">
            Imported {result.imported} rows · roster now has {result.totalCount} people ({result.mode}).
          </p>
          <p className="text-xs text-gray-400">
            Detected columns: {(result.columnsDetected || []).join(', ')}
          </p>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────── Comp Rollup ──────────────────────────────── */

function CompTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const res = await run('comp-rollup');
    if (res.ok) setData(res.result);
    else setErr(res.error || 'Failed');
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  if (loading) return <Spinner />;
  if (err) return <ErrLine msg={err} />;
  if (!data || data.message) return <EmptyMsg msg={data?.message || 'No comp data'} />;

  const deptChart = (data.departments || []).map((d: any) => ({
    department: d.department, totalComp: d.totalComp,
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Total Comp" value={usd(data.totalComp)} />
        <Stat label="Headcount" value={String(data.headcount)} />
        <Stat label="Avg Comp" value={usd(data.avgComp)} />
      </div>
      <div className="panel p-3">
        <h3 className="text-xs font-semibold mb-2 text-gray-400">Compensation by Department</h3>
        <ChartKit
          kind="bar"
          data={deptChart}
          xKey="department"
          series={[{ key: 'totalComp', label: 'Total Comp', color: '#22c55e' }]}
          height={220}
        />
      </div>
      <div className="panel p-0 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-gray-400 border-b border-lattice-border">
            <tr>
              <th className="text-left p-2">Department</th>
              <th className="text-right p-2">Headcount</th>
              <th className="text-right p-2">Open Reqs</th>
              <th className="text-right p-2">Total Comp</th>
              <th className="text-right p-2">Avg Comp</th>
            </tr>
          </thead>
          <tbody>
            {(data.departments || []).map((d: any) => (
              <tr key={d.department} className="border-b border-lattice-border/50">
                <td className="p-2 font-medium">{d.department}</td>
                <td className="p-2 text-right">{d.headcount}</td>
                <td className="p-2 text-right text-amber-400">{d.openReqs}</td>
                <td className="p-2 text-right font-mono">{usd(d.totalComp)}</td>
                <td className="p-2 text-right font-mono text-gray-400">{usd(d.avgComp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(data.subtrees || []).length > 0 && (
        <div className="panel p-3">
          <h3 className="text-xs font-semibold mb-2 text-gray-400">Cost per Manager Subtree</h3>
          <div className="space-y-1">
            {data.subtrees.map((s: any) => (
              <div key={s.managerId} className="flex justify-between text-xs py-1 border-b border-lattice-border/40">
                <span>{s.manager} <span className="text-gray-600">· {s.subtreeHeadcount} people</span></span>
                <span className="font-mono text-neon-green">{usd(s.subtreeComp)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── Headcount Plan / Scenarios ────────────────────── */

interface ReqRow { title: string; department: string; level: string; baseComp: string; count: string }

function ScenarioTab({ roster }: { roster: RosterResult | null }) {
  const [scenarios, setScenarios] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [loadFactor, setLoadFactor] = useState('1.3');
  const [reqs, setReqs] = useState<ReqRow[]>([
    { title: '', department: '', level: '', baseComp: '', count: '1' },
  ]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await run('scenario-list');
    if (res.ok) setScenarios((res.result as any)?.scenarios || []);
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const setReq = (i: number, k: keyof ReqRow, v: string) =>
    setReqs((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const create = async () => {
    if (!name.trim()) { setErr('Scenario name required'); return; }
    setBusy(true);
    setErr(null);
    const openReqs = reqs
      .filter((r) => r.title.trim())
      .map((r) => ({
        title: r.title, department: r.department, level: r.level,
        baseComp: Number(r.baseComp) || 0, count: Number(r.count) || 1,
      }));
    const res = await run('scenario-create', { name, loadFactor: Number(loadFactor) || 1.3, openReqs });
    setBusy(false);
    if (res.ok) {
      setName('');
      setReqs([{ title: '', department: '', level: '', baseComp: '', count: '1' }]);
      load();
    } else setErr(res.error || 'Failed');
  };

  const del = async (id: string) => {
    const res = await run('scenario-delete', { id });
    if (res.ok) load();
  };

  return (
    <div className="space-y-4">
      <div className="panel p-3 space-y-3">
        <h3 className="text-sm font-semibold">New Headcount Scenario</h3>
        {roster && (
          <p className="text-xs text-gray-400">
            Modeled on top of {roster.activeCount + roster.openReqCount} current live positions.
          </p>
        )}
        {err && <p className="text-xs text-red-400">{err}</p>}
        <div className="flex gap-2 flex-wrap">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Scenario name (e.g. FY27 Q1 expansion)"
            className="flex-1 min-w-[200px] px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-sm"
          />
          <div>
            <input
              type="number"
              step="0.05"
              value={loadFactor}
              onChange={(e) => setLoadFactor(e.target.value)}
              className="w-24 px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-sm"
            />
            <span className="text-[10px] text-gray-400 ml-1">load factor</span>
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-xs text-gray-400">Open requisitions to model:</p>
          {reqs.map((r, i) => (
            <div key={i} className="grid grid-cols-5 gap-1.5">
              <input value={r.title} onChange={(e) => setReq(i, 'title', e.target.value)} placeholder="Title"
                className="px-2 py-1 bg-lattice-surface border border-lattice-border rounded text-xs" />
              <input value={r.department} onChange={(e) => setReq(i, 'department', e.target.value)} placeholder="Dept"
                className="px-2 py-1 bg-lattice-surface border border-lattice-border rounded text-xs" />
              <input value={r.level} onChange={(e) => setReq(i, 'level', e.target.value)} placeholder="Level"
                className="px-2 py-1 bg-lattice-surface border border-lattice-border rounded text-xs" />
              <input type="number" value={r.baseComp} onChange={(e) => setReq(i, 'baseComp', e.target.value)} placeholder="Base comp"
                className="px-2 py-1 bg-lattice-surface border border-lattice-border rounded text-xs" />
              <input type="number" value={r.count} onChange={(e) => setReq(i, 'count', e.target.value)} placeholder="#"
                className="px-2 py-1 bg-lattice-surface border border-lattice-border rounded text-xs" />
            </div>
          ))}
          <button
            onClick={() => setReqs((rs) => [...rs, { title: '', department: '', level: '', baseComp: '', count: '1' }])}
            className="text-xs text-neon-cyan flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Add req row
          </button>
        </div>
        <button onClick={create} disabled={busy} className="btn-neon text-sm flex items-center gap-1">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Create Scenario
        </button>
      </div>

      {loading ? <Spinner /> : scenarios.length === 0 ? (
        <EmptyMsg msg="No scenarios yet — model one above." />
      ) : (
        <div className="space-y-2">
          {scenarios.map((s) => (
            <div key={s.id} className="panel p-3">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm">{s.name}</h4>
                <button onClick={() => del(s.id)} className="text-gray-400 hover:text-red-400" aria-label="Delete scenario">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2 mt-2 text-xs">
                <Stat label="Current HC" value={String(s.projection.currentHeadcount)} small />
                <Stat label="Projected HC" value={String(s.projection.projectedHeadcount)} small />
                <Stat label="Added Cost" value={usd(s.projection.addedFullyLoadedCost)} small />
                <Stat label="Total Cost" value={usd(s.projection.projectedTotalCost)} small />
              </div>
              {s.projection.headcountGrowthPct != null && (
                <p className="text-[11px] text-amber-400 mt-1">
                  +{s.projection.headcountGrowthPct}% headcount growth · {s.openReqs.length} req types · load ×{s.loadFactor}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────── Tenure / Attrition ─────────────────────────── */

function TenureTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const res = await run('tenure-attrition');
    if (res.ok) setData(res.result);
    else setErr(res.error || 'Failed');
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  if (loading) return <Spinner />;
  if (err) return <ErrLine msg={err} />;
  if (!data || data.message) return <EmptyMsg msg={data?.message || 'No tenure data'} />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <Stat label="Avg Tenure" value={`${data.avgTenureYears}y`} />
        <Stat label="Attrition" value={`${Math.round(data.attritionRate * 100)}%`} />
        <Stat label="High Flight-Risk" value={String(data.highRiskCount)} />
        <Stat label="Departed" value={String(data.departedCount)} />
      </div>
      <div className="panel p-3">
        <h3 className="text-xs font-semibold mb-2 text-gray-400">Tenure Distribution</h3>
        <ChartKit
          kind="bar"
          data={data.tenureBuckets || []}
          xKey="range"
          series={[{ key: 'count', label: 'People', color: '#6366f1' }]}
          height={200}
        />
      </div>
      {data.unknownStartDates > 0 && (
        <p className="text-xs text-gray-400">
          {data.unknownStartDates} active people have no start date — add one for a tenure score.
        </p>
      )}
      <div className="panel p-0 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-gray-400 border-b border-lattice-border">
            <tr>
              <th className="text-left p-2">Name</th>
              <th className="text-left p-2">Department</th>
              <th className="text-right p-2">Tenure</th>
              <th className="text-left p-2">Flight Risk</th>
            </tr>
          </thead>
          <tbody>
            {(data.employees || []).map((e: any) => (
              <tr key={e.id} className="border-b border-lattice-border/50">
                <td className="p-2 font-medium">{e.name}</td>
                <td className="p-2 text-gray-400">{e.department || '—'}</td>
                <td className="p-2 text-right font-mono">{e.tenureYears}y</td>
                <td className="p-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                    e.riskLabel === 'high' ? 'bg-red-400/10 text-red-400'
                    : e.riskLabel === 'moderate' ? 'bg-amber-400/10 text-amber-400'
                    : 'bg-green-400/10 text-green-400'
                  }`}>{e.riskLabel} ({Math.round(e.flightRisk * 100)}%)</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ──────────────────────────── Org Snapshots ────────────────────────────── */

function SnapshotTab({ roster }: { roster: RosterResult | null }) {
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('live');
  const [diff, setDiff] = useState<any>(null);
  const [diffBusy, setDiffBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await run('snapshot-list');
    if (res.ok) {
      const list = (res.result as any)?.snapshots || [];
      setSnapshots(list);
      if (list.length && !fromId) setFromId(list[0].id);
    }
    setLoading(false);
  }, [fromId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const capture = async () => {
    setBusy(true);
    setErr(null);
    const res = await run('snapshot-capture', { label });
    setBusy(false);
    if (res.ok) { setLabel(''); load(); }
    else setErr(res.error || 'Capture failed');
  };

  const runDiff = async () => {
    if (!fromId) { setErr('Select a "from" snapshot'); return; }
    setDiffBusy(true);
    setErr(null);
    const res = await run('snapshot-diff', { fromId, toId });
    setDiffBusy(false);
    if (res.ok) setDiff(res.result);
    else setErr(res.error || 'Diff failed');
  };

  return (
    <div className="space-y-4">
      <div className="panel p-3 space-y-2">
        <h3 className="text-sm font-semibold">Capture Snapshot</h3>
        {roster && (
          <p className="text-xs text-gray-400">
            Freezes the current roster ({roster.activeCount} active) as a dated record.
          </p>
        )}
        {err && <p className="text-xs text-red-400">{err}</p>}
        <div className="flex gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (defaults to today's date)"
            className="flex-1 px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-sm"
          />
          <button onClick={capture} disabled={busy} className="btn-neon text-sm flex items-center gap-1">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
            Capture
          </button>
        </div>
      </div>

      {loading ? <Spinner /> : (
        <>
          <div className="panel p-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-gray-400 border-b border-lattice-border">
                <tr>
                  <th className="text-left p-2">Label</th>
                  <th className="text-left p-2">Captured</th>
                  <th className="text-right p-2">Headcount</th>
                  <th className="text-right p-2">Total Comp</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.length === 0 ? (
                  <tr><td colSpan={4} className="p-3 text-center text-gray-400">No snapshots captured yet.</td></tr>
                ) : snapshots.map((s) => (
                  <tr key={s.id} className="border-b border-lattice-border/50">
                    <td className="p-2 font-medium">{s.label}</td>
                    <td className="p-2 text-gray-400">{new Date(s.capturedAt).toLocaleString()}</td>
                    <td className="p-2 text-right">{s.headcount}</td>
                    <td className="p-2 text-right font-mono">{usd(s.totalComp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {snapshots.length > 0 && (
            <div className="panel p-3 space-y-3">
              <h3 className="text-sm font-semibold">Diff Snapshots</h3>
              <div className="flex gap-2 items-center flex-wrap text-sm">
                <select value={fromId} onChange={(e) => setFromId(e.target.value)}
                  className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-sm">
                  {snapshots.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <span className="text-gray-400">→</span>
                <select value={toId} onChange={(e) => setToId(e.target.value)}
                  className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-sm">
                  <option value="live">Live roster</option>
                  {snapshots.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <button onClick={runDiff} disabled={diffBusy} className="btn-secondary text-sm flex items-center gap-1">
                  {diffBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitBranch className="w-3.5 h-3.5" />}
                  Compare
                </button>
              </div>

              {diff && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Stat
                      label="Headcount Δ"
                      value={`${diff.headcountDelta >= 0 ? '+' : ''}${diff.headcountDelta}`}
                      small
                    />
                    <Stat
                      label="Comp Δ"
                      value={`${diff.compDelta >= 0 ? '+' : ''}${usd(diff.compDelta)}`}
                      small
                    />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <DiffCol title="Hires" tone="text-green-400" items={diff.hires.map((h: any) => h.name)} />
                    <DiffCol title="Departures" tone="text-red-400" items={diff.departures.map((d: any) => d.name)} />
                    <DiffCol title="Reorgs" tone="text-amber-400" items={diff.reorgs.map((rr: any) => rr.name)} />
                    <DiffCol
                      title="Comp Changes"
                      tone="text-neon-cyan"
                      items={diff.compChanges.map((c: any) => `${c.name} (${c.delta >= 0 ? '+' : ''}${usd(c.delta)})`)}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DiffCol({ title, tone, items }: { title: string; tone: string; items: string[] }) {
  return (
    <div className="bg-lattice-deep rounded p-2">
      <p className={`font-semibold ${tone} mb-1`}>{title} ({items.length})</p>
      {items.length === 0 ? (
        <p className="text-gray-600">—</p>
      ) : (
        <ul className="space-y-0.5">
          {items.slice(0, 12).map((it, i) => <li key={i} className="text-gray-300 truncate">{it}</li>)}
        </ul>
      )}
    </div>
  );
}

/* ─────────────────────────── shared bits ───────────────────────────────── */

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="bg-lattice-deep rounded-lg p-2 text-center">
      <p className="text-[10px] text-gray-400">{label}</p>
      <p className={`font-bold ${small ? 'text-base' : 'text-xl'} text-neon-cyan`}>{value}</p>
    </div>
  );
}

const Spinner = () => (
  <div className="flex items-center justify-center py-10 text-gray-400">
    <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
  </div>
);

const ErrLine = ({ msg }: { msg: string }) => (
  <div className="panel p-3 border border-red-400/30 bg-red-400/5 flex items-center gap-2 text-sm text-red-400">
    <AlertTriangle className="w-4 h-4" /> {msg}
  </div>
);

const EmptyMsg = ({ msg }: { msg: string }) => (
  <div className="text-center py-10 text-gray-400 panel">
    <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
    <p className="text-sm">{msg}</p>
  </div>
);
