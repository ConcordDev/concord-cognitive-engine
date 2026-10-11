'use client';

import { useEffect, useState, useCallback } from 'react';
import { CreditCard, Loader2, Receipt, RotateCcw, Gavel, FileText, Plus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { StripePaymentForm } from '@/components/payment/StripePaymentForm';

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
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [stripeConfigured, setStripeConfigured] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
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
      setStripeConfigured(pay.data?.result?.stripeConfigured === true);
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

  function closeCheckout() {
    setCheckout(null);
    setClientSecret(null);
  }

  async function startCheckout(kind: 'permit' | 'fine', refId: string) {
    setPayError(null);
    setBusy(true);
    try {
      const res = await lensRun({ domain: 'government', action: 'payments-checkout', input: { kind, refId } });
      if (res.data?.ok === false || !res.data?.result?.payment) {
        setPayError(res.data?.error || 'Could not start checkout');
        return;
      }
      const payment = res.data.result.payment as Payment;
      const intent = await lensRun({
        domain: 'government',
        action: 'payments-create-intent',
        input: { paymentId: payment.id },
      });
      if (intent.data?.ok === false || !intent.data?.result?.clientSecret) {
        setCheckout(payment);
        setClientSecret(null);
        if (intent.data?.error && intent.data.error !== 'stripe_not_configured') {
          setPayError(intent.data.error);
        }
        return;
      }
      setCheckout(payment);
      setClientSecret(String(intent.data.result.clientSecret));
    } catch (e) {
      console.error('[Payments] checkout', e);
      setPayError('Could not start checkout');
    } finally {
      setBusy(false);
    }
  }

  async function onCardSuccess({ paymentIntentId }: { paymentIntentId: string }) {
    if (!checkout) return;
    setBusy(true);
    setPayError(null);
    try {
      const res = await lensRun({
        domain: 'government',
        action: 'payments-confirm',
        input: { paymentId: checkout.id, paymentIntentId },
      });
      if (res.data?.ok === false || !res.data?.result?.payment) {
        setPayError(res.data?.error || 'Payment was not verified. Nothing was marked paid.');
        return;
      }
      closeCheckout();
      await refresh();
    } catch (e) {
      console.error('[Payments] confirm', e);
      setPayError('Payment was not verified. Nothing was marked paid.');
    } finally {
      setBusy(false);
    }
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
          {!stripeConfigured && (
            <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100" role="status">
              Online payment is not configured. Card charges are unavailable, and this screen will not issue a receipt.
            </div>
          )}
          {payError && <p className="text-xs text-rose-300" role="alert">{payError}</p>}
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
                    {stripeConfigured && (
                      <button onClick={() => startCheckout('permit', p.id)} disabled={busy} className="px-2 py-1 text-[10px] rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40">Pay</button>
                    )}
                  </li>
                ))}
                {unpaidFines.map(f => (
                  <li key={f.id} className="flex items-center gap-2 px-2 py-1.5 bg-white/[0.03] rounded">
                    <Gavel className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    <span className="text-xs text-white flex-1 truncate">{f.reason} — {f.payerName}</span>
                    <span className="text-xs text-amber-300 font-mono">{money(f.amountUsd)}</span>
                    {stripeConfigured && (
                      <button onClick={() => startCheckout('fine', f.id)} disabled={busy} className="px-2 py-1 text-[10px] rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40">Pay</button>
                    )}
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
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={closeCheckout}>
          <div
            className="bg-[#0d1117] border border-cyan-500/30 rounded-lg w-full max-w-md p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gov-pay-title"
            onClick={e => e.stopPropagation()}
          >
            <h3 id="gov-pay-title" className="text-sm font-semibold text-white mb-1">
              {clientSecret ? 'Checkout' : 'Online payment not configured'}
            </h3>
            <p className="text-xs text-gray-400 mb-3">{checkout.description}</p>
            <div className="text-2xl font-bold text-emerald-300 mb-3">{money(checkout.amountUsd)}</div>
            {clientSecret ? (
              <StripePaymentForm
                clientSecret={clientSecret}
                amountUsd={checkout.amountUsd}
                description={checkout.description}
                onSuccess={onCardSuccess}
                onCancel={closeCheckout}
              />
            ) : (
              <>
                <p className="text-xs text-amber-100 mb-3">
                  Online payment is not configured. No card was charged, and this {checkout.kind} stays unpaid.
                </p>
                <button onClick={closeCheckout} className="w-full px-3 py-1.5 text-xs rounded bg-white/5 text-gray-300 hover:bg-white/10">Close</button>
              </>
            )}
            {payError && <p className="mt-2 text-xs text-rose-300" role="alert">{payError}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export default PaymentsPanel;
