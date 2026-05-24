'use client';

import { useEffect, useState, useCallback } from 'react';
import { CreditCard, Loader2, Receipt, RotateCcw, Gavel, FileText, Plus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Permit { id: string; recordNumber: string; feeUsd: number; paid: boolean; kind: string }
interface Fine { id: string; payerName: string; reason: string; amountUsd: number; paid: boolean; caseNumber: string; issuedAt: string }
interface Payment {
  id: string; kind: 'permit' | 'fine'; refId: string; amountUsd: number; description: string;
  status: 'pending' | 'succeeded' | 'refunded'; createdAt: string; confirmedAt?: string;
  cardLast4?: string; receiptNumber?: string; refundedAt?: string; refundReason?: string;
}

const STATUS_COLOUR: Record<Payment['status'], string> = {
  pending: 'bg-amber-500/15 text-amber-300',
  succeeded: 'bg-emerald-500/15 text-emerald-300',
  refunded: 'bg-rose-500/15 text-rose-300',
};

function money(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export function PaymentsPanel() {
  const [permits, setPermits] = useState<Permit[]>([]);
  const [fines, setFines] = useState<Fine[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [fineForm, setFineForm] = useState({ payerName: '', reason: '', amountUsd: '', caseNumber: '' });
  const [checkout, setCheckout] = useState<Payment | null>(null);
  const [card, setCard] = useState({ methodToken: '', cardLast4: '' });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [p, f, pay] = await Promise.all([
        lensRun({ domain: 'government', action: 'permits-list', input: {} }),
        lensRun({ domain: 'government', action: 'fines-list', input: {} }),
        lensRun({ domain: 'government', action: 'payments-list', input: {} }),
      ]);
      setPermits((p.data?.result?.permits || []) as Permit[]);
      setFines((f.data?.result?.fines || []) as Fine[]);
      setPayments((pay.data?.result?.payments || []) as Payment[]);
    } catch (e) { console.error('[Payments] refresh', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function createFine() {
    if (!fineForm.payerName.trim() || !fineForm.reason.trim() || !(Number(fineForm.amountUsd) > 0)) return;
    try {
      await lensRun({ domain: 'government', action: 'fines-create', input: { ...fineForm, amountUsd: Number(fineForm.amountUsd) } });
      setFineForm({ payerName: '', reason: '', amountUsd: '', caseNumber: '' });
      await refresh();
    } catch (e) { console.error('[Payments] createFine', e); }
  }

  async function startCheckout(kind: 'permit' | 'fine', refId: string) {
    try {
      const res = await lensRun({ domain: 'government', action: 'payments-checkout', input: { kind, refId } });
      if (res.data?.ok === false) { alert(res.data?.error); return; }
      setCheckout((res.data?.result?.payment || null) as Payment | null);
      setCard({ methodToken: '', cardLast4: '' });
    } catch (e) { console.error('[Payments] checkout', e); }
  }

  async function confirmPayment() {
    if (!checkout) return;
    if (!card.methodToken.trim() || card.cardLast4.replace(/\D/g, '').length !== 4) return;
    setBusy(true);
    try {
      const res = await lensRun({ domain: 'government', action: 'payments-confirm', input: { paymentId: checkout.id, methodToken: card.methodToken, cardLast4: card.cardLast4 } });
      if (res.data?.ok === false) { alert(res.data?.error); return; }
      setCheckout(null);
      await refresh();
    } catch (e) { console.error('[Payments] confirm', e); }
    finally { setBusy(false); }
  }

  async function refund(paymentId: string) {
    const reason = prompt('Refund reason?');
    if (reason === null) return;
    try {
      const res = await lensRun({ domain: 'government', action: 'payments-refund', input: { paymentId, reason } });
      if (res.data?.ok === false) { alert(res.data?.error); return; }
      await refresh();
    } catch (e) { console.error('[Payments] refund', e); }
  }

  const unpaidPermits = permits.filter(p => !p.paid && p.feeUsd > 0);
  const unpaidFines = fines.filter(f => !f.paid && f.amountUsd > 0);
  const collected = payments.filter(p => p.status === 'succeeded').reduce((s, p) => s + p.amountUsd, 0);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <CreditCard className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Online payments</span>
        <span className="ml-auto text-[10px] text-emerald-300">{money(collected)} collected</span>
      </header>

      {/* Issue a fine */}
      <div className="p-3 border-b border-white/10">
        <div className="text-[10px] uppercase text-gray-400 mb-1.5 inline-flex items-center gap-1"><Gavel className="w-3 h-3" />Issue a fine / citation</div>
        <div className="grid grid-cols-6 gap-2">
          <input value={fineForm.payerName} onChange={e => setFineForm({ ...fineForm, payerName: e.target.value })} placeholder="Payer name" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={fineForm.reason} onChange={e => setFineForm({ ...fineForm, reason: e.target.value })} placeholder="Reason" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={fineForm.caseNumber} onChange={e => setFineForm({ ...fineForm, caseNumber: e.target.value })} placeholder="Case #" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input value={fineForm.amountUsd} onChange={e => setFineForm({ ...fineForm, amountUsd: e.target.value })} placeholder="$ Amount" type="number" min="0" step="0.01" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        </div>
        <button onClick={createFine} className="mt-2 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center gap-1"><Plus className="w-3 h-3" />Issue fine</button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</div>
      ) : (
        <div className="p-3 space-y-3">
          {/* Outstanding charges */}
          <div>
            <div className="text-[10px] uppercase text-gray-400 mb-1.5">Outstanding charges</div>
            {unpaidPermits.length === 0 && unpaidFines.length === 0 ? (
              <div className="text-xs text-gray-400 py-2">No unpaid permit fees or fines.</div>
            ) : (
              <ul className="space-y-1.5">
                {unpaidPermits.map(p => (
                  <li key={p.id} className="flex items-center gap-2 px-2 py-1.5 bg-white/[0.03] rounded">
                    <FileText className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <span className="text-xs text-white flex-1 truncate">{p.recordNumber} — {p.kind}</span>
                    <span className="text-xs text-amber-300 font-mono">{money(p.feeUsd)}</span>
                    <button onClick={() => startCheckout('permit', p.id)} className="px-2 py-1 text-[10px] rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30">Pay</button>
                  </li>
                ))}
                {unpaidFines.map(f => (
                  <li key={f.id} className="flex items-center gap-2 px-2 py-1.5 bg-white/[0.03] rounded">
                    <Gavel className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    <span className="text-xs text-white flex-1 truncate">{f.reason} — {f.payerName}</span>
                    <span className="text-xs text-amber-300 font-mono">{money(f.amountUsd)}</span>
                    <button onClick={() => startCheckout('fine', f.id)} className="px-2 py-1 text-[10px] rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30">Pay</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Payment ledger */}
          <div>
            <div className="text-[10px] uppercase text-gray-400 mb-1.5 inline-flex items-center gap-1"><Receipt className="w-3 h-3" />Payment ledger</div>
            {payments.length === 0 ? (
              <div className="text-xs text-gray-400 py-2">No payments processed yet.</div>
            ) : (
              <ul className="divide-y divide-white/5 max-h-56 overflow-y-auto">
                {payments.map(p => (
                  <li key={p.id} className="py-2 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-white truncate">{p.description}</div>
                      <div className="text-[10px] text-gray-400">
                        {p.receiptNumber || p.id} {p.cardLast4 && `· card ••${p.cardLast4}`}
                        {p.refundReason && ` · refund: ${p.refundReason}`}
                      </div>
                    </div>
                    <span className="text-xs font-mono text-white">{money(p.amountUsd)}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${STATUS_COLOUR[p.status]}`}>{p.status}</span>
                    {p.status === 'succeeded' && (
                      <button onClick={() => refund(p.id)} className="p-1 text-rose-400 hover:text-rose-300" title="Refund"><RotateCcw className="w-3 h-3" /></button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Checkout modal */}
      {checkout && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setCheckout(null)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="bg-[#0d1117] border border-cyan-500/30 rounded-lg w-full max-w-sm p-4" onClick={e => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <h3 className="text-sm font-semibold text-white mb-1">Checkout</h3>
            <p className="text-xs text-gray-400 mb-3">{checkout.description}</p>
            <div className="text-2xl font-bold text-emerald-300 mb-3">{money(checkout.amountUsd)}</div>
            <label className="block text-[10px] uppercase text-gray-400 mb-1">Payment method token</label>
            <input value={card.methodToken} onChange={e => setCard({ ...card, methodToken: e.target.value })} placeholder="tok_..." className="w-full mb-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
            <label className="block text-[10px] uppercase text-gray-400 mb-1">Card last 4 digits</label>
            <input value={card.cardLast4} onChange={e => setCard({ ...card, cardLast4: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="4242" maxLength={4} className="w-full mb-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
            <div className="flex gap-2">
              <button onClick={() => setCheckout(null)} className="flex-1 px-3 py-1.5 text-xs rounded bg-white/5 text-gray-300 hover:bg-white/10">Cancel</button>
              <button onClick={confirmPayment} disabled={busy || !card.methodToken.trim() || card.cardLast4.length !== 4} className="flex-1 px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 disabled:opacity-40 inline-flex items-center justify-center gap-1">
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <CreditCard className="w-3 h-3" />}Pay {money(checkout.amountUsd)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PaymentsPanel;
