'use client';

/**
 * HrCompliancePanel — compliance document acknowledgement workflow.
 * Publish policy documents (versioned) and track which employees have
 * acknowledged each version.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, FileCheck, ChevronLeft } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Employee { id: string; name: string }
interface ComplianceDoc {
  id: string; title: string; category: string; version: string;
  body: string | null; dueDate: string | null;
  acknowledgedCount: number; pendingCount: number; acknowledgedRate: number;
}
interface StatusRow {
  docId: string; title: string; version: string; category: string;
  dueDate: string | null; acknowledged: boolean; acknowledgedAt: string | null;
}

export function HrCompliancePanel() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [docs, setDocs] = useState<ComplianceDoc[]>([]);
  const [orgPct, setOrgPct] = useState(100);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', category: '', version: '', body: '', dueDate: '' });
  const [statusFor, setStatusFor] = useState('');
  const [statusRows, setStatusRows] = useState<StatusRow[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [e, d, st] = await Promise.all([
      lensRun('hr', 'employee-list', {}),
      lensRun('hr', 'compliance-doc-list', {}),
      lensRun('hr', 'compliance-status', {}),
    ]);
    setEmployees((e.data?.result?.employees as Employee[]) || []);
    setDocs((d.data?.result?.documents as ComplianceDoc[]) || []);
    setOrgPct((st.data?.result?.compliancePct as number) ?? 100);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const addDoc = async () => {
    if (!form.title.trim()) { setError('Document title is required.'); return; }
    const r = await lensRun('hr', 'compliance-doc-add', {
      title: form.title.trim(), category: form.category.trim() || undefined,
      version: form.version.trim() || undefined, body: form.body.trim() || undefined,
      dueDate: form.dueDate || undefined,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ title: '', category: '', version: '', body: '', dueDate: '' });
    setError(null);
    await refresh();
  };
  const loadStatus = async (employeeId: string) => {
    setStatusFor(employeeId);
    if (!employeeId) { setStatusRows([]); return; }
    const r = await lensRun('hr', 'compliance-status', { employeeId });
    setStatusRows(r.data?.ok ? ((r.data.result?.documents as StatusRow[]) || []) : []);
  };
  const acknowledge = async (docId: string) => {
    if (!statusFor) return;
    const r = await lensRun('hr', 'compliance-acknowledge', { employeeId: statusFor, docId });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setError(null);
    await loadStatus(statusFor);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
        <p className={cn('text-lg font-bold', orgPct >= 100 ? 'text-emerald-400' : orgPct >= 70 ? 'text-amber-400' : 'text-rose-400')}>{orgPct}%</p>
        <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Org-wide acknowledgement</p>
      </div>

      {/* Publish doc */}
      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Publish policy document</h3>
        <div className="grid grid-cols-3 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Version (e.g. 1.0)" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <textarea placeholder="Document body (optional)" value={form.body} rows={1}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addDoc}
            className="col-span-3 flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">
            <Plus className="w-3.5 h-3.5" /> Publish document
          </button>
        </div>
      </section>

      {/* Doc roster */}
      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Documents</h3>
        {docs.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic">No compliance documents published yet.</p>
        ) : (
          <ul className="space-y-1">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <FileCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <div>
                    <p className="text-xs text-zinc-100">{d.title} <span className="text-zinc-500">v{d.version}</span></p>
                    <p className="text-[10px] text-zinc-500">{d.category}{d.dueDate ? ` · due ${d.dueDate}` : ''}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-zinc-200">{d.acknowledgedCount} acked</p>
                  <p className="text-[10px] text-zinc-500">{d.pendingCount} pending · {d.acknowledgedRate}%</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Per-employee acknowledgement */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-zinc-300">Acknowledge as employee</h3>
          {statusFor && (
            <button type="button" onClick={() => loadStatus('')}
              className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300">
              <ChevronLeft className="w-3 h-3" /> Clear
            </button>
          )}
        </div>
        <select value={statusFor} onChange={(e) => loadStatus(e.target.value)}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          <option value="">Select employee…</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        {statusFor && (
          statusRows.length === 0 ? (
            <p className="text-[11px] text-zinc-500 italic mt-2">No documents to acknowledge.</p>
          ) : (
            <ul className="space-y-1 mt-2">
              {statusRows.map((row) => (
                <li key={`${row.docId}-${row.version}`}
                  className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-xs text-zinc-200">{row.title} <span className="text-zinc-500">v{row.version}</span></p>
                    {row.acknowledged && <p className="text-[10px] text-emerald-400">Acknowledged {row.acknowledgedAt?.slice(0, 10)}</p>}
                  </div>
                  {row.acknowledged ? (
                    <span className="text-[10px] text-emerald-300">Done</span>
                  ) : (
                    <button type="button" onClick={() => acknowledge(row.docId)}
                      className="text-[10px] px-2 py-1 rounded bg-emerald-700/30 text-emerald-300 hover:bg-emerald-700/50">
                      Acknowledge
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )
        )}
      </section>
    </div>
  );
}
