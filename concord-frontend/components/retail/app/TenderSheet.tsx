'use client';

/**
 * TenderSheet — take payment for the current sale.
 *
 * Split tender: any number of gift-card and cash tenders, then one
 * `retail.cart-tender` call. The server validates every gift card and
 * redeems it in the same handler as the order, so a failed sale never
 * spends a balance. Card is the full remaining balance through Stripe
 * (cart-create-payment-intent → Stripe Elements → cart-confirm-paid-with-
 * intent, which re-verifies the intent with Stripe server-side). When the
 * store has no valid Stripe key the server says so in plain words and the
 * sheet shows that, never a fake card success.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Banknote, Gift, CreditCard, Loader2, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StripePaymentForm } from '@/components/payment/StripePaymentForm';
import { retail, money, round2, tenderLabel, tzOffsetMinutes, type Cart, type CartTotals, type Order, type Tender } from './retailApi';

type Mode = 'cash' | 'gift' | 'card';

/** Cash buttons a cashier actually reaches for: exact, then the next bills up. */
export function quickCashAmounts(due: number): number[] {
  if (!(due > 0)) return [];
  const out = new Set<number>([round2(due)]);
  const whole = Math.ceil(due);
  if (whole > due + 0.001) out.add(whole);
  for (const step of [5, 10, 20, 50, 100]) {
    const v = Math.ceil(due / step) * step;
    if (v > due + 0.001) out.add(v);
  }
  return Array.from(out).sort((a, b) => a - b).slice(0, 5);
}

export function TenderSheet({ cart, totals, onClose, onComplete }: {
  cart: Cart;
  totals: CartTotals;
  onClose: () => void;
  onComplete: (order: Order) => void;
}) {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [mode, setMode] = useState<Mode>('cash');
  const [cashInput, setCashInput] = useState('');
  const [giftCode, setGiftCode] = useState('');
  const [giftBusy, setGiftBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<{ clientSecret: string; paymentIntentId: string; total: number } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const paid = round2(tenders.reduce((s, t) => s + t.amount, 0));
  const remaining = round2(Math.max(0, totals.total - paid));
  const change = round2(Math.max(0, paid - totals.total));
  const covered = paid >= totals.total - 0.005;
  const quick = useMemo(() => quickCashAmounts(remaining), [remaining]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const addCash = (amount: number) => {
    if (!(amount > 0)) return;
    setError(null);
    setTenders((t) => [...t, { kind: 'cash', amount: round2(amount) }]);
    setCashInput('');
  };

  const addGift = async () => {
    const code = giftCode.trim().toUpperCase();
    if (!code || remaining <= 0) return;
    if (tenders.some((t) => t.kind === 'gift_card' && t.code === code)) { setError(`${code} is already applied.`); return; }
    setGiftBusy(true); setError(null);
    const r = await retail<{ balance: number; status: string }>('gift-cards-balance', { code });
    setGiftBusy(false);
    if (!r.ok || !r.result) { setError(r.error || 'Gift card not found.'); return; }
    if (r.result.status !== 'active' || !(r.result.balance > 0)) { setError(`${code} has no balance (${r.result.status}).`); return; }
    const amount = round2(Math.min(r.result.balance, remaining));
    setTenders((t) => [...t, { kind: 'gift_card', code, amount }]);
    setGiftCode('');
  };

  const complete = async () => {
    if (!covered || busy) return;
    setBusy(true); setError(null);
    const r = await retail<{ order: Order }>('cart-tender', { cartId: cart.id, tenders, tzOffsetMinutes: tzOffsetMinutes() });
    setBusy(false);
    if (r.ok && r.result) onComplete(r.result.order);
    else setError(r.error || 'The sale did not go through.');
  };

  const startCard = async () => {
    setBusy(true); setError(null);
    const r = await retail<{ clientSecret: string; paymentIntentId: string; total: number }>('cart-create-payment-intent', { cartId: cart.id });
    setBusy(false);
    if (r.ok && r.result) setIntent(r.result);
    else setError(r.error || 'Card payments are unavailable.');
  };

  const onCardPaid = async ({ paymentIntentId }: { paymentIntentId: string }) => {
    setBusy(true); setError(null);
    const r = await retail<{ order: Order }>('cart-confirm-paid-with-intent', { cartId: cart.id, paymentIntentId, tzOffsetMinutes: tzOffsetMinutes() });
    setBusy(false);
    if (r.ok && r.result) onComplete(r.result.order);
    else setError(r.error || 'Card was charged but the order could not be recorded — check Stripe before retrying.');
  };

  const cardBlocked = tenders.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Take payment"
        className="stall stall-board flex max-h-[92vh] w-full max-w-[720px] flex-col overflow-hidden rounded-t-2xl border border-[color:var(--stall-line)] shadow-2xl focus:outline-none sm:rounded-2xl"
      >
        <header className="flex items-start justify-between border-b border-[color:var(--stall-line)] px-6 py-5">
          <div>
            <div className="text-[12px] uppercase tracking-wider text-[color:var(--stall-chalk-faint)]">{paid > 0 ? (covered ? 'Covered' : 'Remaining') : 'Amount due'}</div>
            <div className="mt-1 font-[family-name:var(--stall-font-hand)] text-[48px] font-bold leading-none tabular-nums">{money(paid > 0 && !covered ? remaining : totals.total)}</div>
            <div className="mt-2 text-[12px] text-[color:var(--stall-chalk-faint)]">
              {totals.itemCount} item{totals.itemCount === 1 ? '' : 's'}{cart.customerName ? ` · ${cart.customerName}` : ''}{change > 0 ? <span className="text-[color:var(--stall-leaf)]"> · change {money(change)}</span> : null}
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-md p-1.5 text-[color:var(--stall-chalk-faint)] hover:bg-white/5 hover:text-[color:var(--stall-chalk)]" aria-label="Close"><X className="h-5 w-5" /></button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto sm:grid-cols-[180px_1fr]">
          <nav className="flex gap-1 border-b border-[color:var(--stall-line)] p-3 sm:flex-col sm:border-b-0 sm:border-r" aria-label="Payment method">
            {([
              { id: 'cash', label: 'Cash', icon: Banknote },
              { id: 'gift', label: 'Gift card', icon: Gift },
              { id: 'card', label: 'Card', icon: CreditCard },
            ] as const).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                aria-pressed={mode === m.id}
                className={cn('flex flex-1 items-center gap-2 rounded-lg px-3 py-2.5 text-[13px] transition-colors sm:flex-none', mode === m.id ? 'bg-white/[0.08] text-[color:var(--stall-chalk)]' : 'text-[color:var(--stall-chalk-dim)] hover:bg-white/[0.04] hover:text-[color:var(--stall-chalk)]')}
              >
                <m.icon className="h-4 w-4" /> {m.label}
              </button>
            ))}
          </nav>

          <div className="p-5">
            {mode === 'cash' && (
              <div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {quick.map((v, i) => (
                    <button key={v} type="button" onClick={() => addCash(v)} disabled={remaining <= 0}
                      className="h-14 rounded-lg border border-[color:var(--stall-line)] font-[family-name:var(--stall-font-till)] text-[17px] font-bold tabular-nums text-[color:var(--stall-chalk)] hover:border-[color:var(--stall-leaf)] hover:bg-[color:var(--stall-leaf-dim)] disabled:opacity-40">
                      {i === 0 ? <span><span className="block font-sans text-[10px] uppercase tracking-wider text-[color:var(--stall-chalk-faint)]">Exact</span>{money(v)}</span> : money(v)}
                    </button>
                  ))}
                </div>
                <form onSubmit={(e) => { e.preventDefault(); addCash(Number(cashInput)); }} className="mt-3 flex gap-2">
                  <input type="number" inputMode="decimal" min={0} step="0.01" value={cashInput} onChange={(e) => setCashInput(e.target.value)}
                    aria-label="Other cash amount" placeholder="Other amount"
                    className="h-10 min-w-0 flex-1 rounded-lg border border-[color:var(--stall-line)] bg-transparent px-3 font-mono text-[14px] text-[color:var(--stall-chalk)] placeholder:font-sans placeholder:text-[color:var(--stall-chalk-faint)] focus:border-white/25 focus:outline-none" />
                  <button type="submit" disabled={!(Number(cashInput) > 0)} className="h-10 rounded-lg px-4 text-[13px] text-[color:var(--stall-chalk)] hover:bg-white/5 disabled:opacity-40">Add cash</button>
                </form>
              </div>
            )}

            {mode === 'gift' && (
              <form onSubmit={(e) => { e.preventDefault(); addGift(); }}>
                <label className="block text-[12px] text-[color:var(--stall-chalk-dim)]" htmlFor="tender-gift-code">Gift card code</label>
                <div className="mt-1.5 flex gap-2">
                  <input id="tender-gift-code" value={giftCode} onChange={(e) => setGiftCode(e.target.value.toUpperCase())} placeholder="GC-XXXX-XXXX" autoFocus
                    className="h-10 min-w-0 flex-1 rounded-lg border border-[color:var(--stall-line)] bg-transparent px-3 font-mono text-[14px] text-[color:var(--stall-chalk)] placeholder:text-[color:var(--stall-chalk-faint)] focus:border-white/25 focus:outline-none" />
                  <button type="submit" disabled={!giftCode.trim() || giftBusy || remaining <= 0} className="h-10 rounded-lg bg-white/[0.08] px-4 text-[13px] text-[color:var(--stall-chalk)] hover:bg-white/[0.12] disabled:opacity-40">
                    {giftBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
                  </button>
                </div>
                <p className="mt-2 text-[12px] text-[color:var(--stall-chalk-faint)]">Applies the card&rsquo;s balance up to what&rsquo;s left to pay. The balance is only spent when the sale completes.</p>
              </form>
            )}

            {mode === 'card' && (
              <div>
                {cardBlocked ? (
                  <p className="text-[13px] text-[color:var(--stall-chalk-dim)]">Card takes the whole sale. Remove the cash and gift card tenders to pay by card.</p>
                ) : intent ? (
                  <StripePaymentForm clientSecret={intent.clientSecret} amountUsd={intent.total} description={`Sale #${cart.id.slice(-6)}`} onSuccess={onCardPaid} onCancel={() => setIntent(null)} />
                ) : (
                  <>
                    <p className="text-[13px] text-[color:var(--stall-chalk-dim)]">Charge {money(totals.total)} to a card through Stripe. The order is recorded only after Stripe confirms the payment.</p>
                    <button type="button" onClick={startCard} disabled={busy} className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg bg-white/[0.08] px-4 text-[13px] text-[color:var(--stall-chalk)] hover:bg-white/[0.12] disabled:opacity-40">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} Start card payment
                    </button>
                  </>
                )}
              </div>
            )}

            {tenders.length > 0 && (
              <ul className="mt-5 space-y-1 border-t border-[color:var(--stall-line)] pt-4" aria-label="Tenders">
                {tenders.map((t, i) => (
                  <li key={i} className="flex items-center justify-between rounded-md px-2 py-1.5 text-[13px] hover:bg-white/[0.03]">
                    <span className="text-[color:var(--stall-chalk-dim)]">{tenderLabel(t)}</span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono tabular-nums text-[color:var(--stall-chalk)]">{money(t.amount)}</span>
                      <button type="button" onClick={() => setTenders((ts) => ts.filter((_, j) => j !== i))} disabled={busy} className="rounded p-1 text-[color:var(--stall-chalk-faint)] hover:text-[color:var(--stall-tomato)]" aria-label={`Remove ${tenderLabel(t)} tender`}><Trash2 className="h-3.5 w-3.5" /></button>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {error && <div role="alert" className="mt-4 rounded-md bg-[color:var(--stall-tomato-dim)] px-3 py-2 text-[12px] text-[color:var(--stall-tomato)]">{error}</div>}
          </div>
        </div>

        {mode !== 'card' && (
          <footer className="border-t border-[color:var(--stall-line)] px-6 py-4">
            <button type="button" onClick={complete} disabled={!covered || busy}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[color:var(--stall-leaf)] text-[14px] font-semibold text-[color:var(--stall-ink)] hover:brightness-105 disabled:bg-white/[0.06] disabled:text-[color:var(--stall-chalk-faint)]">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {covered ? (change > 0 ? `Complete sale · change ${money(change)}` : 'Complete sale') : `Add ${money(remaining)} more`}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

export default TenderSheet;
