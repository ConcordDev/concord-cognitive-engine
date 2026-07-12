'use client';

/**
 * HrCompliancePanel — compliance document acknowledgement workflow, plus
 * I-9 / E-Verify employment-eligibility tracking (a distinct compliance
 * obligation, same STATE-backed `hr` domain, following the compliance-doc-*
 * macro shape: employee-scoped records, explicit-enum validation, org-wide
 * + per-employee status rollups).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Plus, FileCheck, ChevronLeft, Fingerprint, ShieldCheck,
  ShieldAlert, ShieldX, Clock, Paperclip,
} from 'lucide-react';
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

type I9DocumentType =
  | 'us_passport' | 'permanent_resident_card' | 'employment_authorization_document'
  | 'drivers_license_ssn_card' | 'state_id_ssn_card' | 'foreign_passport_i94' | 'other';
type I9Status = 'pending' | 'verified' | 'rejected' | 'expired';
type EverifyStatus =
  | 'not_submitted' | 'pending' | 'employment_authorized'
  | 'tentative_nonconfirmation' | 'final_nonconfirmation' | 'closed';

interface I9Record {
  id: string; employeeId: string; employeeName: string;
  documentType: I9DocumentType; documentIdentifier: string | null;
  status: I9Status; expirationDate: string | null; daysUntilExpiration: number | null;
  everifyCaseNumber: string | null; everifyStatus: EverifyStatus;
  rejectionReason: string | null; attachedDocumentIds: string[];
}
interface I9Summary {
  activeEmployees: number; verified: number; missing: number; overdue: number; compliancePct: number;
}

const I9_DOCUMENT_TYPES: { value: I9DocumentType; label: string; alwaysExpires?: boolean }[] = [
  { value: 'us_passport', label: 'U.S. Passport' },
  { value: 'permanent_resident_card', label: 'Permanent Resident Card' },
  { value: 'employment_authorization_document', label: 'Employment Authorization Document (EAD)', alwaysExpires: true },
  { value: 'drivers_license_ssn_card', label: "Driver's License + SSN Card" },
  { value: 'state_id_ssn_card', label: 'State ID + SSN Card' },
  { value: 'foreign_passport_i94', label: 'Foreign Passport + Form I-94', alwaysExpires: true },
  { value: 'other', label: 'Other' },
];
const I9_DOC_LABEL = new Map(I9_DOCUMENT_TYPES.map((d) => [d.value, d.label]));
const EVERIFY_STATUSES: { value: EverifyStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'employment_authorized', label: 'Employment Authorized' },
  { value: 'tentative_nonconfirmation', label: 'Tentative Nonconfirmation' },
  { value: 'final_nonconfirmation', label: 'Final Nonconfirmation' },
  { value: 'closed', label: 'Closed' },
];
const I9_STATUS_STYLE: Record<I9Status, string> = {
  pending: 'bg-amber-900/40 text-amber-300 border-amber-800/60',
  verified: 'bg-emerald-900/40 text-emerald-300 border-emerald-800/60',
  rejected: 'bg-rose-900/40 text-rose-300 border-rose-800/60',
  expired: 'bg-zinc-800/60 text-zinc-400 border-zinc-700/60',
};
const I9_STATUS_ICON: Record<I9Status, typeof ShieldCheck> = {
  pending: ShieldAlert, verified: ShieldCheck, rejected: ShieldX, expired: Clock,
};

export function HrCompliancePanel() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [docs, setDocs] = useState<ComplianceDoc[]>([]);
  const [orgPct, setOrgPct] = useState(100);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', category: '', version: '', body: '', dueDate: '' });
  const [statusFor, setStatusFor] = useState('');
  const [statusRows, setStatusRows] = useState<StatusRow[]>([]);

  // I-9 / E-Verify
  const [i9Records, setI9Records] = useState<I9Record[]>([]);
  const [i9Summary, setI9Summary] = useState<I9Summary | null>(null);
  const [i9Form, setI9Form] = useState({ employeeId: '', documentType: 'us_passport' as I9DocumentType, documentIdentifier: '', expirationDate: '' });
  const [everifyOpenFor, setEverifyOpenFor] = useState<string | null>(null);
  const [everifyForm, setEverifyForm] = useState({ caseNumber: '', status: 'pending' as EverifyStatus });
  const [rejectOpenFor, setRejectOpenFor] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [attachOpenFor, setAttachOpenFor] = useState<string | null>(null);
  const [attachTitle, setAttachTitle] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const [e, d, st, i9l, i9s] = await Promise.all([
      lensRun('hr', 'employee-list', {}),
      lensRun('hr', 'compliance-doc-list', {}),
      lensRun('hr', 'compliance-status', {}),
      lensRun('hr', 'i9-list', {}),
      lensRun('hr', 'i9-status', {}),
    ]);
    setEmployees((e.data?.result?.employees as Employee[]) || []);
    setDocs((d.data?.result?.documents as ComplianceDoc[]) || []);
    setOrgPct((st.data?.result?.compliancePct as number) ?? 100);
    setI9Records((i9l.data?.result?.records as I9Record[]) || []);
    setI9Summary((i9s.data?.result as I9Summary) || null);
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

  // ── I-9 / E-Verify actions ─────────────────────────────────────────
  const addI9 = async () => {
    if (!i9Form.employeeId) { setError('Select an employee for the I-9 record.'); return; }
    const r = await lensRun('hr', 'i9-add', {
      employeeId: i9Form.employeeId, documentType: i9Form.documentType,
      documentIdentifier: i9Form.documentIdentifier.trim() || undefined,
      expirationDate: i9Form.expirationDate || undefined,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setI9Form({ employeeId: '', documentType: 'us_passport', documentIdentifier: '', expirationDate: '' });
    setError(null);
    await refresh();
  };
  const verifyI9 = async (id: string) => {
    const r = await lensRun('hr', 'i9-verify', { id });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setError(null);
    await refresh();
  };
  const submitReject = async (id: string) => {
    const r = await lensRun('hr', 'i9-reject', { id, reason: rejectReason.trim() || undefined });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setRejectOpenFor(null);
    setRejectReason('');
    setError(null);
    await refresh();
  };
  const submitEverify = async (id: string) => {
    if (!everifyForm.caseNumber.trim()) { setError('E-Verify case number is required.'); return; }
    const r = await lensRun('hr', 'i9-everify-submit', { id, caseNumber: everifyForm.caseNumber.trim(), status: everifyForm.status });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setEverifyOpenFor(null);
    setEverifyForm({ caseNumber: '', status: 'pending' });
    setError(null);
    await refresh();
  };
  const submitAttach = async (id: string) => {
    if (!attachTitle.trim()) { setError('Supporting-document title is required.'); return; }
    const r = await lensRun('hr', 'i9-document-attach', { id, title: attachTitle.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setAttachOpenFor(null);
    setAttachTitle('');
    setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
        <p className={cn('text-lg font-bold', orgPct >= 100 ? 'text-emerald-400' : orgPct >= 70 ? 'text-amber-400' : 'text-rose-400')}>{orgPct}%</p>
        <p className="text-[10px] text-zinc-400 uppercase tracking-wide">Org-wide acknowledgement</p>
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
          <p className="text-[11px] text-zinc-400 italic">No compliance documents published yet.</p>
        ) : (
          <ul className="space-y-1">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <FileCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <div>
                    <p className="text-xs text-zinc-100">{d.title} <span className="text-zinc-400">v{d.version}</span></p>
                    <p className="text-[10px] text-zinc-400">{d.category}{d.dueDate ? ` · due ${d.dueDate}` : ''}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-zinc-200">{d.acknowledgedCount} acked</p>
                  <p className="text-[10px] text-zinc-400">{d.pendingCount} pending · {d.acknowledgedRate}%</p>
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
              className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-300">
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
            <p className="text-[11px] text-zinc-400 italic mt-2">No documents to acknowledge.</p>
          ) : (
            <ul className="space-y-1 mt-2">
              {statusRows.map((row) => (
                <li key={`${row.docId}-${row.version}`}
                  className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-xs text-zinc-200">{row.title} <span className="text-zinc-400">v{row.version}</span></p>
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

      {/* I-9 / E-Verify employment eligibility */}
      <section className="border-t border-zinc-800 pt-4">
        <div className="flex items-center gap-2 mb-2">
          <Fingerprint className="w-3.5 h-3.5 text-sky-400" />
          <h3 className="text-xs font-semibold text-zinc-300">I-9 / Employment Eligibility (E-Verify)</h3>
        </div>

        {i9Summary && (
          <div className="grid grid-cols-4 gap-2 mb-3">
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
              <p className={cn('text-base font-bold', i9Summary.compliancePct >= 100 ? 'text-emerald-400' : i9Summary.compliancePct >= 70 ? 'text-amber-400' : 'text-rose-400')}>{i9Summary.compliancePct}%</p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">Verified</p>
            </div>
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
              <p className="text-base font-bold text-zinc-200">{i9Summary.missing}</p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">Missing I-9</p>
            </div>
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
              <p className={cn('text-base font-bold', i9Summary.overdue > 0 ? 'text-rose-400' : 'text-zinc-200')}>{i9Summary.overdue}</p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">Overdue (&gt;3 days)</p>
            </div>
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
              <p className="text-base font-bold text-zinc-200">{i9Summary.activeEmployees}</p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">Active employees</p>
            </div>
          </div>
        )}

        {/* Track a new I-9 */}
        <div className="grid grid-cols-4 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 mb-3">
          <select value={i9Form.employeeId} onChange={(e) => setI9Form({ ...i9Form, employeeId: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            <option value="">Employee…</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <select value={i9Form.documentType}
            onChange={(e) => setI9Form({ ...i9Form, documentType: e.target.value as I9DocumentType })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {I9_DOCUMENT_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
          <input placeholder="Document #" value={i9Form.documentIdentifier}
            onChange={(e) => setI9Form({ ...i9Form, documentIdentifier: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input type="date" value={i9Form.expirationDate}
            title="Expiration date (required for documents that expire, e.g. an EAD)"
            onChange={(e) => setI9Form({ ...i9Form, expirationDate: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <div className="col-span-3" />
          <button type="button" onClick={addI9}
            className="flex items-center justify-center gap-1 bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">
            <Plus className="w-3.5 h-3.5" /> Track I-9
          </button>
        </div>

        {/* I-9 roster */}
        {i9Records.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No I-9 records tracked yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {i9Records.map((r) => {
              const StatusIcon = I9_STATUS_ICON[r.status];
              return (
                <li key={r.id} className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <StatusIcon className="w-3.5 h-3.5 text-zinc-400" />
                      <div>
                        <p className="text-xs text-zinc-100">{r.employeeName}</p>
                        <p className="text-[10px] text-zinc-400">
                          {I9_DOC_LABEL.get(r.documentType) || r.documentType}
                          {r.expirationDate ? ` · expires ${r.expirationDate}${r.daysUntilExpiration != null ? ` (${r.daysUntilExpiration}d)` : ''}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn('text-[10px] px-2 py-0.5 rounded border capitalize', I9_STATUS_STYLE[r.status])}>{r.status}</span>
                      {r.everifyStatus !== 'not_submitted' && (
                        <span className="text-[10px] px-2 py-0.5 rounded border border-sky-800/60 bg-sky-900/30 text-sky-300 capitalize">
                          E-Verify: {r.everifyStatus.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>
                  </div>
                  {r.rejectionReason && <p className="text-[10px] text-rose-400 mt-1">Reason: {r.rejectionReason}</p>}
                  <div className="flex items-center flex-wrap gap-1.5 mt-2">
                    {r.status === 'pending' && (
                      <button type="button" onClick={() => verifyI9(r.id)}
                        className="text-[10px] px-2 py-1 rounded bg-emerald-700/30 text-emerald-300 hover:bg-emerald-700/50">
                        Verify
                      </button>
                    )}
                    {(r.status === 'pending' || r.status === 'verified') && (
                      <button type="button" onClick={() => setRejectOpenFor(rejectOpenFor === r.id ? null : r.id)}
                        className="text-[10px] px-2 py-1 rounded bg-rose-700/30 text-rose-300 hover:bg-rose-700/50">
                        Reject
                      </button>
                    )}
                    {r.status === 'verified' && (
                      <button type="button" onClick={() => setEverifyOpenFor(everifyOpenFor === r.id ? null : r.id)}
                        className="text-[10px] px-2 py-1 rounded bg-sky-700/30 text-sky-300 hover:bg-sky-700/50">
                        E-Verify case…
                      </button>
                    )}
                    <button type="button" onClick={() => setAttachOpenFor(attachOpenFor === r.id ? null : r.id)}
                      className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700">
                      <Paperclip className="w-3 h-3" /> {r.attachedDocumentIds.length > 0 ? `${r.attachedDocumentIds.length} attached` : 'Attach doc'}
                    </button>
                  </div>
                  {rejectOpenFor === r.id && (
                    <div className="flex items-center gap-1.5 mt-2">
                      <input placeholder="Rejection reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                        className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[10px] text-zinc-100" />
                      <button type="button" onClick={() => submitReject(r.id)}
                        className="text-[10px] px-2 py-1 rounded bg-rose-600 text-white hover:bg-rose-500">Confirm</button>
                    </div>
                  )}
                  {everifyOpenFor === r.id && (
                    <div className="flex items-center gap-1.5 mt-2">
                      <input placeholder="E-Verify case #" value={everifyForm.caseNumber}
                        onChange={(e) => setEverifyForm({ ...everifyForm, caseNumber: e.target.value })}
                        className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[10px] text-zinc-100" />
                      <select value={everifyForm.status}
                        onChange={(e) => setEverifyForm({ ...everifyForm, status: e.target.value as EverifyStatus })}
                        className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[10px] text-zinc-100">
                        {EVERIFY_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                      <button type="button" onClick={() => submitEverify(r.id)}
                        className="text-[10px] px-2 py-1 rounded bg-sky-600 text-white hover:bg-sky-500">Submit</button>
                    </div>
                  )}
                  {attachOpenFor === r.id && (
                    <div className="flex items-center gap-1.5 mt-2">
                      <input placeholder="Supporting document title" value={attachTitle} onChange={(e) => setAttachTitle(e.target.value)}
                        className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[10px] text-zinc-100" />
                      <button type="button" onClick={() => submitAttach(r.id)}
                        className="text-[10px] px-2 py-1 rounded bg-zinc-700 text-zinc-100 hover:bg-zinc-600">Attach</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
