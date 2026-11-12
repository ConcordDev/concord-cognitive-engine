'use client';

/**
 * HrPeoplePanel — employee directory + add, employee detail with
 * onboarding and documents, and an org-chart view.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, UserRound, ChevronLeft, Network, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/ui';

interface Employee {
  id: string; name: string; title: string | null; department: string;
  managerId: string | null; email: string | null; salary: number; employmentType: string; status: string;
  hireDate?: string; terminationDate?: string | null;
}
interface OrgNode { id: string; name: string; title: string | null; department: string; reports: OrgNode[] }
interface OnboardingTask { id: string; task: string; done: boolean }
interface HrDoc { id: string; title: string; kind: string }

export function HrPeoplePanel({ onChange }: { onChange: () => void }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [dirQuery, setDirQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'org'>('list');
  const [orgChart, setOrgChart] = useState<OrgNode[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', title: '', department: '', managerId: '', salary: '' });
  const [selected, setSelected] = useState<Employee | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingTask[]>([]);
  const [docs, setDocs] = useState<HrDoc[]>([]);
  const [taskInput, setTaskInput] = useState('');
  const [docInput, setDocInput] = useState('');
  const [terminated, setTerminated] = useState<Employee[]>([]);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ title: '', department: '', email: '', salary: '', managerId: '' });
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [confirmOffboard, setConfirmOffboard] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [e, o, all] = await Promise.all([
      lensRun('hr', 'employee-list', {}),
      lensRun('hr', 'org-chart', {}),
      lensRun('hr', 'employee-list', { includeInactive: true }),
    ]);
    if (e.data?.ok === false || o.data?.ok === false) {
      setLoadError(e.data?.error || o.data?.error || 'Could not load employees.');
      setLoading(false);
      return;
    }
    setLoadError(null);
    setEmployees(e.data?.result?.employees || []);
    setOrgChart(o.data?.result?.chart || []);
    setTerminated(((all.data?.result?.employees as Employee[]) || []).filter((x) => x.status === 'terminated'));
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const openEmp = useCallback(async (emp: Employee) => {
    setSelected(emp);
    setEditing(false);
    setConfirmOffboard(false);
    setSavedNote(null);
    const [o, d] = await Promise.all([
      lensRun('hr', 'onboarding-list', { employeeId: emp.id }),
      lensRun('hr', 'hr-document-list', { employeeId: emp.id }),
    ]);
    if (o.data?.ok === false || d.data?.ok === false) {
      setLoadError(o.data?.error || d.data?.error || 'Could not load employee details.');
      return;
    }
    setLoadError(null);
    setOnboarding(o.data?.result?.tasks || []);
    setDocs(d.data?.result?.documents || []);
  }, []);

  const addEmp = async () => {
    if (!form.name.trim()) { setError('Employee name is required.'); return; }
    if (form.salary.trim()) {
      const salary = Number(form.salary);
      if (!Number.isFinite(salary) || salary < 0) { setError('Salary must be a number from 0 up.'); return; }
    }
    const r = await lensRun('hr', 'employee-add', {
      name: form.name.trim(), title: form.title.trim(), department: form.department.trim() || 'General',
      managerId: form.managerId || undefined, salary: form.salary.trim() ? Number(form.salary) : 0,
    });
    if (r.data?.ok === false) { setError(r.data?.message || r.data?.error || 'Failed'); return; }
    setForm({ name: '', title: '', department: '', managerId: '', salary: '' });
    setShowAdd(false); setError(null);
    await refresh(); onChange();
  };
  const offboard = async (emp: Employee) => {
    const r = await lensRun('hr', 'employee-offboard', { id: emp.id });
    if (r.data?.ok === false) { setError(r.data?.error || 'Offboard failed'); return; }
    setConfirmOffboard(false);
    if (selected?.id === emp.id) setSelected(null);
    await refresh(); onChange();
  };
  const rehire = async (emp: Employee) => {
    const r = await lensRun('hr', 'employee-offboard', { id: emp.id, rehire: true });
    if (r.data?.ok === false) { setError(r.data?.error || 'Rehire failed'); return; }
    if (selected?.id === emp.id && r.data?.result?.employee) setSelected(r.data.result.employee as Employee);
    setSavedNote(`${emp.name} is active again.`);
    await refresh(); onChange();
  };
  const startEdit = (emp: Employee) => {
    setEditForm({
      title: emp.title || '', department: emp.department || '',
      email: emp.email || '', salary: emp.salary ? String(emp.salary) : '',
      managerId: emp.managerId || '',
    });
    setSavedNote(null);
    setEditing(true);
  };
  const saveEdit = async (emp: Employee) => {
    if (editForm.salary.trim()) {
      const salary = Number(editForm.salary);
      if (!Number.isFinite(salary) || salary < 0) { setError('Salary must be a number from 0 up.'); return; }
    }
    if (editForm.email.trim() && !/^[^\s@]+@[^\s@]+$/.test(editForm.email.trim())) {
      setError('Email needs a name and a domain, like ada@example.com.');
      return;
    }
    const r = await lensRun('hr', 'employee-update', {
      id: emp.id,
      title: editForm.title.trim(),
      department: editForm.department.trim() || emp.department,
      email: editForm.email.trim(),
      salary: editForm.salary.trim() ? Number(editForm.salary) : 0,
      managerId: editForm.managerId || null,
    });
    if (r.data?.ok === false) { setError(r.data?.message || r.data?.error || 'Save failed'); return; }
    setError(null);
    setEditing(false);
    if (r.data?.result?.employee) setSelected(r.data.result.employee as Employee);
    setSavedNote('Employee record saved.');
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
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
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
          <p className="text-xs text-zinc-400">
            {selected.title || 'No title'} · {selected.department} · {selected.employmentType.replace(/_/g, ' ')}
            {selected.salary > 0 ? ` · $${selected.salary.toLocaleString()}` : ''}
            {selected.email ? ` · ${selected.email}` : ''}
          </p>
          {selected.status === 'terminated' ? (
            <>
              <p className="mt-1 text-[11px] text-rose-300">
                Terminated{selected.terminationDate ? ` ${selected.terminationDate}` : ''} — record retained.
              </p>
              <button type="button" onClick={() => rehire(selected)}
                className="mt-2 text-[11px] px-2 py-1 rounded bg-emerald-700/30 text-emerald-300 hover:bg-emerald-700/50">Rehire</button>
            </>
          ) : editing ? (
            <div className="grid grid-cols-2 gap-2 mt-3">
              <input placeholder="Title" value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Department" value={editForm.department} onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Salary" inputMode="numeric" value={editForm.salary} onChange={(e) => setEditForm({ ...editForm, salary: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <select value={editForm.managerId} onChange={(e) => setEditForm({ ...editForm, managerId: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
                <option value="">— no manager —</option>
                {employees.filter((e) => e.id !== selected.id).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => saveEdit(selected)}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">Save changes</button>
                <button type="button" onClick={() => setEditing(false)}
                  className="px-2 py-1.5 text-xs text-zinc-400 hover:text-zinc-200">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-3">
              <button type="button" onClick={() => startEdit(selected)}
                className="text-[11px] px-2 py-1 rounded bg-zinc-800 text-zinc-200 hover:bg-zinc-700">Edit employee</button>
              {confirmOffboard ? (
                <span className="flex items-center gap-2 text-[11px]">
                  <span className="text-zinc-300">Offboard {selected.name}? The record is retained and they can be rehired.</span>
                  <button type="button" onClick={() => offboard(selected)}
                    className="px-2 py-1 rounded bg-rose-600 text-white hover:bg-rose-500">Confirm offboard</button>
                  <button type="button" onClick={() => setConfirmOffboard(false)}
                    className="text-zinc-400 hover:text-zinc-200">Cancel</button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmOffboard(true)}
                  className="text-[11px] text-zinc-400 hover:text-rose-400">Offboard employee</button>
              )}
            </div>
          )}
          {savedNote && <p className="mt-2 text-[11px] text-emerald-300">{savedNote}</p>}
        </div>

        {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}
        {loadError && <ErrorState message={loadError} onRetry={() => openEmp(selected)} variant="inline" />}

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
                  <span className={cn(t.done ? 'text-zinc-400 line-through' : 'text-zinc-200')}>{t.task}</span>
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

  const dq = dirQuery.trim().toLowerCase();
  const visibleEmployees = dq
    ? employees.filter((e) => e.name.toLowerCase().includes(dq) || e.department.toLowerCase().includes(dq) || (e.title || '').toLowerCase().includes(dq))
    : employees;

  // ── Directory / org view ──
  if (loadError) {
    return <div className="p-4"><ErrorState message={loadError} onRetry={refresh} /></div>;
  }

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

      {view === 'list' && employees.length > 0 && (
        <input value={dirQuery} onChange={(e) => setDirQuery(e.target.value)}
          placeholder="Search directory by name, title, or department" aria-label="Search directory"
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-2 text-xs text-zinc-100" />
      )}

      {view === 'org' ? (
        orgChart.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No employees to chart.</p>
        ) : (
          <div className="space-y-1">{orgChart.map((n) => <OrgRow key={n.id} node={n} depth={0} />)}</div>
        )
      ) : employees.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No employees yet. Add your first one.
        </div>
      ) : (
        <ul className="space-y-2">
          {visibleEmployees.length === 0 && (
            <li className="text-center text-zinc-400 text-sm italic py-6 border border-zinc-800 rounded-xl">
              No employees match &ldquo;{dirQuery}&rdquo;.
            </li>
          )}
          {visibleEmployees.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => openEmp(e)}
                className="w-full text-left flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 hover:border-zinc-700">
                <UserRound className="w-4 h-4 text-emerald-400 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{e.name}</p>
                  <p className="text-[11px] text-zinc-400">{e.title || 'No title'} · {e.department}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {view === 'list' && terminated.length > 0 && (
        <section className="pt-2">
          <h4 className="text-xs font-semibold text-zinc-300 mb-2">Former employees</h4>
          <ul className="space-y-2">
            {terminated.map((e) => (
              <li key={e.id} className="flex items-center justify-between bg-zinc-900/40 border border-zinc-800/70 rounded-xl p-3">
                <button type="button" onClick={() => openEmp(e)} className="flex items-center gap-2 text-left">
                  <UserRound className="w-4 h-4 text-zinc-500 shrink-0" />
                  <span>
                    <span className="block text-sm font-semibold text-zinc-300">{e.name}</span>
                    <span className="block text-[11px] text-zinc-500">
                      {e.title || 'No title'} · {e.department}
                      {e.terminationDate ? ` · terminated ${e.terminationDate}` : ''}
                    </span>
                  </span>
                </button>
                <button type="button" onClick={() => rehire(e)}
                  className="text-[11px] px-2 py-1 rounded bg-emerald-700/30 text-emerald-300 hover:bg-emerald-700/50">Rehire</button>
              </li>
            ))}
          </ul>
        </section>
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
        <span className="text-[10px] text-zinc-400">{node.title || node.department}</span>
      </div>
      {node.reports.length > 0 && (
        <div className="mt-1 space-y-1">{node.reports.map((r) => <OrgRow key={r.id} node={r} depth={depth + 1} />)}</div>
      )}
    </div>
  );
}
