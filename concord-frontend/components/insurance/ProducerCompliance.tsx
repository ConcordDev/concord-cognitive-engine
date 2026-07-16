'use client';

/**
 * ProducerCompliance — CE-credit progress, license renewal dates, E&O
 * insurance status, and carrier-appointment tracking for the agency's real
 * producer/agent roster. Closes the "Producer compliance tracking" gap
 * (docs/lens-specs/insurance-capability-map.md): no backend macro tracked
 * any of this before `insurance.producer-compliance-*`
 * (server/domains/insurance.js).
 *
 * A "producer" in this codebase IS the existing agent/broker roster
 * (agent-add / agent-list) — there is no separate producer entity, so the
 * agent picker below is sourced live from `insurance.agent-list`, never
 * free text. The category select genuinely changes the form: a CE-credit
 * record tracks progress toward a requirement (with a live progress bar),
 * a license/E&O/appointment record tracks a single expiring credential —
 * these are NOT forced into one generic field set. Status badges
 * (overdue / due soon / scheduled) are read-time-derived by the backend,
 * never stored, mirroring this session's plumbing/masonry/landscaping
 * certification-expiry precedent.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Pencil, X, GraduationCap, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type ComplianceCategory = 'ce_credits' | 'license_renewal' | 'eo_insurance' | 'carrier_appointment';
type ComplianceStatus = 'overdue' | 'due_soon' | 'scheduled' | 'none';

interface Agent {
  id: string;
  name: string;
}

interface ComplianceRecord {
  id: string;
  agentId: string;
  agentName: string | null;
  agentFound: boolean;
  category: ComplianceCategory;
  notes: string | null;
  status: ComplianceStatus;
  expiryDate?: string | null;
  // ce_credits
  periodLabel?: string;
  creditsCompleted?: number;
  creditsRequired?: number;
  creditsPercent?: number;
  creditsComplete?: boolean;
  // license_renewal
  licenseNumber?: string;
  state?: string;
  // eo_insurance
  carrier?: string;
  policyNumber?: string;
  // carrier_appointment
  carrierName?: string;
  appointmentNumber?: string | null;
  createdAt: string;
  updatedAt: string;
}

const CATEGORIES: { id: ComplianceCategory; label: string }[] = [
  { id: 'ce_credits', label: 'CE Credits' },
  { id: 'license_renewal', label: 'License Renewal' },
  { id: 'eo_insurance', label: 'E&O Insurance' },
  { id: 'carrier_appointment', label: 'Carrier Appointment' },
];

const CATEGORY_LABEL: Record<ComplianceCategory, string> = {
  ce_credits: 'CE Credits',
  license_renewal: 'License Renewal',
  eo_insurance: 'E&O Insurance',
  carrier_appointment: 'Carrier Appointment',
};

const STATUS_LABEL: Record<ComplianceStatus, string> = {
  overdue: 'Overdue',
  due_soon: 'Due soon',
  scheduled: 'Scheduled',
  none: 'No deadline',
};

// overdue=red, due_soon=amber, scheduled=neutral — a licensing-compliance
// risk panel, so overdue must read as unambiguously urgent.
const STATUS_BADGE: Record<ComplianceStatus, string> = {
  overdue: 'bg-red-500/20 text-red-300 border border-red-500/30',
  due_soon: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  scheduled: 'bg-white/10 text-gray-300 border border-white/10',
  none: 'bg-white/5 text-gray-500 border border-white/5',
};

const inputCls = 'px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white text-xs w-full';
const btnPrimary = 'px-3 py-1.5 rounded bg-cyan-500 text-black text-xs font-bold hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5';
const btnGhost = 'px-2 py-1 rounded text-[11px] text-gray-300 hover:text-white hover:bg-white/5 inline-flex items-center gap-1';

interface FormState {
  agentId: string;
  category: ComplianceCategory;
  periodLabel: string;
  creditsCompleted: string;
  creditsRequired: string;
  licenseNumber: string;
  state: string;
  carrier: string;
  policyNumber: string;
  carrierName: string;
  appointmentNumber: string;
  expiryDate: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  agentId: '', category: 'ce_credits',
  periodLabel: '', creditsCompleted: '', creditsRequired: '',
  licenseNumber: '', state: '',
  carrier: '', policyNumber: '',
  carrierName: '', appointmentNumber: '',
  expiryDate: '', notes: '',
};

function fmtPct(n: number | undefined) { return typeof n === 'number' ? `${n}%` : '—'; }

export function ProducerCompliance() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [records, setRecords] = useState<ComplianceRecord[]>([]);
  const [overdueCount, setOverdueCount] = useState(0);
  const [dueSoonCount, setDueSoonCount] = useState(0);
  const [byCategory, setByCategory] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterAgentId, setFilterAgentId] = useState('');

  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<FormState>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [ag, list] = await Promise.all([
        lensRun('insurance', 'agent-list', {}),
        lensRun<{
          records: ComplianceRecord[]; overdueCount: number; dueSoonCount: number; byCategory: Record<string, number>;
        }>('insurance', 'producer-compliance-list', filterAgentId ? { agentId: filterAgentId } : {}),
      ]);
      if (ag.data?.ok) setAgents(((ag.data.result as { agents?: Agent[] } | null)?.agents) || []);
      if (list.data?.ok && list.data.result) {
        setRecords(list.data.result.records || []);
        setOverdueCount(list.data.result.overdueCount || 0);
        setDueSoonCount(list.data.result.dueSoonCount || 0);
        setByCategory(list.data.result.byCategory || {});
      }
    } catch (e) {
      console.error('[ProducerCompliance] refresh', e);
    } finally {
      setLoading(false);
    }
  }, [filterAgentId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function addRecord() {
    setError(null);
    if (!form.agentId) { setError('Select a producer first.'); return; }
    const params: Record<string, unknown> = {
      agentId: form.agentId, category: form.category,
      notes: form.notes.trim() || undefined,
    };
    if (form.category === 'ce_credits') {
      if (!form.periodLabel.trim()) { setError('Period label is required for CE credits.'); return; }
      params.periodLabel = form.periodLabel.trim();
      if (form.creditsCompleted) params.creditsCompleted = Number(form.creditsCompleted);
      if (form.creditsRequired) params.creditsRequired = Number(form.creditsRequired);
      if (form.expiryDate) params.expiryDate = form.expiryDate;
    } else if (form.category === 'license_renewal') {
      if (!form.licenseNumber.trim()) { setError('License number is required.'); return; }
      if (!form.state.trim()) { setError('State is required.'); return; }
      if (!form.expiryDate) { setError('Expiry date is required.'); return; }
      params.licenseNumber = form.licenseNumber.trim();
      params.state = form.state.trim();
      params.expiryDate = form.expiryDate;
    } else if (form.category === 'eo_insurance') {
      if (!form.carrier.trim()) { setError('E&O carrier is required.'); return; }
      if (!form.policyNumber.trim()) { setError('Policy number is required.'); return; }
      if (!form.expiryDate) { setError('Expiry date is required.'); return; }
      params.carrier = form.carrier.trim();
      params.policyNumber = form.policyNumber.trim();
      params.expiryDate = form.expiryDate;
    } else if (form.category === 'carrier_appointment') {
      if (!form.carrierName.trim()) { setError('Carrier name is required.'); return; }
      params.carrierName = form.carrierName.trim();
      if (form.appointmentNumber.trim()) params.appointmentNumber = form.appointmentNumber.trim();
      if (form.expiryDate) params.expiryDate = form.expiryDate;
    }

    setBusy(true);
    try {
      const r = await lensRun('insurance', 'producer-compliance-add', params);
      if (r.data?.ok === false || (r.data?.result as { ok?: boolean } | null)?.ok === false) {
        setError(((r.data?.result as { error?: string } | null)?.error) || r.data?.error || 'Could not add compliance record.');
        return;
      }
      setForm({ ...EMPTY_FORM, agentId: form.agentId, category: form.category });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  function startEdit(rec: ComplianceRecord) {
    setEditingId(rec.id);
    setEditForm({
      periodLabel: rec.periodLabel || '',
      creditsCompleted: rec.creditsCompleted != null ? String(rec.creditsCompleted) : '',
      creditsRequired: rec.creditsRequired != null ? String(rec.creditsRequired) : '',
      licenseNumber: rec.licenseNumber || '',
      state: rec.state || '',
      carrier: rec.carrier || '',
      policyNumber: rec.policyNumber || '',
      carrierName: rec.carrierName || '',
      appointmentNumber: rec.appointmentNumber || '',
      expiryDate: rec.expiryDate || '',
      notes: rec.notes || '',
    });
  }

  async function saveEdit(rec: ComplianceRecord) {
    const params: Record<string, unknown> = { id: rec.id };
    // Genuine partial update: only send the fields this category actually
    // renders in the edit form, never a full-object replace.
    if (rec.category === 'ce_credits') {
      if (editForm.periodLabel !== undefined) params.periodLabel = editForm.periodLabel;
      if (editForm.creditsCompleted !== undefined && editForm.creditsCompleted !== '') params.creditsCompleted = Number(editForm.creditsCompleted);
      if (editForm.creditsRequired !== undefined && editForm.creditsRequired !== '') params.creditsRequired = Number(editForm.creditsRequired);
      if (editForm.expiryDate !== undefined) params.expiryDate = editForm.expiryDate || null;
    } else if (rec.category === 'license_renewal') {
      if (editForm.licenseNumber !== undefined) params.licenseNumber = editForm.licenseNumber;
      if (editForm.state !== undefined) params.state = editForm.state;
      if (editForm.expiryDate !== undefined) params.expiryDate = editForm.expiryDate;
    } else if (rec.category === 'eo_insurance') {
      if (editForm.carrier !== undefined) params.carrier = editForm.carrier;
      if (editForm.policyNumber !== undefined) params.policyNumber = editForm.policyNumber;
      if (editForm.expiryDate !== undefined) params.expiryDate = editForm.expiryDate;
    } else if (rec.category === 'carrier_appointment') {
      if (editForm.carrierName !== undefined) params.carrierName = editForm.carrierName;
      if (editForm.appointmentNumber !== undefined) params.appointmentNumber = editForm.appointmentNumber || null;
      if (editForm.expiryDate !== undefined) params.expiryDate = editForm.expiryDate || null;
    }
    if (editForm.notes !== undefined) params.notes = editForm.notes;

    setBusy(true);
    setError(null);
    try {
      const r = await lensRun('insurance', 'producer-compliance-update', params);
      if (r.data?.ok === false || (r.data?.result as { ok?: boolean } | null)?.ok === false) {
        setError(((r.data?.result as { error?: string } | null)?.error) || r.data?.error || 'Could not update compliance record.');
        return;
      }
      setEditingId(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function removeRecord(id: string) {
    setBusy(true);
    try {
      await lensRun('insurance', 'producer-compliance-remove', { id });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-gray-400">
        Track producer licensing risk at a glance: continuing-education progress, license
        renewal deadlines, E&amp;O insurance coverage, and carrier appointments — all attached
        to your real producer roster.
      </p>

      {/* Aggregate risk banner — an agency owner needs this at a glance. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className={cn('rounded-lg p-3 text-center', overdueCount > 0 ? 'bg-red-500/10 border border-red-500/30' : 'bg-white/[0.03]')}>
          <div className={cn('text-lg font-bold tabular-nums flex items-center justify-center gap-1', overdueCount > 0 ? 'text-red-300' : 'text-white')}>
            {overdueCount > 0 && <AlertTriangle className="w-4 h-4" />}
            {overdueCount}
          </div>
          <div className="text-[9px] uppercase tracking-wider text-gray-400">Overdue items</div>
        </div>
        <div className={cn('rounded-lg p-3 text-center', dueSoonCount > 0 ? 'bg-amber-500/10 border border-amber-500/30' : 'bg-white/[0.03]')}>
          <div className={cn('text-lg font-bold tabular-nums', dueSoonCount > 0 ? 'text-amber-300' : 'text-white')}>{dueSoonCount}</div>
          <div className="text-[9px] uppercase tracking-wider text-gray-400">Due within 30 days</div>
        </div>
        <div className="bg-white/[0.03] rounded-lg p-3 text-center">
          <div className="text-lg font-bold tabular-nums text-white">{records.length}</div>
          <div className="text-[9px] uppercase tracking-wider text-gray-400">Tracked items</div>
        </div>
        <div className="bg-white/[0.03] rounded-lg p-3 text-center">
          <div className="text-lg font-bold tabular-nums text-cyan-300">{agents.length}</div>
          <div className="text-[9px] uppercase tracking-wider text-gray-400">Producers on roster</div>
        </div>
      </div>

      {Object.keys(byCategory).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(byCategory).map(([cat, count]) => (
            <span key={cat} className="text-[10px] px-2 py-1 rounded-full bg-white/5 text-gray-300 border border-white/10">
              {CATEGORY_LABEL[cat as ComplianceCategory] || cat}: <span className="font-semibold text-white">{count}</span>
            </span>
          ))}
        </div>
      )}

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Add form — category-adaptive: the fields below change per category. */}
      <div className="border border-white/10 rounded-lg p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <select
            className={inputCls}
            aria-label="Producer"
            value={form.agentId}
            onChange={(e) => setForm((f) => ({ ...f, agentId: e.target.value }))}
          >
            <option value="">Select producer…</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select
            className={inputCls}
            aria-label="Compliance category"
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as ComplianceCategory }))}
          >
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>

        {form.category === 'ce_credits' && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <input className={cn(inputCls, 'col-span-2')} placeholder="Period label (e.g. 2026-2027 cycle)" value={form.periodLabel} onChange={(e) => setForm((f) => ({ ...f, periodLabel: e.target.value }))} />
            <input className={inputCls} type="number" placeholder="Credits completed" value={form.creditsCompleted} onChange={(e) => setForm((f) => ({ ...f, creditsCompleted: e.target.value }))} />
            <input className={inputCls} type="number" placeholder="Credits required (default 24)" value={form.creditsRequired} onChange={(e) => setForm((f) => ({ ...f, creditsRequired: e.target.value }))} />
            <label className="col-span-2 flex flex-col gap-0.5 text-[10px] text-gray-400">
              Cycle deadline (optional)
              <input type="date" className={inputCls} value={form.expiryDate} onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))} />
            </label>
          </div>
        )}

        {form.category === 'license_renewal' && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <input className={inputCls} placeholder="License number" value={form.licenseNumber} onChange={(e) => setForm((f) => ({ ...f, licenseNumber: e.target.value }))} />
            <input className={inputCls} placeholder="State" value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} />
            <label className="flex flex-col gap-0.5 text-[10px] text-gray-400">
              Expiry date
              <input type="date" className={inputCls} value={form.expiryDate} onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))} />
            </label>
          </div>
        )}

        {form.category === 'eo_insurance' && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <input className={inputCls} placeholder="E&O carrier" value={form.carrier} onChange={(e) => setForm((f) => ({ ...f, carrier: e.target.value }))} />
            <input className={inputCls} placeholder="Policy number" value={form.policyNumber} onChange={(e) => setForm((f) => ({ ...f, policyNumber: e.target.value }))} />
            <label className="flex flex-col gap-0.5 text-[10px] text-gray-400">
              Expiry date
              <input type="date" className={inputCls} value={form.expiryDate} onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))} />
            </label>
          </div>
        )}

        {form.category === 'carrier_appointment' && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <input className={inputCls} placeholder="Carrier name" value={form.carrierName} onChange={(e) => setForm((f) => ({ ...f, carrierName: e.target.value }))} />
            <input className={inputCls} placeholder="Appointment # (optional)" value={form.appointmentNumber} onChange={(e) => setForm((f) => ({ ...f, appointmentNumber: e.target.value }))} />
            <label className="flex flex-col gap-0.5 text-[10px] text-gray-400">
              Expiry date (optional)
              <input type="date" className={inputCls} value={form.expiryDate} onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))} />
            </label>
          </div>
        )}

        <input className={inputCls} placeholder="Notes (optional)" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />

        <button onClick={() => void addRecord()} disabled={busy} className={cn(btnPrimary, 'w-full justify-center')}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add compliance record
        </button>
      </div>

      <div className="flex items-center gap-2">
        <GraduationCap className="w-3.5 h-3.5 text-cyan-400" />
        <span className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Tracked compliance items</span>
        <select className={cn(inputCls, 'ml-auto max-w-[180px]')} value={filterAgentId} onChange={(e) => setFilterAgentId(e.target.value)} aria-label="Filter by producer">
          <option value="">All producers</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="px-3 py-6 text-center text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>
      ) : records.length === 0 ? (
        <div className="px-3 py-8 text-center text-xs text-gray-400 border border-white/10 rounded-lg">
          No compliance items tracked yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {records.map((rec) => (
            <li key={rec.id} className="border border-white/10 rounded-lg p-3">
              {editingId === rec.id ? (
                <div className="space-y-2">
                  {rec.category === 'ce_credits' && (
                    <div className="grid grid-cols-2 gap-2">
                      <input className={inputCls} placeholder="Period label" value={editForm.periodLabel ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, periodLabel: e.target.value }))} />
                      <input className={inputCls} type="number" placeholder="Credits completed" value={editForm.creditsCompleted ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, creditsCompleted: e.target.value }))} />
                      <input className={inputCls} type="number" placeholder="Credits required" value={editForm.creditsRequired ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, creditsRequired: e.target.value }))} />
                      <input className={inputCls} type="date" value={editForm.expiryDate ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, expiryDate: e.target.value }))} />
                    </div>
                  )}
                  {rec.category === 'license_renewal' && (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      <input className={inputCls} placeholder="License number" value={editForm.licenseNumber ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, licenseNumber: e.target.value }))} />
                      <input className={inputCls} placeholder="State" value={editForm.state ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, state: e.target.value }))} />
                      <input className={inputCls} type="date" value={editForm.expiryDate ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, expiryDate: e.target.value }))} />
                    </div>
                  )}
                  {rec.category === 'eo_insurance' && (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      <input className={inputCls} placeholder="E&O carrier" value={editForm.carrier ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, carrier: e.target.value }))} />
                      <input className={inputCls} placeholder="Policy number" value={editForm.policyNumber ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, policyNumber: e.target.value }))} />
                      <input className={inputCls} type="date" value={editForm.expiryDate ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, expiryDate: e.target.value }))} />
                    </div>
                  )}
                  {rec.category === 'carrier_appointment' && (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      <input className={inputCls} placeholder="Carrier name" value={editForm.carrierName ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, carrierName: e.target.value }))} />
                      <input className={inputCls} placeholder="Appointment #" value={editForm.appointmentNumber ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, appointmentNumber: e.target.value }))} />
                      <input className={inputCls} type="date" value={editForm.expiryDate ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, expiryDate: e.target.value }))} />
                    </div>
                  )}
                  <input className={inputCls} placeholder="Notes" value={editForm.notes ?? ''} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} />
                  <div className="flex items-center gap-2">
                    <button onClick={() => void saveEdit(rec)} disabled={busy} className={btnPrimary}>Save</button>
                    <button onClick={() => setEditingId(null)} className={btnGhost}><X className="w-3.5 h-3.5" /> Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold uppercase">{CATEGORY_LABEL[rec.category]}</span>
                      <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-medium', STATUS_BADGE[rec.status])}>{STATUS_LABEL[rec.status]}</span>
                      <span className="text-sm text-white">{rec.agentFound ? rec.agentName : 'Unknown producer (removed)'}</span>
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      {rec.category === 'ce_credits' && (
                        <>
                          {rec.periodLabel} · {rec.creditsCompleted}/{rec.creditsRequired} credits ({fmtPct(rec.creditsPercent)})
                          {rec.expiryDate ? ` · deadline ${rec.expiryDate}` : ''}
                          <div className="mt-1 h-1.5 w-full max-w-xs rounded-full bg-white/10 overflow-hidden" role="progressbar" aria-valuenow={rec.creditsPercent ?? 0} aria-valuemin={0} aria-valuemax={100}>
                            <div
                              className={cn('h-full rounded-full', rec.creditsComplete ? 'bg-emerald-400' : 'bg-cyan-400')}
                              style={{ width: `${Math.min(100, rec.creditsPercent ?? 0)}%` }}
                            />
                          </div>
                        </>
                      )}
                      {rec.category === 'license_renewal' && <>License #{rec.licenseNumber} · {rec.state} · expires {rec.expiryDate}</>}
                      {rec.category === 'eo_insurance' && <>{rec.carrier} · #{rec.policyNumber} · expires {rec.expiryDate}</>}
                      {rec.category === 'carrier_appointment' && (
                        <>{rec.carrierName}{rec.appointmentNumber ? ` · #${rec.appointmentNumber}` : ''}{rec.expiryDate ? ` · expires ${rec.expiryDate}` : ' · no expiry on file'}</>
                      )}
                    </div>
                    {rec.notes && <div className="text-[10px] text-gray-500 mt-0.5">{rec.notes}</div>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => startEdit(rec)} className={btnGhost} aria-label={`Edit ${CATEGORY_LABEL[rec.category]} record`}>
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => void removeRecord(rec.id)} disabled={busy} className={cn(btnGhost, 'text-red-400 hover:text-red-300')} aria-label={`Remove ${CATEGORY_LABEL[rec.category]} record`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ProducerCompliance;
