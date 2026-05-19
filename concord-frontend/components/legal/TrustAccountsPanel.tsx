'use client';

import { useEffect, useState } from 'react';
import { Scale, Loader2, Plus, ArrowDown, ArrowUp, RefreshCw, CheckCircle, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Matter { id: string; name: string; clientName: string }
interface TrustAccount {
  id: string; number: string; name: string; accountNumber: string; bankName: string;
  isIOLTA: boolean; bankStatementBalance: number; lastReconcileAt?: string;
}
interface MatterLedger { matterId: string; matterName: string; clientName: string; deposits: number; disbursements: number; balance: number }
interface Reconciliation {
  bookBalance: number; clientLedgerTotal: number; bankBalance: number;
  bookVsClient: number; bookVsBank: number; reconciled: boolean; warnings: string[];
}

export function TrustAccountsPanel() {
  const [accounts, setAccounts] = useState<TrustAccount[]>([]);
  const [matters, setMatters] = useState<Matter[]>([]);
  const [activeAcct, setActiveAcct] = useState<TrustAccount | null>(null);
  const [balance, setBalance] = useState<{ total: number; byMatter: MatterLedger[] } | null>(null);
  const [recon, setRecon] = useState<Reconciliation | null>(null);
  const [loading, setLoading] = useState(true);
  const [acctForm, setAcctForm] = useState({ name: '', bankName: '', accountNumber: '' });
  const [showAcctForm, setShowAcctForm] = useState(false);
  const [txnForm, setTxnForm] = useState({ kind: 'deposit' as 'deposit' | 'disbursement', matterId: '', amount: '', memo: '', payee: '', checkNumber: '' });
  const [showTxnForm, setShowTxnForm] = useState(false);
  const [reconForm, setReconForm] = useState({ bankBalance: '' });

  useEffect(() => { refresh(); }, []);
  useEffect(() => { if (activeAcct) refreshAccount(activeAcct.id); }, [activeAcct?.id]);

  async function refresh() {
    setLoading(true);
    try {
      const [a, m] = await Promise.all([
        api.post('/api/lens/run', { domain: 'legal', action: 'trust-accounts-list', input: {} }),
        api.post('/api/lens/run', { domain: 'legal', action: 'matters-list', input: { status: 'open' } }),
      ]);
      const accts = (a.data?.result?.accounts || []) as TrustAccount[];
      setAccounts(accts);
      setMatters((m.data?.result?.matters || []) as Matter[]);
      if (accts.length > 0 && !activeAcct) setActiveAcct(accts[0]);
    } catch (e) { console.error('[Trust] refresh failed', e); }
    finally { setLoading(false); }
  }

  async function refreshAccount(accountId: string) {
    try {
      const [b, r] = await Promise.all([
        api.post('/api/lens/run', { domain: 'legal', action: 'trust-balance', input: { accountId } }),
        api.post('/api/lens/run', { domain: 'legal', action: 'trust-reconcile', input: { accountId } }),
      ]);
      setBalance({ total: b.data?.result?.total || 0, byMatter: (b.data?.result?.byMatter || []) as MatterLedger[] });
      setRecon(r.data?.result as Reconciliation);
    } catch (e) { console.error('[Trust] balance failed', e); }
  }

  async function createAccount() {
    if (!acctForm.name.trim()) return;
    try {
      const r = await api.post('/api/lens/run', { domain: 'legal', action: 'trust-account-create', input: acctForm });
      setShowAcctForm(false);
      setAcctForm({ name: '', bankName: '', accountNumber: '' });
      await refresh();
      if (r.data?.result?.account) setActiveAcct(r.data.result.account);
    } catch (e) { console.error('[Trust] create failed', e); }
  }

  async function submitTxn() {
    if (!activeAcct || !txnForm.matterId || !txnForm.amount) return;
    const action = txnForm.kind === 'deposit' ? 'trust-deposit' : 'trust-disburse';
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'legal', action,
        input: { ...txnForm, accountId: activeAcct.id, amount: Number(txnForm.amount) },
      });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      setTxnForm({ kind: 'deposit', matterId: '', amount: '', memo: '', payee: '', checkNumber: '' });
      setShowTxnForm(false);
      await refreshAccount(activeAcct.id);
    } catch (e) { console.error('[Trust] txn failed', e); }
  }

  async function reconcile() {
    if (!activeAcct) return;
    try {
      await api.post('/api/lens/run', { domain: 'legal', action: 'trust-reconcile', input: { accountId: activeAcct.id, bankBalance: Number(reconForm.bankBalance) || 0 } });
      setReconForm({ bankBalance: '' });
      await refreshAccount(activeAcct.id);
    } catch (e) { console.error('[Trust] reconcile failed', e); }
  }

  return (
    <div className="space-y-3">
      <div className="bg-[#0d1117] border border-amber-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2 flex-wrap">
          <Scale className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-gray-200">IOLTA Trust accounting</span>
          <span className="text-[10px] text-rose-300 font-mono">{recon && !recon.reconciled && '⚠ out of balance'}</span>
          <div className="ml-auto flex items-center gap-2">
            <select
              value={activeAcct?.id || ''}
              onChange={e => setActiveAcct(accounts.find(a => a.id === e.target.value) || null)}
              className="text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white"
            >
              <option value="">— Select account —</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button onClick={() => setShowAcctForm(v => !v)} className="px-2.5 py-1 text-xs rounded bg-amber-500 text-black font-semibold hover:bg-amber-400 inline-flex items-center gap-1">
              <Plus className="w-3 h-3" />Account
            </button>
          </div>
        </header>

        {showAcctForm && (
          <div className="p-3 grid grid-cols-12 gap-2 border-b border-white/10">
            <input value={acctForm.name} onChange={e => setAcctForm({ ...acctForm, name: e.target.value })} placeholder="Account name (e.g. Client Trust IOLTA)" className="col-span-5 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input value={acctForm.bankName} onChange={e => setAcctForm({ ...acctForm, bankName: e.target.value })} placeholder="Bank name" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input value={acctForm.accountNumber} onChange={e => setAcctForm({ ...acctForm, accountNumber: e.target.value })} placeholder="Acct # (last 4 ok)" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
            <button onClick={createAccount} className="col-span-12 px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400">Open trust account</button>
          </div>
        )}

        {activeAcct ? (
          <div className="p-4 space-y-3">
            {/* Three-way reconciliation panel */}
            {recon && (
              <div className={cn(
                'rounded-md border p-3 grid grid-cols-12 gap-2 items-center',
                recon.reconciled ? 'border-emerald-500/30 bg-emerald-500/[0.04]' : 'border-rose-500/30 bg-rose-500/[0.04]',
              )}>
                <div className="col-span-3">
                  <div className="text-[10px] uppercase tracking-wider text-gray-500">Book (ledger)</div>
                  <div className="text-base font-mono text-white">${recon.bookBalance.toFixed(2)}</div>
                </div>
                <div className="col-span-3">
                  <div className="text-[10px] uppercase tracking-wider text-gray-500">Client ledgers</div>
                  <div className="text-base font-mono text-white">${recon.clientLedgerTotal.toFixed(2)}</div>
                </div>
                <div className="col-span-3">
                  <div className="text-[10px] uppercase tracking-wider text-gray-500">Bank statement</div>
                  <div className="text-base font-mono text-white">${recon.bankBalance.toFixed(2)}</div>
                </div>
                <div className="col-span-3 text-right">
                  {recon.reconciled ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-300"><CheckCircle className="w-3.5 h-3.5" /> 3-way reconciled</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-rose-300"><AlertTriangle className="w-3.5 h-3.5" /> out of balance</span>
                  )}
                </div>
                {recon.warnings.length > 0 && (
                  <ul className="col-span-12 text-[11px] text-rose-200 space-y-0.5">
                    {recon.warnings.map((w, i) => <li key={i}>· {w}</li>)}
                  </ul>
                )}
                <div className="col-span-12 flex items-center gap-2 mt-1">
                  <input type="number" step="0.01" value={reconForm.bankBalance} onChange={e => setReconForm({ bankBalance: e.target.value })} placeholder="Bank statement balance" className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
                  <button onClick={reconcile} className="px-2.5 py-1.5 text-xs rounded border border-amber-500/30 text-amber-300 hover:bg-amber-500/10 inline-flex items-center gap-1">
                    <RefreshCw className="w-3 h-3" />Save reconciliation
                  </button>
                </div>
              </div>
            )}

            {/* Transaction entry */}
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Client ledgers · ${balance?.total.toFixed(2) || '0.00'} total</div>
              <button onClick={() => setShowTxnForm(v => !v)} className="px-2.5 py-1 text-xs rounded bg-amber-500 text-black font-semibold hover:bg-amber-400 inline-flex items-center gap-1">
                <Plus className="w-3 h-3" />Transaction
              </button>
            </div>

            {showTxnForm && (
              <div className="grid grid-cols-12 gap-2 p-3 bg-black/30 rounded border border-white/10">
                <select value={txnForm.kind} onChange={e => setTxnForm({ ...txnForm, kind: e.target.value as 'deposit' | 'disbursement' })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
                  <option value="deposit">Deposit (retainer)</option>
                  <option value="disbursement">Disbursement</option>
                </select>
                <select value={txnForm.matterId} onChange={e => setTxnForm({ ...txnForm, matterId: e.target.value })} className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
                  <option value="">Matter *</option>
                  {matters.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <input type="number" step="0.01" value={txnForm.amount} onChange={e => setTxnForm({ ...txnForm, amount: e.target.value })} placeholder="Amount *" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
                <input value={txnForm.checkNumber} onChange={e => setTxnForm({ ...txnForm, checkNumber: e.target.value })} placeholder="Check #" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
                {txnForm.kind === 'disbursement' && (
                  <input value={txnForm.payee} onChange={e => setTxnForm({ ...txnForm, payee: e.target.value })} placeholder="Payee" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                )}
                <input value={txnForm.memo} onChange={e => setTxnForm({ ...txnForm, memo: e.target.value })} placeholder="Memo" className={cn('px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white', txnForm.kind === 'disbursement' ? 'col-span-5' : 'col-span-9')} />
                <button onClick={submitTxn} className="col-span-3 px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400 inline-flex items-center justify-center gap-1">
                  {txnForm.kind === 'deposit' ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />}
                  Post
                </button>
              </div>
            )}

            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase text-gray-500 border-b border-white/5">
                <tr><th className="text-left py-1.5">Matter</th><th className="text-left">Client</th><th className="text-right">Deposits</th><th className="text-right">Disbursements</th><th className="text-right">Balance</th></tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {balance?.byMatter.length === 0 && (
                  <tr><td colSpan={5} className="py-6 text-center text-gray-500 italic">No trust ledger activity yet.</td></tr>
                )}
                {balance?.byMatter.map(b => (
                  <tr key={b.matterId} className="hover:bg-white/[0.03]">
                    <td className="py-1.5 text-white">{b.matterName}</td>
                    <td className="text-gray-300">{b.clientName || '—'}</td>
                    <td className="text-right font-mono tabular-nums text-emerald-300">${b.deposits.toFixed(2)}</td>
                    <td className="text-right font-mono tabular-nums text-rose-300">${b.disbursements.toFixed(2)}</td>
                    <td className="text-right font-mono tabular-nums text-white">${b.balance.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !loading && accounts.length === 0 ? (
          <div className="p-10 text-center text-xs text-gray-500"><Scale className="w-6 h-6 mx-auto mb-2 opacity-30" />Create a trust account to start managing client funds.</div>
        ) : (
          <div className="flex items-center justify-center py-10 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        )}
      </div>
    </div>
  );
}

export default TrustAccountsPanel;
