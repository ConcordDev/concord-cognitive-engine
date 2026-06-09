'use client';

import { useCallback, useEffect, useState } from 'react';
import { Landmark, Loader2, Plus, ShieldCheck, FileCheck } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Lender {
  id: string;
  name: string;
  loanType: string;
  quotedRate: number;
  phone: string;
  email: string;
  nmlsId: string;
}
interface PreApproval {
  id: string;
  lenderName: string;
  loanType: string;
  creditScore: number;
  creditTier: string;
  rate: number;
  maxLoanAmount: number;
  maxHomePrice: number;
  maxMonthlyPayment: number;
  status: string;
  requestedAt: string;
  expiresAt: string;
}

const LOAN_TYPES = ['conventional', 'fha', 'va', 'usda', 'jumbo'] as const;

const STATUS_STYLE: Record<string, string> = {
  approved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  conditional: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  declined: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
};

export function PreApprovalFlow() {
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [preapprovals, setPreapprovals] = useState<PreApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingLender, setAddingLender] = useState(false);
  const [lenderForm, setLenderForm] = useState({ name: '', loanType: 'conventional', quotedRate: '', phone: '', email: '', nmlsId: '' });
  const [paForm, setPaForm] = useState({ lenderId: '', annualIncome: '', monthlyDebts: '', downPayment: '', creditScore: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [l, p] = await Promise.all([
        lensRun({ domain: 'realestate', action: 'lenders-list', input: {} }),
        lensRun({ domain: 'realestate', action: 'preapprovals-list', input: {} }),
      ]);
      if (l.data?.ok) setLenders((l.data.result?.lenders as Lender[]) || []);
      if (p.data?.ok) setPreapprovals((p.data.result?.preapprovals as PreApproval[]) || []);
    } catch (e) {
      console.error('[PreApproval] refresh failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const addLender = async () => {
    if (!lenderForm.name.trim()) return;
    setError(null);
    try {
      const r = await lensRun({
        domain: 'realestate', action: 'lenders-add',
        input: {
          name: lenderForm.name.trim(), loanType: lenderForm.loanType,
          quotedRate: lenderForm.quotedRate ? Number(lenderForm.quotedRate) : 0,
          phone: lenderForm.phone, email: lenderForm.email, nmlsId: lenderForm.nmlsId,
        },
      });
      if (r.data?.ok) {
        setLenderForm({ name: '', loanType: 'conventional', quotedRate: '', phone: '', email: '', nmlsId: '' });
        setAddingLender(false);
        await refresh();
      } else {
        setError(r.data?.error || 'Could not add lender.');
      }
    } catch (e) {
      console.error('[PreApproval] add lender failed', e);
      setError('Could not add lender.');
    }
  };

  const requestPreapproval = async () => {
    if (!paForm.lenderId || !paForm.annualIncome || !paForm.creditScore) {
      setError('Lender, annual income, and credit score are required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await lensRun({
        domain: 'realestate', action: 'preapproval-request',
        input: {
          lenderId: paForm.lenderId,
          annualIncome: Number(paForm.annualIncome),
          monthlyDebts: paForm.monthlyDebts ? Number(paForm.monthlyDebts) : 0,
          downPayment: paForm.downPayment ? Number(paForm.downPayment) : 0,
          creditScore: Number(paForm.creditScore),
        },
      });
      if (r.data?.ok) {
        setPaForm({ lenderId: '', annualIncome: '', monthlyDebts: '', downPayment: '', creditScore: '' });
        await refresh();
      } else {
        setError(r.data?.error || 'Pre-approval request failed.');
      }
    } catch (e) {
      console.error('[PreApproval] request failed', e);
      setError('Pre-approval request failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Mortgage pre-approval</span>
        <span className="ml-auto text-[10px] text-gray-400">lender connect · 28/36 DTI</span>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : (
        <div className="p-3 space-y-4">
          {/* Lenders */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Landmark className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-[10px] uppercase tracking-wider text-gray-400">Lenders</span>
              <button aria-label="Add" onClick={() => setAddingLender((v) => !v)} className="ml-auto p-0.5 text-gray-400 hover:text-white"><Plus className="w-3.5 h-3.5" /></button>
            </div>
            {addingLender && (
              <div className="grid grid-cols-6 gap-2 text-xs mb-2">
                <input value={lenderForm.name} onChange={(e) => setLenderForm({ ...lenderForm, name: e.target.value })} placeholder="Lender name" className="col-span-2 px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
                <select value={lenderForm.loanType} onChange={(e) => setLenderForm({ ...lenderForm, loanType: e.target.value })} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white">
                  {LOAN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <input type="number" step="0.01" value={lenderForm.quotedRate} onChange={(e) => setLenderForm({ ...lenderForm, quotedRate: e.target.value })} placeholder="Rate %" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
                <input value={lenderForm.email} onChange={(e) => setLenderForm({ ...lenderForm, email: e.target.value })} placeholder="Email" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
                <button onClick={addLender} className="px-3 py-1.5 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Add</button>
              </div>
            )}
            {lenders.length === 0 ? (
              <p className="text-[11px] text-gray-400 py-1">No lenders yet. Add one to request a pre-approval.</p>
            ) : (
              <ul className="grid grid-cols-2 gap-2">
                {lenders.map((l) => (
                  <li key={l.id} className="rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs">
                    <div className="font-semibold text-white">{l.name}</div>
                    <div className="text-[10px] text-gray-400">{l.loanType}{l.quotedRate > 0 ? ` · ${l.quotedRate}%` : ''}{l.nmlsId ? ` · NMLS ${l.nmlsId}` : ''}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Request form */}
          <section className="border-t border-white/10 pt-3">
            <div className="flex items-center gap-2 mb-2">
              <FileCheck className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-[10px] uppercase tracking-wider text-gray-400">Request pre-approval</span>
            </div>
            <div className="grid grid-cols-5 gap-2 text-xs">
              <select value={paForm.lenderId} onChange={(e) => setPaForm({ ...paForm, lenderId: e.target.value })} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white">
                <option value="">Lender…</option>
                {lenders.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <input type="number" value={paForm.annualIncome} onChange={(e) => setPaForm({ ...paForm, annualIncome: e.target.value })} placeholder="Annual income" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
              <input type="number" value={paForm.monthlyDebts} onChange={(e) => setPaForm({ ...paForm, monthlyDebts: e.target.value })} placeholder="Monthly debts" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
              <input type="number" value={paForm.downPayment} onChange={(e) => setPaForm({ ...paForm, downPayment: e.target.value })} placeholder="Down payment" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
              <input type="number" value={paForm.creditScore} onChange={(e) => setPaForm({ ...paForm, creditScore: e.target.value })} placeholder="Credit score" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
            </div>
            <button onClick={requestPreapproval} disabled={busy} className="mt-2 w-full px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center justify-center gap-1.5">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />} Get pre-approved
            </button>
            {error && <p className="mt-1.5 text-[11px] text-rose-400">{error}</p>}
          </section>

          {/* Pre-approval letters */}
          <section className="border-t border-white/10 pt-3">
            <span className="text-[10px] uppercase tracking-wider text-gray-400">Pre-approval letters</span>
            {preapprovals.length === 0 ? (
              <p className="text-[11px] text-gray-400 py-1">No pre-approvals yet.</p>
            ) : (
              <ul className="space-y-2 mt-1.5">
                {preapprovals.map((p) => (
                  <li key={p.id} className="rounded-md border border-white/10 bg-white/[0.03] p-2.5 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">{p.lenderName}</span>
                      <span className={cn('text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border', STATUS_STYLE[p.status] || 'bg-white/5 text-gray-400 border-white/10')}>{p.status}</span>
                      <span className="ml-auto text-[10px] text-gray-400">expires {p.expiresAt}</span>
                    </div>
                    <div className="mt-1.5 grid grid-cols-4 gap-2 text-center">
                      <div><div className="text-[9px] uppercase text-gray-400">Max price</div><div className="font-mono tabular-nums text-cyan-300">${p.maxHomePrice.toLocaleString()}</div></div>
                      <div><div className="text-[9px] uppercase text-gray-400">Max loan</div><div className="font-mono tabular-nums text-white">${p.maxLoanAmount.toLocaleString()}</div></div>
                      <div><div className="text-[9px] uppercase text-gray-400">Max PITI</div><div className="font-mono tabular-nums text-white">${p.maxMonthlyPayment.toLocaleString()}/mo</div></div>
                      <div><div className="text-[9px] uppercase text-gray-400">Credit</div><div className="font-mono tabular-nums text-white capitalize">{p.creditTier} ({p.creditScore})</div></div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export default PreApprovalFlow;
