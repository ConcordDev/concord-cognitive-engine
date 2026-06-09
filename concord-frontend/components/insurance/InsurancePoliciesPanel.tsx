'use client';

/**
 * InsurancePoliciesPanel — policy list + add, and a policy detail with
 * documents, premium payments, beneficiaries and an ID card.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, ChevronLeft, Trash2, FileText, CreditCard, Users } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Policy {
  id: string; carrier: string; policyNumber: string; kind: string;
  annualPremium: number; deductible: number; renewalDate: string; status: string;
}
interface PolicyDoc { id: string; title: string; kind: string }
interface Payment { id: string; amount: number; date: string; method: string | null }
interface Beneficiary { id: string; name: string; relationship: string | null; sharePct: number }

const KINDS = ['auto', 'home', 'health', 'life', 'umbrella', 'renters', 'pet', 'travel', 'business'];
const STATUS_COLOR: Record<string, string> = {
  active: 'text-emerald-400', lapsed: 'text-amber-400', cancelled: 'text-zinc-400', pending: 'text-sky-400',
};

export function InsurancePoliciesPanel({ onChange }: { onChange: () => void }) {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ carrier: '', policyNumber: '', kind: 'auto', annualPremium: '', deductible: '' });
  const [selected, setSelected] = useState<Policy | null>(null);
  const [docs, setDocs] = useState<PolicyDoc[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [card, setCard] = useState<Record<string, unknown> | null>(null);
  const [payAmt, setPayAmt] = useState('');
  const [docForm, setDocForm] = useState({ title: '', kind: 'declaration' });
  const [benForm, setBenForm] = useState({ name: '', relationship: '', sharePct: '100' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('insurance', 'policy-list', {});
    setPolicies(r.data?.result?.policies || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const openPolicy = useCallback(async (p: Policy) => {
    setSelected(p);
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

  const addPolicy = async () => {
    if (!form.carrier.trim() || !form.policyNumber.trim()) { setError('Carrier and policy number are required.'); return; }
    const r = await lensRun('insurance', 'policy-add', {
      carrier: form.carrier.trim(), policyNumber: form.policyNumber.trim(), kind: form.kind,
      annualPremium: Number(form.annualPremium) || 0, deductible: Number(form.deductible) || 0,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ carrier: '', policyNumber: '', kind: 'auto', annualPremium: '', deductible: '' });
    setShowAdd(false); setError(null);
    await refresh(); onChange();
  };
  const delPolicy = async (id: string) => {
    await lensRun('insurance', 'policy-delete', { id });
    if (selected?.id === id) setSelected(null);
    await refresh(); onChange();
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
        <button type="button" onClick={() => setSelected(null)}
          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200">
          <ChevronLeft className="w-3.5 h-3.5" /> All policies
        </button>

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
          <input placeholder="Annual premium ($)" inputMode="decimal" value={form.annualPremium} onChange={(e) => setForm({ ...form, annualPremium: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Deductible ($)" inputMode="decimal" value={form.deductible} onChange={(e) => setForm({ ...form, deductible: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addPolicy}
            className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">Save policy</button>
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
