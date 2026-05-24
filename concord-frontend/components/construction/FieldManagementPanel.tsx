'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * FieldManagementPanel — the Procore-parity field-management core for the
 * construction lens. Wires every `construction` domain field-management macro:
 * RFIs, submittals, daily logs, punch list, change orders, drawings (with
 * markup + version compare), budget vs actual, and the Gantt schedule.
 *
 * Every value rendered comes from a real macro round-trip — no mock data.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  MessageSquare, FileCheck2, NotebookPen, ListChecks, FileSignature,
  Layers, Wallet, GanttChartSquare, Plus, X, Trash2, RefreshCw,
  AlertCircle, CheckCircle2, Clock,
} from 'lucide-react';

type FieldTab =
  | 'rfi' | 'submittals' | 'dailylog' | 'punch'
  | 'changeorders' | 'drawings' | 'budget' | 'gantt';

interface FieldTabDef {
  id: FieldTab;
  label: string;
  icon: typeof MessageSquare;
}

const FIELD_TABS: FieldTabDef[] = [
  { id: 'rfi', label: 'RFIs', icon: MessageSquare },
  { id: 'submittals', label: 'Submittals', icon: FileCheck2 },
  { id: 'dailylog', label: 'Daily Log', icon: NotebookPen },
  { id: 'punch', label: 'Punch List', icon: ListChecks },
  { id: 'changeorders', label: 'Change Orders', icon: FileSignature },
  { id: 'drawings', label: 'Drawings', icon: Layers },
  { id: 'budget', label: 'Budget', icon: Wallet },
  { id: 'gantt', label: 'Gantt', icon: GanttChartSquare },
];

const fmtMoney = (n: number) =>
  `$${(Math.round((n || 0) * 100) / 100).toLocaleString()}`;

// ── shared field primitives ──────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={ds.label}>{label}</label>
      {children}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="p-3 bg-lattice-elevated rounded-lg border border-lattice-border">
      <p className={cn('text-lg font-bold', tone || 'text-white')}>{value}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div
        className={cn(ds.panel, 'w-full max-w-lg max-h-[85vh] overflow-y-auto')}
        onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className={ds.heading3}>{title}</h3>
          <button onClick={onClose} className={ds.btnGhost} aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// =========================================================================
// RFI workflow
// =========================================================================
function RfiTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState({ open: 0, overdue: 0, total: 0 });
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [respondId, setRespondId] = useState<string | null>(null);
  const [f, setF] = useState({ subject: '', question: '', discipline: 'General', priority: 'normal', ballInCourt: 'Architect', dueDate: '' });
  const [response, setResponse] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('construction', 'rfi-list', {});
    if (r.data.ok && r.data.result) {
      setRows(r.data.result.rfis || []);
      setSummary({ open: r.data.result.open || 0, overdue: r.data.result.overdue || 0, total: r.data.result.total || 0 });
    }
    setLoading(false);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!f.subject.trim()) return;
    await lensRun('construction', 'rfi-submit', { ...f });
    setF({ subject: '', question: '', discipline: 'General', priority: 'normal', ballInCourt: 'Architect', dueDate: '' });
    setCreateOpen(false);
    load();
  };
  const respond = async () => {
    if (!respondId || !response.trim()) return;
    await lensRun('construction', 'rfi-respond', { id: respondId, response });
    setRespondId(null);
    setResponse('');
    load();
  };
  const closeRfi = async (id: string) => { await lensRun('construction', 'rfi-close', { id }); load(); };
  const delRfi = async (id: string) => { await lensRun('construction', 'rfi-delete', { id }); load(); };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Open" value={summary.open} tone="text-yellow-400" />
        <Stat label="Overdue" value={summary.overdue} tone="text-red-400" />
        <Stat label="Total" value={summary.total} />
      </div>
      <div className="flex justify-between items-center">
        <button onClick={load} className={ds.btnGhost} aria-label="Refresh">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
        <button onClick={() => setCreateOpen(true)} className={ds.btnPrimary}>
          <Plus className="w-4 h-4" /> Submit RFI
        </button>
      </div>
      {rows.length === 0 ? (
        <div className={cn(ds.panel, 'text-center py-8')}>
          <MessageSquare className="w-10 h-10 text-gray-600 mx-auto mb-2" />
          <p className={ds.textMuted}>No RFIs yet</p>
        </div>
      ) : rows.map((r) => (
        <div key={r.id} className={ds.panel}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-white font-medium">
                <span className="text-neon-cyan mr-2">{r.number}</span>{r.subject}
              </p>
              <p className={ds.textMuted}>{r.question}</p>
              <div className="flex flex-wrap gap-2 mt-1 text-xs">
                <span className="px-2 py-0.5 rounded-full bg-blue-400/20 text-blue-400">{r.discipline}</span>
                <span className="px-2 py-0.5 rounded-full bg-purple-400/20 text-purple-400">{r.priority}</span>
                <span className="px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-400">
                  Ball-in-court: {r.ballInCourt}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-gray-600/30 text-gray-300">{r.status}</span>
                {r.dueDate && <span className="text-gray-500">Due {r.dueDate}</span>}
              </div>
              {r.response && (
                <p className="mt-2 text-xs text-emerald-300 border-l-2 border-emerald-500 pl-2">
                  {r.respondedBy}: {r.response}
                </p>
              )}
            </div>
            <div className="flex gap-1 shrink-0">
              {r.status === 'open' && (
                <button onClick={() => setRespondId(r.id)} className={ds.btnGhost} aria-label="Respond">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                </button>
              )}
              {r.status === 'answered' && (
                <button onClick={() => closeRfi(r.id)} className={ds.btnSecondary}>Close</button>
              )}
              <button onClick={() => delRfi(r.id)} className={ds.btnGhost} aria-label="Delete">
                <Trash2 className="w-4 h-4 text-red-400" />
              </button>
            </div>
          </div>
        </div>
      ))}

      {createOpen && (
        <Modal title="Submit RFI" onClose={() => setCreateOpen(false)}>
          <div className="space-y-3">
            <Field label="Subject">
              <input className={ds.input} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
            </Field>
            <Field label="Question">
              <textarea className={ds.textarea} rows={3} value={f.question} onChange={(e) => setF({ ...f, question: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Discipline">
                <select className={ds.select} value={f.discipline} onChange={(e) => setF({ ...f, discipline: e.target.value })}>
                  {['General', 'Architectural', 'Structural', 'Mechanical', 'Electrical', 'Plumbing', 'Civil'].map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </Field>
              <Field label="Priority">
                <select className={ds.select} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
                  {['low', 'normal', 'high', 'critical'].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Ball-in-court">
                <select className={ds.select} value={f.ballInCourt} onChange={(e) => setF({ ...f, ballInCourt: e.target.value })}>
                  {['Architect', 'Engineer', 'Owner', 'GC', 'Subcontractor'].map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>
              <Field label="Due date">
                <input type="date" className={ds.input} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
              </Field>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setCreateOpen(false)} className={ds.btnSecondary}>Cancel</button>
            <button onClick={submit} className={ds.btnPrimary} disabled={!f.subject.trim()}>Submit</button>
          </div>
        </Modal>
      )}
      {respondId && (
        <Modal title="Respond to RFI" onClose={() => setRespondId(null)}>
          <Field label="Response">
            <textarea className={ds.textarea} rows={4} value={response} onChange={(e) => setResponse(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setRespondId(null)} className={ds.btnSecondary}>Cancel</button>
            <button onClick={respond} className={ds.btnPrimary} disabled={!response.trim()}>Send Response</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// =========================================================================
// Submittals log
// =========================================================================
function SubmittalsTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [byStatus, setByStatus] = useState<Record<string, number>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [f, setF] = useState({ title: '', specSection: '', type: 'shop_drawing', contractor: '', requiredOnSite: '' });
  const [rv, setRv] = useState({ action: 'approved', reviewer: 'Architect', comments: '' });

  const load = useCallback(async () => {
    const r = await lensRun('construction', 'submittal-list', {});
    if (r.data.ok && r.data.result) {
      setRows(r.data.result.submittals || []);
      setByStatus(r.data.result.byStatus || {});
    }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!f.title.trim() || !f.specSection.trim()) return;
    await lensRun('construction', 'submittal-create', { ...f });
    setF({ title: '', specSection: '', type: 'shop_drawing', contractor: '', requiredOnSite: '' });
    setCreateOpen(false);
    load();
  };
  const review = async () => {
    if (!reviewId) return;
    await lensRun('construction', 'submittal-review', { id: reviewId, ...rv });
    setReviewId(null);
    setRv({ action: 'approved', reviewer: 'Architect', comments: '' });
    load();
  };
  const del = async (id: string) => { await lensRun('construction', 'submittal-delete', { id }); load(); };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {Object.entries(byStatus).map(([k, v]) => (
          <span key={k} className="px-2 py-1 rounded-full text-xs bg-lattice-elevated border border-lattice-border text-gray-300">
            {k}: {v}
          </span>
        ))}
      </div>
      <div className="flex justify-end">
        <button onClick={() => setCreateOpen(true)} className={ds.btnPrimary}>
          <Plus className="w-4 h-4" /> New Submittal
        </button>
      </div>
      {rows.length === 0 ? (
        <div className={cn(ds.panel, 'text-center py-8')}>
          <FileCheck2 className="w-10 h-10 text-gray-600 mx-auto mb-2" />
          <p className={ds.textMuted}>No submittals yet</p>
        </div>
      ) : rows.map((s) => (
        <div key={s.id} className={ds.panel}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-white font-medium">
                <span className="text-neon-cyan mr-2">{s.number}</span>{s.title}
              </p>
              <p className={ds.textMuted}>Spec {s.specSection} · {s.type.replace('_', ' ')} · rev {s.revision}</p>
              <div className="flex flex-wrap gap-2 mt-1 text-xs">
                <span className="px-2 py-0.5 rounded-full bg-gray-600/30 text-gray-300">{s.status}</span>
                {s.contractor && <span className="text-gray-500">{s.contractor}</span>}
              </div>
              {s.reviewCycles?.length > 0 && (
                <div className="mt-2 space-y-1">
                  {s.reviewCycles.map((c: any) => (
                    <p key={c.cycle} className="text-xs text-gray-400 border-l-2 border-indigo-500 pl-2">
                      Cycle {c.cycle}: {c.action.replace(/_/g, ' ')} — {c.reviewer}
                      {c.comments ? ` (${c.comments})` : ''}
                    </p>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-1 shrink-0">
              {s.status !== 'closed' && (
                <button onClick={() => setReviewId(s.id)} className={ds.btnSecondary}>Review</button>
              )}
              <button onClick={() => del(s.id)} className={ds.btnGhost} aria-label="Delete">
                <Trash2 className="w-4 h-4 text-red-400" />
              </button>
            </div>
          </div>
        </div>
      ))}

      {createOpen && (
        <Modal title="New Submittal" onClose={() => setCreateOpen(false)}>
          <div className="space-y-3">
            <Field label="Title">
              <input className={ds.input} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Spec Section">
                <input className={ds.input} placeholder="e.g. 05 12 00" value={f.specSection} onChange={(e) => setF({ ...f, specSection: e.target.value })} />
              </Field>
              <Field label="Type">
                <select className={ds.select} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                  {['shop_drawing', 'product_data', 'sample', 'mockup', 'certificate'].map((t) => (
                    <option key={t} value={t}>{t.replace('_', ' ')}</option>
                  ))}
                </select>
              </Field>
              <Field label="Contractor">
                <input className={ds.input} value={f.contractor} onChange={(e) => setF({ ...f, contractor: e.target.value })} />
              </Field>
              <Field label="Required On-Site">
                <input type="date" className={ds.input} value={f.requiredOnSite} onChange={(e) => setF({ ...f, requiredOnSite: e.target.value })} />
              </Field>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setCreateOpen(false)} className={ds.btnSecondary}>Cancel</button>
            <button onClick={create} className={ds.btnPrimary} disabled={!f.title.trim() || !f.specSection.trim()}>Create</button>
          </div>
        </Modal>
      )}
      {reviewId && (
        <Modal title="Review Submittal" onClose={() => setReviewId(null)}>
          <div className="space-y-3">
            <Field label="Action">
              <select className={ds.select} value={rv.action} onChange={(e) => setRv({ ...rv, action: e.target.value })}>
                {['approved', 'approved_as_noted', 'revise_resubmit', 'rejected', 'for_record'].map((a) => (
                  <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </Field>
            <Field label="Reviewer">
              <input className={ds.input} value={rv.reviewer} onChange={(e) => setRv({ ...rv, reviewer: e.target.value })} />
            </Field>
            <Field label="Comments">
              <textarea className={ds.textarea} rows={3} value={rv.comments} onChange={(e) => setRv({ ...rv, comments: e.target.value })} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setReviewId(null)} className={ds.btnSecondary}>Cancel</button>
            <button onClick={review} className={ds.btnPrimary}>Record Review</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// =========================================================================
// Daily log / field reports
// =========================================================================
interface ManpowerRow { trade: string; workers: string; hours: string }
function DailyLogTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [totalManHours, setTotalManHours] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [f, setF] = useState({
    date: new Date().toISOString().slice(0, 10), weather: 'Clear',
    tempHigh: '', tempLow: '', conditions: '', workCompleted: '', delays: '', author: 'Superintendent',
  });
  const [manpower, setManpower] = useState<ManpowerRow[]>([{ trade: 'General', workers: '', hours: '8' }]);
  const [equipment, setEquipment] = useState('');

  const load = useCallback(async () => {
    const r = await lensRun('construction', 'dailylog-list', {});
    if (r.data.ok && r.data.result) {
      setRows(r.data.result.logs || []);
      setTotalManHours(r.data.result.totalManHours || 0);
    }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!f.date) return;
    await lensRun('construction', 'dailylog-create', {
      ...f,
      tempHigh: f.tempHigh ? Number(f.tempHigh) : null,
      tempLow: f.tempLow ? Number(f.tempLow) : null,
      manpower: manpower.filter((m) => m.workers).map((m) => ({ trade: m.trade, workers: Number(m.workers), hours: Number(m.hours) })),
      equipment: equipment.split(',').map((e) => e.trim()).filter(Boolean),
    });
    setF({ date: new Date().toISOString().slice(0, 10), weather: 'Clear', tempHigh: '', tempLow: '', conditions: '', workCompleted: '', delays: '', author: 'Superintendent' });
    setManpower([{ trade: 'General', workers: '', hours: '8' }]);
    setEquipment('');
    setCreateOpen(false);
    load();
  };
  const del = async (id: string) => { await lensRun('construction', 'dailylog-delete', { id }); load(); };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Logged Days" value={rows.length} />
        <Stat label="Total Man-Hours" value={totalManHours} tone="text-orange-400" />
      </div>
      <div className="flex justify-end">
        <button onClick={() => setCreateOpen(true)} className={ds.btnPrimary}>
          <Plus className="w-4 h-4" /> New Daily Log
        </button>
      </div>
      {rows.length === 0 ? (
        <div className={cn(ds.panel, 'text-center py-8')}>
          <NotebookPen className="w-10 h-10 text-gray-600 mx-auto mb-2" />
          <p className={ds.textMuted}>No daily logs yet</p>
        </div>
      ) : rows.map((l) => (
        <div key={l.id} className={ds.panel}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-white font-medium">{l.date} · {l.weather}
                {(l.tempHigh != null || l.tempLow != null) &&
                  <span className="text-gray-500 ml-2">{l.tempLow ?? '?'}–{l.tempHigh ?? '?'}°</span>}
              </p>
              <p className={ds.textMuted}>{l.totalManHours} man-hours · {l.author}</p>
              {l.manpower?.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-1 text-xs">
                  {l.manpower.map((m: any, i: number) => (
                    <span key={i} className="px-2 py-0.5 rounded-full bg-blue-400/20 text-blue-400">
                      {m.trade}: {m.workers}×{m.hours}h
                    </span>
                  ))}
                </div>
              )}
              {l.equipment?.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">Equipment: {l.equipment.join(', ')}</p>
              )}
              {l.workCompleted && <p className="text-xs text-gray-400 mt-1">{l.workCompleted}</p>}
              {l.delays && <p className="text-xs text-red-400 mt-1">Delays: {l.delays}</p>}
            </div>
            <button onClick={() => del(l.id)} className={ds.btnGhost} aria-label="Delete">
              <Trash2 className="w-4 h-4 text-red-400" />
            </button>
          </div>
        </div>
      ))}

      {createOpen && (
        <Modal title="New Daily Log" onClose={() => setCreateOpen(false)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">
                <input type="date" className={ds.input} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
              </Field>
              <Field label="Weather">
                <select className={ds.select} value={f.weather} onChange={(e) => setF({ ...f, weather: e.target.value })}>
                  {['Clear', 'Cloudy', 'Rain', 'Snow', 'Wind', 'Fog', 'Hot', 'Cold'].map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </Field>
              <Field label="Temp High (°F)">
                <input type="number" className={ds.input} value={f.tempHigh} onChange={(e) => setF({ ...f, tempHigh: e.target.value })} />
              </Field>
              <Field label="Temp Low (°F)">
                <input type="number" className={ds.input} value={f.tempLow} onChange={(e) => setF({ ...f, tempLow: e.target.value })} />
              </Field>
            </div>
            <div>
              <label className={ds.label}>Manpower</label>
              {manpower.map((m, i) => (
                <div key={i} className="grid grid-cols-3 gap-2 mb-2">
                  <input className={ds.input} placeholder="Trade" value={m.trade}
                    onChange={(e) => setManpower(manpower.map((x, j) => j === i ? { ...x, trade: e.target.value } : x))} />
                  <input type="number" className={ds.input} placeholder="Workers" value={m.workers}
                    onChange={(e) => setManpower(manpower.map((x, j) => j === i ? { ...x, workers: e.target.value } : x))} />
                  <input type="number" className={ds.input} placeholder="Hours" value={m.hours}
                    onChange={(e) => setManpower(manpower.map((x, j) => j === i ? { ...x, hours: e.target.value } : x))} />
                </div>
              ))}
              <button onClick={() => setManpower([...manpower, { trade: 'General', workers: '', hours: '8' }])} className={ds.btnSecondary}>
                <Plus className="w-3 h-3" /> Add Trade
              </button>
            </div>
            <Field label="Equipment (comma separated)">
              <input className={ds.input} value={equipment} onChange={(e) => setEquipment(e.target.value)} />
            </Field>
            <Field label="Work Completed">
              <textarea className={ds.textarea} rows={2} value={f.workCompleted} onChange={(e) => setF({ ...f, workCompleted: e.target.value })} />
            </Field>
            <Field label="Delays / Issues">
              <textarea className={ds.textarea} rows={2} value={f.delays} onChange={(e) => setF({ ...f, delays: e.target.value })} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setCreateOpen(false)} className={ds.btnSecondary}>Cancel</button>
            <button onClick={create} className={ds.btnPrimary} disabled={!f.date}>Save Log</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// =========================================================================
// Punch list
// =========================================================================
function PunchTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState({ open: 0, ready: 0, closed: 0, total: 0, completionPct: 0 });
  const [createOpen, setCreateOpen] = useState(false);
  const [f, setF] = useState({ description: '', location: '', trade: 'General', assignee: '', priority: 'normal', dueDate: '', markup: '' });

  const load = useCallback(async () => {
    const r = await lensRun('construction', 'punch-list', {});
    if (r.data.ok && r.data.result) {
      setRows(r.data.result.items || []);
      setSummary({
        open: r.data.result.open || 0, ready: r.data.result.ready || 0,
        closed: r.data.result.closed || 0, total: r.data.result.total || 0,
        completionPct: r.data.result.completionPct || 0,
      });
    }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!f.description.trim()) return;
    await lensRun('construction', 'punch-add', { ...f });
    setF({ description: '', location: '', trade: 'General', assignee: '', priority: 'normal', dueDate: '', markup: '' });
    setCreateOpen(false);
    load();
  };
  const setStatus = async (id: string, status: string) => { await lensRun('construction', 'punch-update', { id, status }); load(); };
  const del = async (id: string) => { await lensRun('construction', 'punch-delete', { id }); load(); };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-3">
        <Stat label="Open" value={summary.open} tone="text-orange-400" />
        <Stat label="Ready" value={summary.ready} tone="text-yellow-400" />
        <Stat label="Closed" value={summary.closed} tone="text-emerald-400" />
        <Stat label="Complete" value={`${summary.completionPct}%`} tone="text-cyan-400" />
      </div>
      <div className="flex justify-end">
        <button onClick={() => setCreateOpen(true)} className={ds.btnPrimary}>
          <Plus className="w-4 h-4" /> Add Punch Item
        </button>
      </div>
      {rows.length === 0 ? (
        <div className={cn(ds.panel, 'text-center py-8')}>
          <ListChecks className="w-10 h-10 text-gray-600 mx-auto mb-2" />
          <p className={ds.textMuted}>No punch items yet</p>
        </div>
      ) : rows.map((p) => (
        <div key={p.id} className={ds.panel}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-white font-medium">#{p.number} · {p.description}</p>
              <div className="flex flex-wrap gap-2 mt-1 text-xs">
                {p.location && <span className="text-gray-500">{p.location}</span>}
                <span className="px-2 py-0.5 rounded-full bg-blue-400/20 text-blue-400">{p.trade}</span>
                {p.assignee && <span className="px-2 py-0.5 rounded-full bg-purple-400/20 text-purple-400">{p.assignee}</span>}
                <span className="px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-400">{p.priority}</span>
                {p.dueDate && <span className="text-gray-500">Due {p.dueDate}</span>}
              </div>
              {p.markup && <p className="text-xs text-gray-400 mt-1">Markup: {p.markup}</p>}
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <select
                className={cn(ds.select, 'text-xs py-1')}
                value={p.status}
                onChange={(e) => setStatus(p.id, e.target.value)}
              >
                {['open', 'in_progress', 'ready_to_verify', 'closed'].map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <button onClick={() => del(p.id)} className={ds.btnGhost} aria-label="Delete">
                <Trash2 className="w-4 h-4 text-red-400" />
              </button>
            </div>
          </div>
        </div>
      ))}

      {createOpen && (
        <Modal title="Add Punch Item" onClose={() => setCreateOpen(false)}>
          <div className="space-y-3">
            <Field label="Description">
              <textarea className={ds.textarea} rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Location">
                <input className={ds.input} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
              </Field>
              <Field label="Trade">
                <input className={ds.input} value={f.trade} onChange={(e) => setF({ ...f, trade: e.target.value })} />
              </Field>
              <Field label="Assignee">
                <input className={ds.input} value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })} />
              </Field>
              <Field label="Priority">
                <select className={ds.select} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
                  {['low', 'normal', 'high'].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Due Date">
                <input type="date" className={ds.input} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
              </Field>
            </div>
            <Field label="Photo Markup Note">
              <input className={ds.input} placeholder="markup annotation" value={f.markup} onChange={(e) => setF({ ...f, markup: e.target.value })} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setCreateOpen(false)} className={ds.btnSecondary}>Cancel</button>
            <button onClick={add} className={ds.btnPrimary} disabled={!f.description.trim()}>Add</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// =========================================================================
// Change orders
// =========================================================================
function ChangeOrdersTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState({ approvedValue: 0, pendingValue: 0, approvedCount: 0, pendingCount: 0 });
  const [createOpen, setCreateOpen] = useState(false);
  const [f, setF] = useState({ jobId: '', title: '', reason: '', description: '', amount: '', scheduleImpactDays: '' });

  const load = useCallback(async () => {
    const r = await lensRun('construction', 'changeorder-list', {});
    if (r.data.ok && r.data.result) {
      setRows(r.data.result.changeOrders || []);
      setSummary({
        approvedValue: r.data.result.approvedValue || 0, pendingValue: r.data.result.pendingValue || 0,
        approvedCount: r.data.result.approvedCount || 0, pendingCount: r.data.result.pendingCount || 0,
      });
    }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!f.title.trim() || !f.amount) return;
    await lensRun('construction', 'changeorder-create', {
      ...f, amount: Number(f.amount), scheduleImpactDays: f.scheduleImpactDays ? Number(f.scheduleImpactDays) : 0,
    });
    setF({ jobId: '', title: '', reason: '', description: '', amount: '', scheduleImpactDays: '' });
    setCreateOpen(false);
    load();
  };
  const decide = async (id: string, decision: string) => { await lensRun('construction', 'changeorder-decide', { id, decision }); load(); };
  const del = async (id: string) => { await lensRun('construction', 'changeorder-delete', { id }); load(); };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Stat label={`Approved (${summary.approvedCount})`} value={fmtMoney(summary.approvedValue)} tone="text-emerald-400" />
        <Stat label={`Pending (${summary.pendingCount})`} value={fmtMoney(summary.pendingValue)} tone="text-yellow-400" />
      </div>
      <div className="flex justify-end">
        <button onClick={() => setCreateOpen(true)} className={ds.btnPrimary}>
          <Plus className="w-4 h-4" /> New Change Order
        </button>
      </div>
      {rows.length === 0 ? (
        <div className={cn(ds.panel, 'text-center py-8')}>
          <FileSignature className="w-10 h-10 text-gray-600 mx-auto mb-2" />
          <p className={ds.textMuted}>No change orders yet</p>
        </div>
      ) : rows.map((c) => (
        <div key={c.id} className={ds.panel}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-white font-medium">
                <span className="text-neon-cyan mr-2">{c.number}</span>{c.title}
                <span className={cn('ml-2', c.amount >= 0 ? 'text-emerald-400' : 'text-red-400')}>{fmtMoney(c.amount)}</span>
              </p>
              {c.reason && <p className={ds.textMuted}>{c.reason}</p>}
              <div className="flex flex-wrap gap-2 mt-1 text-xs">
                <span className={cn('px-2 py-0.5 rounded-full',
                  c.status === 'approved' ? 'bg-emerald-400/20 text-emerald-400' :
                  c.status === 'rejected' ? 'bg-red-400/20 text-red-400' :
                  'bg-yellow-400/20 text-yellow-400')}>{c.status}</span>
                {c.scheduleImpactDays !== 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-orange-400/20 text-orange-400">
                    <Clock className="w-3 h-3 inline mr-1" />{c.scheduleImpactDays}d impact
                  </span>
                )}
                {c.decidedBy && <span className="text-gray-500">Decided by {c.decidedBy}</span>}
              </div>
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              {c.status === 'pending' && (
                <div className="flex gap-1">
                  <button onClick={() => decide(c.id, 'approved')} className={ds.btnGhost} aria-label="Approve">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  </button>
                  <button onClick={() => decide(c.id, 'rejected')} className={ds.btnGhost} aria-label="Reject">
                    <AlertCircle className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              )}
              <button onClick={() => del(c.id)} className={ds.btnGhost} aria-label="Delete">
                <Trash2 className="w-4 h-4 text-red-400" />
              </button>
            </div>
          </div>
        </div>
      ))}

      {createOpen && (
        <Modal title="New Change Order" onClose={() => setCreateOpen(false)}>
          <div className="space-y-3">
            <Field label="Title">
              <input className={ds.input} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount ($)">
                <input type="number" className={ds.input} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
              </Field>
              <Field label="Schedule Impact (days)">
                <input type="number" className={ds.input} value={f.scheduleImpactDays} onChange={(e) => setF({ ...f, scheduleImpactDays: e.target.value })} />
              </Field>
            </div>
            <Field label="Job ID (optional)">
              <input className={ds.input} value={f.jobId} onChange={(e) => setF({ ...f, jobId: e.target.value })} />
            </Field>
            <Field label="Reason">
              <input className={ds.input} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
            </Field>
            <Field label="Description">
              <textarea className={ds.textarea} rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setCreateOpen(false)} className={ds.btnSecondary}>Cancel</button>
            <button onClick={create} className={ds.btnPrimary} disabled={!f.title.trim() || !f.amount}>Create</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// =========================================================================
// Drawings / plan viewer
// =========================================================================
function DrawingsTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [disciplines, setDisciplines] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);
  const [f, setF] = useState({ sheetNumber: '', title: '', discipline: 'Architectural', notes: '' });
  const [markupNote, setMarkupNote] = useState('');
  const [reviseNote, setReviseNote] = useState('');
  const [cmp, setCmp] = useState<{ revA: string; revB: string } | null>(null);
  const [cmpResult, setCmpResult] = useState<any | null>(null);

  const load = useCallback(async () => {
    const r = await lensRun('construction', 'drawing-list', {});
    if (r.data.ok && r.data.result) {
      setRows(r.data.result.drawings || []);
      setDisciplines(r.data.result.disciplines || []);
    }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const refreshSelected = useCallback(async (id: string) => {
    const r = await lensRun('construction', 'drawing-list', {});
    if (r.data.ok && r.data.result) {
      const rs = r.data.result.drawings || [];
      setRows(rs);
      setDisciplines(r.data.result.disciplines || []);
      const found = rs.find((d: any) => d.id === id);
      if (found) setSelected(found);
    }
  }, []);

  const add = async () => {
    if (!f.sheetNumber.trim() || !f.title.trim()) return;
    await lensRun('construction', 'drawing-add', { ...f });
    setF({ sheetNumber: '', title: '', discipline: 'Architectural', notes: '' });
    setCreateOpen(false);
    load();
  };
  const revise = async () => {
    if (!selected) return;
    await lensRun('construction', 'drawing-revise', { id: selected.id, notes: reviseNote });
    setReviseNote('');
    refreshSelected(selected.id);
  };
  const markup = async () => {
    if (!selected || !markupNote.trim()) return;
    await lensRun('construction', 'drawing-markup', { id: selected.id, note: markupNote, author: 'Field' });
    setMarkupNote('');
    refreshSelected(selected.id);
  };
  const compare = async () => {
    if (!selected || !cmp) return;
    const r = await lensRun('construction', 'drawing-compare', { id: selected.id, revA: cmp.revA, revB: cmp.revB });
    if (r.data.ok) setCmpResult(r.data.result);
  };
  const del = async (id: string) => {
    await lensRun('construction', 'drawing-delete', { id });
    if (selected?.id === id) setSelected(null);
    load();
  };

  if (selected) {
    return (
      <div className="space-y-3">
        <button onClick={() => { setSelected(null); setCmpResult(null); setCmp(null); }} className={ds.btnSecondary}>
          ← Back to sheets
        </button>
        <div className={ds.panel}>
          <p className="text-white font-medium text-lg">
            <span className="text-neon-cyan mr-2">{selected.sheetNumber}</span>{selected.title}
          </p>
          <p className={ds.textMuted}>{selected.discipline} · Current revision {selected.currentRevision}</p>
          <div className="mt-3">
            <p className="text-xs font-semibold text-gray-300 mb-1">Revision History</p>
            {selected.revisions?.map((rev: any) => (
              <div key={rev.revision} className="flex items-center gap-2 text-xs text-gray-400 py-0.5">
                <span className="font-bold text-white w-6">{rev.revision}</span>
                <span className="text-gray-500">{(rev.date || '').slice(0, 10)}</span>
                <span>{rev.notes}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className={ds.panel}>
            <p className="text-sm font-semibold text-white mb-2">Issue Revision</p>
            <textarea className={ds.textarea} rows={2} placeholder="Revision notes" value={reviseNote} onChange={(e) => setReviseNote(e.target.value)} />
            <button onClick={revise} className={cn(ds.btnPrimary, 'mt-2')}>Issue Revision</button>
          </div>
          <div className={ds.panel}>
            <p className="text-sm font-semibold text-white mb-2">Add Markup</p>
            <input className={ds.input} placeholder="Markup note" value={markupNote} onChange={(e) => setMarkupNote(e.target.value)} />
            <button onClick={markup} className={cn(ds.btnPrimary, 'mt-2')} disabled={!markupNote.trim()}>Add Markup</button>
          </div>
        </div>

        <div className={ds.panel}>
          <p className="text-sm font-semibold text-white mb-2">Markups ({selected.markups?.length || 0})</p>
          {(selected.markups || []).length === 0 ? (
            <p className={ds.textMuted}>No markups on this sheet.</p>
          ) : selected.markups.map((m: any) => (
            <p key={m.id} className="text-xs text-gray-400 border-l-2 border-amber-500 pl-2 py-0.5">
              [rev {m.revision}] {m.author} @ ({m.x},{m.y}): {m.note}
            </p>
          ))}
        </div>

        {selected.revisions?.length > 1 && (
          <div className={ds.panel}>
            <p className="text-sm font-semibold text-white mb-2">Version Compare</p>
            <div className="flex gap-2 items-end">
              <Field label="Revision A">
                <select className={ds.select} value={cmp?.revA || ''} onChange={(e) => setCmp({ revA: e.target.value, revB: cmp?.revB || '' })}>
                  <option value="">—</option>
                  {selected.revisions.map((rev: any) => <option key={rev.revision} value={rev.revision}>{rev.revision}</option>)}
                </select>
              </Field>
              <Field label="Revision B">
                <select className={ds.select} value={cmp?.revB || ''} onChange={(e) => setCmp({ revA: cmp?.revA || '', revB: e.target.value })}>
                  <option value="">—</option>
                  {selected.revisions.map((rev: any) => <option key={rev.revision} value={rev.revision}>{rev.revision}</option>)}
                </select>
              </Field>
              <button onClick={compare} className={ds.btnPrimary} disabled={!cmp?.revA || !cmp?.revB}>Compare</button>
            </div>
            {cmpResult && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="border border-lattice-border rounded-lg p-2">
                  <p className="text-xs font-bold text-white">Rev {cmpResult.revA?.revision}</p>
                  <p className="text-xs text-gray-500">{(cmpResult.revA?.date || '').slice(0, 10)} · {cmpResult.revA?.notes}</p>
                  <p className="text-xs text-amber-400 mt-1">{cmpResult.markupsOnA?.length || 0} markups</p>
                </div>
                <div className="border border-lattice-border rounded-lg p-2">
                  <p className="text-xs font-bold text-white">Rev {cmpResult.revB?.revision}</p>
                  <p className="text-xs text-gray-500">{(cmpResult.revB?.date || '').slice(0, 10)} · {cmpResult.revB?.notes}</p>
                  <p className="text-xs text-amber-400 mt-1">{cmpResult.markupsOnB?.length || 0} markups</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {disciplines.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {disciplines.map((d) => (
            <span key={d} className="px-2 py-1 rounded-full text-xs bg-lattice-elevated border border-lattice-border text-gray-300">{d}</span>
          ))}
        </div>
      )}
      <div className="flex justify-end">
        <button onClick={() => setCreateOpen(true)} className={ds.btnPrimary}>
          <Plus className="w-4 h-4" /> Add Sheet
        </button>
      </div>
      {rows.length === 0 ? (
        <div className={cn(ds.panel, 'text-center py-8')}>
          <Layers className="w-10 h-10 text-gray-600 mx-auto mb-2" />
          <p className={ds.textMuted}>No drawing sheets yet</p>
        </div>
      ) : rows.map((d) => (
        <div key={d.id} className={ds.panelHover} onClick={() => setSelected(d)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-white font-medium">
                <span className="text-neon-cyan mr-2">{d.sheetNumber}</span>{d.title}
              </p>
              <p className={ds.textMuted}>
                {d.discipline} · rev {d.currentRevision} · {d.markups?.length || 0} markups
              </p>
            </div>
            <button onClick={(e) => { e.stopPropagation(); del(d.id); }} className={ds.btnGhost} aria-label="Delete">
              <Trash2 className="w-4 h-4 text-red-400" />
            </button>
          </div>
        </div>
      ))}

      {createOpen && (
        <Modal title="Add Drawing Sheet" onClose={() => setCreateOpen(false)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Sheet Number">
                <input className={ds.input} placeholder="A-101" value={f.sheetNumber} onChange={(e) => setF({ ...f, sheetNumber: e.target.value })} />
              </Field>
              <Field label="Discipline">
                <select className={ds.select} value={f.discipline} onChange={(e) => setF({ ...f, discipline: e.target.value })}>
                  {['Architectural', 'Structural', 'Mechanical', 'Electrical', 'Plumbing', 'Civil', 'Landscape'].map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Title">
              <input className={ds.input} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            </Field>
            <Field label="Issue Notes">
              <input className={ds.input} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setCreateOpen(false)} className={ds.btnSecondary}>Cancel</button>
            <button onClick={add} className={ds.btnPrimary} disabled={!f.sheetNumber.trim() || !f.title.trim()}>Add</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// =========================================================================
// Budget vs actual
// =========================================================================
function BudgetTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [totals, setTotals] = useState({ totalBudget: 0, totalCommitted: 0, totalActual: 0, forecastAtCompletion: 0, variance: 0, status: '' });
  const [createOpen, setCreateOpen] = useState(false);
  const [f, setF] = useState({ costCode: '', description: '', category: 'General', budgetAmount: '', committed: '', actual: '' });

  const load = useCallback(async () => {
    const r = await lensRun('construction', 'budget-list', {});
    if (r.data.ok && r.data.result) {
      setRows(r.data.result.lines || []);
      setTotals({
        totalBudget: r.data.result.totalBudget || 0, totalCommitted: r.data.result.totalCommitted || 0,
        totalActual: r.data.result.totalActual || 0, forecastAtCompletion: r.data.result.forecastAtCompletion || 0,
        variance: r.data.result.variance || 0, status: r.data.result.status || '',
      });
    }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!f.costCode.trim() || !f.description.trim() || !f.budgetAmount) return;
    await lensRun('construction', 'budget-add', {
      ...f, budgetAmount: Number(f.budgetAmount),
      committed: f.committed ? Number(f.committed) : 0, actual: f.actual ? Number(f.actual) : 0,
    });
    setF({ costCode: '', description: '', category: 'General', budgetAmount: '', committed: '', actual: '' });
    setCreateOpen(false);
    load();
  };
  const updateLine = async (id: string, field: 'committed' | 'actual', value: string) => {
    await lensRun('construction', 'budget-update', { id, [field]: Number(value) || 0 });
    load();
  };
  const del = async (id: string) => { await lensRun('construction', 'budget-delete', { id }); load(); };

  const chartData = useMemo(
    () => rows.map((r) => ({ code: r.costCode, Budget: r.budgetAmount, Committed: r.committed, Actual: r.actual })),
    [rows],
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total Budget" value={fmtMoney(totals.totalBudget)} />
        <Stat label="Committed" value={fmtMoney(totals.totalCommitted)} tone="text-blue-400" />
        <Stat label="Forecast at Completion" value={fmtMoney(totals.forecastAtCompletion)} tone="text-yellow-400" />
        <Stat
          label={totals.status || 'Variance'}
          value={fmtMoney(totals.variance)}
          tone={totals.variance >= 0 ? 'text-emerald-400' : 'text-red-400'}
        />
      </div>
      {chartData.length > 0 && (
        <div className={ds.panel}>
          <p className="text-sm font-semibold text-white mb-2">Budget vs Committed vs Actual</p>
          <ChartKit
            kind="bar"
            data={chartData}
            xKey="code"
            series={[
              { key: 'Budget', color: '#6366f1' },
              { key: 'Committed', color: '#06b6d4' },
              { key: 'Actual', color: '#f59e0b' },
            ]}
            height={220}
          />
        </div>
      )}
      <div className="flex justify-end">
        <button onClick={() => setCreateOpen(true)} className={ds.btnPrimary}>
          <Plus className="w-4 h-4" /> Add Cost Line
        </button>
      </div>
      {rows.length === 0 ? (
        <div className={cn(ds.panel, 'text-center py-8')}>
          <Wallet className="w-10 h-10 text-gray-600 mx-auto mb-2" />
          <p className={ds.textMuted}>No budget lines yet</p>
        </div>
      ) : rows.map((l) => {
        const over = (l.actual || 0) > (l.budgetAmount || 0);
        return (
          <div key={l.id} className={ds.panel}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-white font-medium">
                  <span className="text-neon-cyan mr-2">{l.costCode}</span>{l.description}
                  {over && <span className="ml-2 text-xs text-red-400">OVER BUDGET</span>}
                </p>
                <p className={ds.textMuted}>{l.category} · Budget {fmtMoney(l.budgetAmount)}</p>
                <div className="grid grid-cols-2 gap-2 mt-2 max-w-xs">
                  <Field label="Committed">
                    <input
                      type="number" className={cn(ds.input, 'text-xs py-1')}
                      defaultValue={l.committed}
                      onBlur={(e) => updateLine(l.id, 'committed', e.target.value)}
                    />
                  </Field>
                  <Field label="Actual">
                    <input
                      type="number" className={cn(ds.input, 'text-xs py-1')}
                      defaultValue={l.actual}
                      onBlur={(e) => updateLine(l.id, 'actual', e.target.value)}
                    />
                  </Field>
                </div>
              </div>
              <button onClick={() => del(l.id)} className={ds.btnGhost} aria-label="Delete">
                <Trash2 className="w-4 h-4 text-red-400" />
              </button>
            </div>
          </div>
        );
      })}

      {createOpen && (
        <Modal title="Add Cost Line" onClose={() => setCreateOpen(false)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cost Code">
                <input className={ds.input} placeholder="03-300" value={f.costCode} onChange={(e) => setF({ ...f, costCode: e.target.value })} />
              </Field>
              <Field label="Category">
                <input className={ds.input} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
              </Field>
            </div>
            <Field label="Description">
              <input className={ds.input} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Budget ($)">
                <input type="number" className={ds.input} value={f.budgetAmount} onChange={(e) => setF({ ...f, budgetAmount: e.target.value })} />
              </Field>
              <Field label="Committed ($)">
                <input type="number" className={ds.input} value={f.committed} onChange={(e) => setF({ ...f, committed: e.target.value })} />
              </Field>
              <Field label="Actual ($)">
                <input type="number" className={ds.input} value={f.actual} onChange={(e) => setF({ ...f, actual: e.target.value })} />
              </Field>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setCreateOpen(false)} className={ds.btnSecondary}>Cancel</button>
            <button onClick={add} className={ds.btnPrimary} disabled={!f.costCode.trim() || !f.description.trim() || !f.budgetAmount}>Add</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// =========================================================================
// Gantt schedule
// =========================================================================
interface GanttTaskRow { name: string; duration: string; dependencies: string }
function GanttTab() {
  const [taskRows, setTaskRows] = useState<GanttTaskRow[]>([
    { name: 'Excavate', duration: '5', dependencies: '' },
    { name: 'Foundation', duration: '10', dependencies: 'Excavate' },
    { name: 'Framing', duration: '15', dependencies: 'Foundation' },
  ]);
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    const tasks = taskRows
      .filter((t) => t.name.trim())
      .map((t) => ({
        name: t.name.trim(),
        duration: Number(t.duration) || 1,
        dependencies: t.dependencies.split(',').map((d) => d.trim()).filter(Boolean),
      }));
    const r = await lensRun('construction', 'ganttSchedule', { tasks, startDate });
    if (r.data.ok) setResult(r.data.result);
    setLoading(false);
  };

  const bars: any[] = result?.bars || [];
  const maxDay = bars.length > 0 ? Math.max(...bars.map((b) => b.endDay)) : 1;

  return (
    <div className="space-y-3">
      <div className={ds.panel}>
        <p className="text-sm font-semibold text-white mb-2">Schedule Tasks</p>
        {taskRows.map((t, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 mb-2 items-center">
            <input className={cn(ds.input, 'col-span-4')} placeholder="Task name" value={t.name}
              onChange={(e) => setTaskRows(taskRows.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
            <input type="number" className={cn(ds.input, 'col-span-2')} placeholder="Days" value={t.duration}
              onChange={(e) => setTaskRows(taskRows.map((x, j) => j === i ? { ...x, duration: e.target.value } : x))} />
            <input className={cn(ds.input, 'col-span-5')} placeholder="Depends on (comma)" value={t.dependencies}
              onChange={(e) => setTaskRows(taskRows.map((x, j) => j === i ? { ...x, dependencies: e.target.value } : x))} />
            <button
              onClick={() => setTaskRows(taskRows.filter((_, j) => j !== i))}
              className={cn(ds.btnGhost, 'col-span-1')} aria-label="Remove task"
            >
              <X className="w-4 h-4 text-red-400" />
            </button>
          </div>
        ))}
        <div className="flex items-end gap-2 mt-2">
          <button onClick={() => setTaskRows([...taskRows, { name: '', duration: '1', dependencies: '' }])} className={ds.btnSecondary}>
            <Plus className="w-3 h-3" /> Add Task
          </button>
          <Field label="Start Date">
            <input type="date" className={ds.input} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <button onClick={run} className={ds.btnPrimary} disabled={loading}>
            {loading ? 'Computing…' : 'Build Schedule'}
          </button>
        </div>
      </div>

      {result && bars.length > 0 && (
        <div className={ds.panel}>
          <div className="flex items-center gap-4 mb-3 text-sm">
            <span className="text-white font-semibold">{result.projectDuration} day project</span>
            <span className="text-red-400">Critical path: {result.criticalPath?.join(' → ')}</span>
          </div>
          <div className="space-y-2">
            {bars.map((b) => (
              <div key={b.id} className="flex items-center gap-2">
                <span className="w-32 shrink-0 text-xs text-gray-300 truncate" title={b.name}>{b.name}</span>
                <div className="flex-1 relative h-6 bg-lattice-elevated rounded">
                  <div
                    className={cn(
                      'absolute h-6 rounded flex items-center px-2 text-[10px] text-white',
                      b.onCriticalPath ? 'bg-red-500/80' : 'bg-indigo-500/80',
                    )}
                    style={{
                      left: `${(b.startDay / maxDay) * 100}%`,
                      width: `${Math.max(((b.endDay - b.startDay) / maxDay) * 100, 4)}%`,
                    }}
                  >
                    {b.duration}d
                  </div>
                </div>
                <span className="w-24 shrink-0 text-[10px] text-gray-500">
                  {b.startDate}
                </span>
                <span className="w-12 shrink-0 text-[10px] text-gray-500">
                  {b.slack > 0 ? `+${b.slack}d` : 'crit'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {result && bars.length === 0 && (
        <div className={cn(ds.panel, 'text-center py-6')}>
          <p className={ds.textMuted}>{result.message || 'Add tasks to build a schedule.'}</p>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// Panel shell
// =========================================================================
export function FieldManagementPanel() {
  const [tab, setTab] = useState<FieldTab>('rfi');
  return (
    <div data-lens-theme="construction" className={cn(ds.panel, 'p-4')}>
      <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
        <ListChecks className="w-4 h-4 text-neon-cyan" /> Field Management
        <span className="text-xs text-gray-500 font-normal">RFIs · Submittals · Logs · Punch · COs · Drawings · Budget · Gantt</span>
      </h3>
      <nav className="flex items-center gap-1 border-b border-lattice-border pb-3 mb-3 flex-wrap">
        {FIELD_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors whitespace-nowrap',
              tab === t.id ? 'bg-neon-blue/20 text-neon-blue' : 'text-gray-400 hover:text-white hover:bg-lattice-elevated',
            )}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'rfi' && <RfiTab />}
      {tab === 'submittals' && <SubmittalsTab />}
      {tab === 'dailylog' && <DailyLogTab />}
      {tab === 'punch' && <PunchTab />}
      {tab === 'changeorders' && <ChangeOrdersTab />}
      {tab === 'drawings' && <DrawingsTab />}
      {tab === 'budget' && <BudgetTab />}
      {tab === 'gantt' && <GanttTab />}
    </div>
  );
}
