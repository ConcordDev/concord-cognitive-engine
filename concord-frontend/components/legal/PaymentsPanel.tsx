'use client';

/**
 * PaymentsPanel — client payment portal (Clio Payments parity).
 *
 * Records real payments against an invoice or a general matter credit/retainer
 * (card/ach/check/wire/cash, with a real card-processing-fee deduction),
 * shows the payment ledger, and shows the client-facing "what do I owe"
 * portal summary — distinct from the blunt open/paid toggle on Bills.
 */

import { useCallback, useEffect, useState } from 'react';
import { CreditCard, Loader2, Plus, Receipt, AlertCircle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Matter { id: string; name: string; clientName: string }
interface Invoice { id: string; number: string; matterId: string; matterName: string; clientName: string; total: number; status: string }
interface Payment {
  id: string; number: string; invoiceId: string | null; invoiceNumber: string | null;
  matterId: string | null; matterName: string; clientName: string;
  amount: number; method: string; processingFee: number; netAmount: number;
  memo: string; date: string; invoiceBalanceAfter?: number;
}
interface OpenInvoiceSummary {
  id: string; number: string; matterName: string; clientName: string;
  issuedAt: string; dueAt: string; total: number; paid: number; balance: number; overdue: boolean;
}

const METHODS = ['card', 'ach', 'check', 'wire', 'cash'];

export function PaymentsPanel() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [matters, setMatters] = useState<Matter[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [totals, setTotals] = useState({ total: 0, processingFees: 0, netReceived: 0 });
  const [portal, setPortal] = useState<{ openInvoices: OpenInvoiceSummary[]; totalDue: number; totalPaid: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<'invoice' | 'matter'>('invoice');
  const [invoiceId, setInvoiceId] = useState('');
  const [matterId, setMatterId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('card');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [i, m, p, portalR] = await Promise.all([
        lensRun({ domain: 'legal', action: 'invoices-list', input: { status: 'open' } }),
        lensRun({ domain: 'legal', action: 'matters-list', input: { status: 'open' } }),
        lensRun({ domain: 'legal', action: 'payments-list', input: {} }),
        lensRun({ domain: 'legal', action: 'payment-portal-summary', input: {} }),
      ]);
      setInvoices((i.data?.result?.invoices || []) as Invoice[]);
      setMatters((m.data?.result?.matters || []) as Matter[]);
      setPayments((p.data?.result?.payments || []) as Payment[]);
      setTotals({
        total: p.data?.result?.total || 0,
        processingFees: p.data?.result?.processingFees || 0,
        netReceived: p.data?.result?.netReceived || 0,
      });
      setPortal((portalR.data?.result as typeof portal) || null);
    } catch (e) { console.error('[Payments] refresh failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function recordPayment() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setError('Enter an amount greater than 0.'); return; }
    if (target === 'invoice' && !invoiceId) { setError('Pick an invoice.'); return; }
    if (target === 'matter' && !matterId) { setError('Pick a matter.'); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await lensRun({
        domain: 'legal', action: 'payment-record',
        input: {
          amount: amt, method,
          invoiceId: target === 'invoice' ? invoiceId : undefined,
          matterId: target === 'matter' ? matterId : undefined,
          memo: memo.trim() || undefined,
        },
      });
      if (r.data?.ok === false) { setError(r.data?.error || 'Failed to record payment'); return; }
      setAmount(''); setMemo(''); setInvoiceId(''); setMatterId('');
      await refresh();
    } catch (e) { console.error('[Payments] record failed', e); setError('Failed to record payment'); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      {/* Record a payment */}
      <div className="bg-[#0d1117] border border-amber-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-gray-200">Record a client payment</span>
        </header>
        <div className="p-3 grid grid-cols-12 gap-2">
          <div className="col-span-12 flex gap-1.5 text-[10px]">
            <button onClick={() => setTarget('invoice')} className={cn('px-2 py-1 rounded border', target === 'invoice' ? 'border-amber-500/50 bg-amber-500/15 text-amber-200' : 'border-white/10 text-gray-400')}>Apply to invoice</button>
            <button onClick={() => setTarget('matter')} className={cn('px-2 py-1 rounded border', target === 'matter' ? 'border-amber-500/50 bg-amber-500/15 text-amber-200' : 'border-white/10 text-gray-400')}>Matter credit / retainer</button>
          </div>
          {target === 'invoice' ? (
            <select value={invoiceId} onChange={e => setInvoiceId(e.target.value)} className="col-span-6 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
              <option value="">Pick an open invoice…</option>
              {invoices.map(inv => <option key={inv.id} value={inv.id}>{inv.number} — {inv.matterName} · ${inv.total.toFixed(2)}</option>)}
            </select>
          ) : (
            <select value={matterId} onChange={e => setMatterId(e.target.value)} className="col-span-6 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
              <option value="">Pick a matter…</option>
              {matters.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
          <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount $" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <select value={method} onChange={e => setMethod(e.target.value)} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            {METHODS.map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}
          </select>
          <input value={memo} onChange={e => setMemo(e.target.value)} placeholder="Memo (optional)" className="col-span-9 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={recordPayment} disabled={busy} className="col-span-3 px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400 disabled:opacity-40 inline-flex items-center justify-center gap-1">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}Record
          </button>
          {method === 'card' && (
            <p className="col-span-12 text-[10px] text-gray-400">Card payments incur a 2.9% processing fee, deducted from the net amount received — matches Concord's token-purchase fee rate.</p>
          )}
          {error && <div className="col-span-12 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded px-2 py-1.5 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5 shrink-0" />{error}</div>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Client portal: what's owed */}
        <div className="bg-[#0d1117] border border-amber-500/15 rounded-lg overflow-hidden">
          <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
            <Receipt className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-semibold text-gray-200">Portal — what clients owe</span>
          </header>
          <div className="p-3">
            {loading ? (
              <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
            ) : !portal || portal.openInvoices.length === 0 ? (
              <p className="text-xs text-gray-400 italic py-4 text-center">No open balances. Everything is paid up.</p>
            ) : (
              <>
                <div className="flex justify-between text-xs mb-2 pb-2 border-b border-white/5">
                  <span className="text-gray-400">Total due</span>
                  <span className="font-mono text-amber-200 font-bold">${portal.totalDue.toFixed(2)}</span>
                </div>
                <ul className="space-y-1 max-h-52 overflow-y-auto">
                  {portal.openInvoices.map(inv => (
                    <li key={inv.id} className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-[10px] text-gray-400 w-16 shrink-0">{inv.number}</span>
                      <span className="flex-1 truncate text-white">{inv.clientName || inv.matterName}</span>
                      {inv.overdue && <span className="text-[9px] uppercase text-rose-300 shrink-0">Overdue</span>}
                      <span className="font-mono text-amber-200 w-20 text-right shrink-0">${inv.balance.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>

        {/* Payment ledger */}
        <div className="bg-[#0d1117] border border-amber-500/15 rounded-lg overflow-hidden">
          <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-semibold text-gray-200">Payment ledger</span>
            <span className="ml-auto text-[10px] text-gray-400 font-mono">net ${totals.netReceived.toFixed(2)}</span>
          </header>
          <div className="p-3">
            {loading ? (
              <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
            ) : payments.length === 0 ? (
              <p className="text-xs text-gray-400 italic py-4 text-center">No payments recorded yet.</p>
            ) : (
              <ul className="space-y-1 max-h-52 overflow-y-auto">
                {payments.map(p => (
                  <li key={p.id} className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-[10px] text-gray-400 w-20 shrink-0">{p.date}</span>
                    <span className="flex-1 truncate text-white">{p.matterName || p.clientName || p.invoiceNumber}</span>
                    <span className="text-[9px] uppercase px-1 rounded bg-white/5 text-gray-400 shrink-0">{p.method}</span>
                    <span className="font-mono text-emerald-300 w-20 text-right shrink-0">${p.amount.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default PaymentsPanel;
