'use client';

/**
 * InsurancePoliciesPanel — policy list + add, and a policy detail with
 * documents, premium payments, beneficiaries and an ID card.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, ChevronLeft, Trash2, FileText, CreditCard, Users, CalendarClock, Pencil, Save } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ClientAutocomplete } from './ClientAutocomplete';
import type { ClientRecord } from './ClientAutocomplete';

interface Policy {
  id: string; carrier: string; policyNumber: string; kind: string;
  annualPremium: number; deductible: number; renewalDate: string; status: string;
  clientId?: string | null; insuredName?: string | null;
}
interface PolicyDoc { id: string; title: string; kind: string }
interface Payment { id: string; amount: number; date: string; method: string | null }
interface Beneficiary { id: string; name: string; relationship: string | null; sharePct: number }
interface Schedule {
  frequency: string; installment: number; perYear: number; annualPremium: number;
  lastPaymentDate: string; nextDueDate: string; nextDueStatus: 'overdue' | 'due_soon' | 'scheduled' | 'none';
}

const FREQ_LABEL: Record<string, string> = { monthly: 'Monthly', quarterly: 'Quarterly', semiannual: 'Semiannual', annual: 'Annual' };
const DUE_COLOR: Record<string, string> = { overdue: 'text-rose-400', due_soon: 'text-amber-400', scheduled: 'text-emerald-400', none: 'text-zinc-400' };

const KINDS = ['auto', 'home', 'health', 'life', 'umbrella', 'renters', 'pet', 'travel', 'business'];
const POLICY_STATUSES = ['active', 'lapsed', 'cancelled', 'pending'];
const STATUS_COLOR: Record<string, string> = {
  active: 'text-emerald-400', lapsed: 'text-amber-400', cancelled: 'text-zinc-400', pending: 'text-sky-400',
};

interface InsurancePoliciesPanelProps {
  onChange: () => void;
  clients?: ClientRecord[];
  onClientCreated?: (client: ClientRecord) => void;
}

export function InsurancePoliciesPanel({ onChange, clients = [], onClientCreated }: InsurancePoliciesPanelProps) {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ carrier: '', policyNumber: '', kind: 'auto', annualPremium: '', deductible: '' });
  const [clientText, setClientText] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Policy | null>(null);
  const [docs, setDocs] = useState<PolicyDoc[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [card, setCard] = useState<Record<string, unknown> | null>(null);
  const [payAmt, setPayAmt] = useState('');
  const [docForm, setDocForm] = useState({ title: '', kind: 'declaration' });
  const [benForm, setBenForm] = useState({ name: '', relationship: '', sharePct: '100' });
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [scheduleFreq, setScheduleFreq] = useState('monthly');
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ status: 'active', annualPremium: '', deductible: '', renewalDate: '' });
  const [savingEdit, setSavingEdit] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('insurance', 'policy-list', {});
    setPolicies(r.data?.result?.policies || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const openPolicy = useCallback(async (p: Policy) => {
    setSelected(p);
    setSchedule(null);
    setEditing(false);
    setEditForm({ status: p.status, annualPremium: String(p.annualPremium), deductible: String(p.deductible), renewalDate: p.renewalDate || '' });
    const [d, c] = await Promise.all([
      lensRun('insurance', 'policy-detail', { id: p.id }),
      lensRun('insurance', 'id-card', { policyId: p.id }),
    ]);
    setDocs(d.data?.result?.documents || []);
    setPayments(d.data?.result?.payments || []);
    setCard((c.data?.result?.card as Record<string, unknown>) || null);
    const b = await lensRun('insurance', 'beneficiary-list', { policyId: p.id });
    setBeneficiaries(b.data?.ok === false ? [] : (b.data?.result?.beneficiaries || []));
  }, []);

  const loadSchedule = useCallback(async (policyId: string, frequency: string) => {
    setScheduleLoading(true);
    try {
      const r = await lensRun('insurance', 'premium-schedule', { policyId, frequency });
      setSchedule(r.data?.ok === false ? null : ((r.data?.result as Schedule) || null));
      if (r.data?.ok === false) setError(r.data?.error || 'Failed to compute schedule');
    } finally { setScheduleLoading(false); }
  }, []);

  const addPolicy = async () => {
    if (!form.carrier.trim() || !form.policyNumber.trim()) { setError('Carrier and policy number are required.'); return; }
    const r = await lensRun('insurance', 'policy-add', {
      carrier: form.carrier.trim(), policyNumber: form.policyNumber.trim(), kind: form.kind,
      annualPremium: Number(form.annualPremium) || 0, deductible: Number(form.deductible) || 0,
      clientId: clientId || undefined, insuredName: clientId ? undefined : (clientText.trim() || undefined),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ carrier: '', policyNumber: '', kind: 'auto', annualPremium: '', deductible: '' });
    setClientText(''); setClientId(null);
    setShowAdd(false); setError(null);
    await refresh(); onChange();
  };
  const selectClient = (client: ClientRecord | null, text: string) => {
    setClientId(client ? client.id : null);
    setClientText(text);
  };
  const delPolicy = async (id: string) => {
    await lensRun('insurance', 'policy-delete', { id });
    if (selected?.id === id) setSelected(null);
    await refresh(); onChange();
  };
  const saveEdit = async () => {
    if (!selected) return;
    setSavingEdit(true); setError(null);
    try {
      const r = await lensRun('insurance', 'policy-update', {
        id: selected.id, status: editForm.status,
        annualPremium: Number(editForm.annualPremium) || 0,
        deductible: Number(editForm.deductible) || 0,
        renewalDate: editForm.renewalDate || undefined,
      });
      if (r.data?.ok === false) { setError(r.data?.error || 'Update failed'); return; }
      const updated = (r.data?.result as { policy?: Policy } | undefined)?.policy;
      if (updated) setSelected(updated);
      setEditing(false);
      await refresh(); onChange();
    } finally { setSavingEdit(false); }
  };
  const logPayment = async () => {
    if (!selected || !(Number(payAmt) > 0)) { setError('Enter a payment amount.'); return; }
    await lensRun('insurance', 'payment-log', { policyId: selected.id, amount: Number(payAmt) });
    setPayAmt(''); setError(null);
    await openPolicy(selected);
  };
  const addDoc = async () => {
    if (!selected || !docForm.title.trim()) { setError('Document title is required.'); return; }
    await lensRun('insurance', 'policy-document-add', { policyId: selected.id, title: docForm.title.trim(), kind: docForm.kind });
    setDocForm({ title: '', kind: 'declaration' }); setError(null);
    await openPolicy(selected);
  };
  const addBeneficiary = async () => {
    if (!selected || !benForm.name.trim()) { setError('Beneficiary name is required.'); return; }
    await lensRun('insurance', 'beneficiary-add', {
      policyId: selected.id, name: benForm.name.trim(),
      relationship: benForm.relationship.trim(), sharePct: Number(benForm.sharePct) || 0,
    });
    setBenForm({ name: '', relationship: '', sharePct: '100' }); setError(null);
    await openPolicy(selected);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  // ── Policy detail ──
  if (selected) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setSelected(null)}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200">
            <ChevronLeft className="w-3.5 h-3.5" /> All policies
          </button>
          <button type="button" onClick={() => setEditing((v) => !v)}
            className="flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200">
            <Pencil className="w-3.5 h-3.5" /> {editing ? 'Cancel edit' : 'Edit policy'}
          </button>
        </div>

        {editing && (
          <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-blue-800/40 rounded-xl p-3">
            <label className="text-[11px] text-zinc-400">Status
              <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                className="mt-0.5 w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
                {POLICY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-zinc-400">Renewal date
              <input type="date" value={editForm.renewalDate} onChange={(e) => setEditForm({ ...editForm, renewalDate: e.target.value })}
                className="mt-0.5 w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            </label>
            <label className="text-[11px] text-zinc-400">Annual premium ($)
              <input inputMode="decimal" value={editForm.annualPremium} onChange={(e) => setEditForm({ ...editForm, annualPremium: e.target.value })}
                className="mt-0.5 w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            </label>
            <label className="text-[11px] text-zinc-400">Deductible ($)
              <input inputMode="decimal" value={editForm.deductible} onChange={(e) => setEditForm({ ...editForm, deductible: e.target.value })}
                className="mt-0.5 w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            </label>
            <button type="button" onClick={saveEdit} disabled={savingEdit}
              className="col-span-2 mt-1 flex items-center justify-center gap-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg px-2 py-1.5">
              {savingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save changes
            </button>
          </div>
        )}

        {/* ID card */}
        {card && (
          <div className="bg-gradient-to-br from-blue-900/50 to-zinc-900 border border-blue-800/50 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-blue-300">
                <CreditCard className="w-3.5 h-3.5" /> Insurance card
              </span>
              <span className={cn('text-[10px] uppercase', STATUS_COLOR[String(card.status)] || 'text-zinc-400')}>
                {String(card.status)}
              </span>
            </div>
            <p className="text-lg font-bold text-zinc-100 mt-1">{String(card.carrier)}</p>
            <p className="text-xs text-zinc-400 font-mono">{String(card.policyNumber)} · {String(card.kind)}</p>
            <p className="text-[11px] text-zinc-400 mt-1">
              Effective {String(card.effectiveDate)} · Renews {String(card.renewalDate)} · Deductible ${String(card.deductible)}
            </p>
          </div>
        )}

        {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

        {/* Payment plan */}
        <section>
          <h4 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
            <CalendarClock className="w-3.5 h-3.5 text-blue-400" /> Payment plan
          </h4>
          <div className="flex gap-1 mb-2">
            <select value={scheduleFreq} onChange={(e) => setScheduleFreq(e.target.value)}
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
              {Object.entries(FREQ_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button type="button" onClick={() => void loadSchedule(selected.id, scheduleFreq)} disabled={scheduleLoading}
              className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg inline-flex items-center gap-1">
              {scheduleLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Compute
            </button>
          </div>
          {schedule && (
            <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg p-3 text-[11px]">
              <div><span className="text-zinc-400">Installment</span> <span className="text-zinc-100 font-mono">${schedule.installment}</span> × {schedule.perYear}/yr</div>
              <div><span className="text-zinc-400">Last paid</span> <span className="text-zinc-200">{schedule.lastPaymentDate}</span></div>
              <div className="col-span-2">
                <span className="text-zinc-400">Next due</span> <span className="text-zinc-200">{schedule.nextDueDate}</span>{' '}
                <span className={cn('uppercase text-[10px] font-bold', DUE_COLOR[schedule.nextDueStatus] || 'text-zinc-400')}>
                  {schedule.nextDueStatus.replace('_', ' ')}
                </span>
              </div>
            </div>
          )}
        </section>

        {/* Payments */}
        <section>
          <h4 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
            <CreditCard className="w-3.5 h-3.5 text-blue-400" /> Premium payments
          </h4>
          <div className="flex gap-1 mb-2">
            <input placeholder="Payment amount ($)" inputMode="decimal" value={payAmt} onChange={(e) => setPayAmt(e.target.value)}
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button type="button" onClick={logPayment}
              className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg">Log</button>
          </div>
          {payments.length === 0 ? (
            <p className="text-[11px] text-zinc-400 italic">No payments logged.</p>
          ) : (
            <ul className="space-y-1">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between text-[11px] bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                  <span className="text-zinc-400">{p.date}</span>
                  <span className="text-zinc-200 font-mono">${p.amount}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Documents */}
        <section>
          <h4 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
            <FileText className="w-3.5 h-3.5 text-blue-400" /> Documents
          </h4>
          <div className="flex gap-1 mb-2">
            <input placeholder="Document title" value={docForm.title} onChange={(e) => setDocForm({ ...docForm, title: e.target.value })}
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button type="button" onClick={addDoc}
              className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg">Add</button>
          </div>
          {docs.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {docs.map((d) => (
                <li key={d.id} className="text-[11px] px-2 py-1 rounded-lg border border-zinc-700 text-zinc-300">{d.title}</li>
              ))}
            </ul>
          )}
        </section>

        {/* Beneficiaries */}
        <section>
          <h4 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
            <Users className="w-3.5 h-3.5 text-blue-400" /> Beneficiaries
          </h4>
          <div className="grid grid-cols-4 gap-2 mb-2">
            <input placeholder="Name" value={benForm.name} onChange={(e) => setBenForm({ ...benForm, name: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Relationship" value={benForm.relationship} onChange={(e) => setBenForm({ ...benForm, relationship: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Share %" inputMode="numeric" value={benForm.sharePct} onChange={(e) => setBenForm({ ...benForm, sharePct: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button type="button" onClick={addBeneficiary}
              className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg">Add</button>
          </div>
          {beneficiaries.length > 0 && (
            <ul className="space-y-1">
              {beneficiaries.map((b) => (
                <li key={b.id} className="flex items-center justify-between text-[11px] bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                  <span className="text-zinc-200">{b.name} <span className="text-zinc-400">{b.relationship}</span></span>
                  <span className="text-zinc-400">{b.sharePct}%</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  // ── Policy list ──
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-400"><span className="text-zinc-100 font-semibold">{policies.length}</span> policies</span>
        <button type="button" onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Add policy
        </button>
      </div>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {showAdd && (
        <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <input placeholder="Carrier" value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Policy number" value={form.policyNumber} onChange={(e) => setForm({ ...form, policyNumber: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <ClientAutocomplete clients={clients} value={clientText} clientId={clientId} onSelect={selectClient} onCreated={onClientCreated} placeholder="Insured (optional)" />
          <input placeholder="Annual premium ($)" inputMode="decimal" value={form.annualPremium} onChange={(e) => setForm({ ...form, annualPremium: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Deductible ($)" inputMode="decimal" value={form.deductible} onChange={(e) => setForm({ ...form, deductible: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addPolicy}
            className="col-span-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">Save policy</button>
        </div>
      )}

      {policies.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No policies yet. Add your first one.
        </div>
      ) : (
        <ul className="space-y-2">
          {policies.map((p) => (
            <li key={p.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <button type="button" onClick={() => openPolicy(p)} className="text-left">
                <p className="text-sm font-semibold text-zinc-100">
                  {p.carrier} <span className={cn('ml-1 text-[10px] uppercase', STATUS_COLOR[p.status])}>{p.status}</span>
                </p>
                <p className="text-[11px] text-zinc-400 capitalize">
                  {p.kind} · {p.policyNumber} · ${p.annualPremium}/yr · renews {p.renewalDate}
                  {p.insuredName ? ` · insured: ${p.insuredName}` : ''}
                </p>
              </button>
              <button aria-label="Delete" type="button" onClick={() => delPolicy(p.id)} className="text-zinc-600 hover:text-rose-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
