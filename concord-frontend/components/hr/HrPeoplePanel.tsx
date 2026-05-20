'use client';

/**
 * HrPeoplePanel — employee directory + add, employee detail with
 * onboarding and documents, and an org-chart view.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, UserRound, ChevronLeft, Network, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Employee {
  id: string; name: string; title: string | null; department: string;
  managerId: string | null; email: string | null; salary: number; employmentType: string; status: string;
}
interface OrgNode { id: string; name: string; title: string | null; department: string; reports: OrgNode[] }
interface OnboardingTask { id: string; task: string; done: boolean }
interface HrDoc { id: string; title: string; kind: string }

export function HrPeoplePanel({ onChange }: { onChange: () => void }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'org'>('list');
  const [orgChart, setOrgChart] = useState<OrgNode[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', title: '', department: '', managerId: '', salary: '' });
  const [selected, setSelected] = useState<Employee | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingTask[]>([]);
  const [docs, setDocs] = useState<HrDoc[]>([]);
  const [taskInput, setTaskInput] = useState('');
  const [docInput, setDocInput] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const [e, o] = await Promise.all([
      lensRun('hr', 'employee-list', {}),
      lensRun('hr', 'org-chart', {}),
    ]);
    setEmployees(e.data?.result?.employees || []);
    setOrgChart(o.data?.result?.chart || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const openEmp = useCallback(async (emp: Employee) => {
    setSelected(emp);
    const [o, d] = await Promise.all([
      lensRun('hr', 'onboarding-list', { employeeId: emp.id }),
      lensRun('hr', 'hr-document-list', { employeeId: emp.id }),
    ]);
    setOnboarding(o.data?.result?.tasks || []);
    setDocs(d.data?.result?.documents || []);
  }, []);

  const addEmp = async () => {
    if (!form.name.trim()) { setError('Employee name is required.'); return; }
    const r = await lensRun('hr', 'employee-add', {
      name: form.name.trim(), title: form.title.trim(), department: form.department.trim() || 'General',
      managerId: form.managerId || undefined, salary: Number(form.salary) || 0,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', title: '', department: '', managerId: '', salary: '' });
    setShowAdd(false); setError(null);
    await refresh(); onChange();
  };
  const offboard = async (emp: Employee) => {
    await lensRun('hr', 'employee-offboard', { id: emp.id });
    if (selected?.id === emp.id) setSelected(null);
    await refresh(); onChange();
  };
  const addTask = async () => {
    if (!selected || !taskInput.trim()) return;
    await lensRun('hr', 'onboarding-task-add', { employeeId: selected.id, task: taskInput.trim() });
    setTaskInput('');
    await openEmp(selected); onChange();
  };
  const toggleTask = async (id: string) => {
    if (!selected) return;
    await lensRun('hr', 'onboarding-complete', { id });
    await openEmp(selected); onChange();
  };
  const addDoc = async () => {
    if (!selected || !docInput.trim()) return;
    await lensRun('hr', 'hr-document-add', { employeeId: selected.id, title: docInput.trim() });
    setDocInput('');
    await openEmp(selected);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  // ── Employee detail ──
  if (selected) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => setSelected(null)}
          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200">
          <ChevronLeft className="w-3.5 h-3.5" /> Directory
        </button>
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
          <h3 className="text-base font-bold text-zinc-100">{selected.name}</h3>
          <p className="text-xs text-zinc-500">
            {selected.title || 'No title'} · {selected.department} · {selected.employmentType.replace(/_/g, ' ')}
            {selected.salary > 0 ? ` · $${selected.salary.toLocaleString()}` : ''}
          </p>
          <button type="button" onClick={() => offboard(selected)}
            className="mt-2 text-[11px] text-zinc-500 hover:text-rose-400">Offboard employee</button>
        </div>

        {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

        <section>
          <h4 className="text-xs font-semibold text-zinc-300 mb-2">Onboarding</h4>
          <div className="flex gap-1 mb-2">
            <input value={taskInput} onChange={(e) => setTaskInput(e.target.value)} placeholder="Add onboarding task…"
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button type="button" onClick={addTask}
              className="px-2.5 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg">Add</button>
          </div>
          {onboarding.length > 0 && (
            <ul className="space-y-1">
              {onboarding.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-xs">
                  <button type="button" onClick={() => toggleTask(t.id)}
                    className={cn('w-4 h-4 rounded border flex items-center justify-center',
                      t.done ? 'bg-emerald-600 border-emerald-600' : 'border-zinc-600')}>
                    {t.done && <Check className="w-3 h-3 text-white" />}
                  </button>
                  <span className={cn(t.done ? 'text-zinc-500 line-through' : 'text-zinc-200')}>{t.task}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h4 className="text-xs font-semibold text-zinc-300 mb-2">Documents</h4>
          <div className="flex gap-1 mb-2">
            <input value={docInput} onChange={(e) => setDocInput(e.target.value)} placeholder="Add document…"
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button type="button" onClick={addDoc}
              className="px-2.5 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg">Add</button>
          </div>
          {docs.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {docs.map((d) => (
                <li key={d.id} className="text-[11px] px-2 py-1 rounded-lg border border-zinc-700 text-zinc-300">{d.title}</li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  // ── Directory / org view ──
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <button type="button" onClick={() => setView('list')}
            className={cn('text-[11px] px-2 py-1 rounded-lg', view === 'list' ? 'bg-emerald-950/40 text-emerald-300' : 'text-zinc-400')}>
            Directory
          </button>
          <button type="button" onClick={() => setView('org')}
            className={cn('flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg', view === 'org' ? 'bg-emerald-950/40 text-emerald-300' : 'text-zinc-400')}>
            <Network className="w-3 h-3" /> Org chart
          </button>
        </div>
        <button type="button" onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {showAdd && (
        <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Salary" inputMode="numeric" value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={form.managerId} onChange={(e) => setForm({ ...form, managerId: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            <option value="">— no manager —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <button type="button" onClick={addEmp}
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">Add employee</button>
        </div>
      )}

      {view === 'org' ? (
        orgChart.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic">No employees to chart.</p>
        ) : (
          <div className="space-y-1">{orgChart.map((n) => <OrgRow key={n.id} node={n} depth={0} />)}</div>
        )
      ) : employees.length === 0 ? (
        <div className="text-center text-zinc-500 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No employees yet. Add your first one.
        </div>
      ) : (
        <ul className="space-y-2">
          {employees.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => openEmp(e)}
                className="w-full text-left flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 hover:border-zinc-700">
                <UserRound className="w-4 h-4 text-emerald-400 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{e.name}</p>
                  <p className="text-[11px] text-zinc-500">{e.title || 'No title'} · {e.department}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OrgRow({ node, depth }: { node: OrgNode; depth: number }) {
  return (
    <div>
      <div className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5"
        style={{ marginLeft: depth * 16 }}>
        <UserRound className="w-3.5 h-3.5 text-emerald-400" />
        <span className="text-xs text-zinc-200">{node.name}</span>
        <span className="text-[10px] text-zinc-500">{node.title || node.department}</span>
      </div>
      {node.reports.length > 0 && (
        <div className="mt-1 space-y-1">{node.reports.map((r) => <OrgRow key={r.id} node={r} depth={depth + 1} />)}</div>
      )}
    </div>
  );
}
