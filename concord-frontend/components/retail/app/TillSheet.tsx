'use client';

/**
 * Open the shop / close the till.
 *
 * Open: count the float into the drawer (retail.till-open).
 * Close: retail.till-status gives the expected drawer — float + cash taken
 * − change given, over the sales rung up while the till was open — then
 * the cashier counts the drawer and retail.till-close records the variance
 * and mints the day's ledger as a DTU. The live "over / short" line is the
 * counted figure against the SERVER's expected figure; the server's own
 * variance is what's recorded.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { retail, money, round2, timeAgo, type TillStatus, type TillSession } from './retailApi';

export function TillSheet({ status, onClose, onChanged }: { status: TillStatus; onClose: () => void; onChanged: (closed?: TillSession) => void }) {
  const opening = !status.open;
  const [amount, setAmount] = useState(opening ? String(status.lastClosed?.countedCash ?? '') : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState<TillSession | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const expected = status.figures?.expectedCash ?? 0;
  const counted = Number(amount);
  const preview = amount.trim() !== '' && Number.isFinite(counted) ? round2(counted - expected) : null;

  const submit = async () => {
    setBusy(true); setError(null);
    const r = opening
      ? await retail<{ session: TillSession }>('till-open', { float: amount.trim() === '' ? 0 : Number(amount) })
      : await retail<{ session: TillSession }>('till-close', { countedCash: Number(amount), note });
    setBusy(false);
    if (!r.ok || !r.result) { setError(r.error || 'That did not go through.'); return; }
    if (opening) { onChanged(); onClose(); }
    else { setClosed(r.result.session); onChanged(r.result.session); }
  };

  const f = status.figures;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={opening ? 'Open the till' : 'Close the till'}
        className="stall stall-board w-full max-w-[520px] overflow-hidden rounded-t-2xl border border-[color:var(--stall-line)] shadow-2xl focus:outline-none sm:rounded-2xl">
        <header className="flex items-start justify-between px-6 pt-5">
          <h2 className="font-[family-name:var(--stall-font-marker)] text-[26px] leading-tight">{closed ? 'Till closed' : opening ? 'Open the shop' : 'Close the till'}</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="rounded-md p-1.5 text-[color:var(--stall-chalk-dim)] hover:bg-white/5"><X className="h-5 w-5" /></button>
        </header>

        {closed ? (
          <div className="px-6 pb-6 pt-3">
            <p className="font-[family-name:var(--stall-font-hand)] text-[22px] text-[color:var(--stall-chalk-dim)]">
              {closed.variance === 0 ? 'Drawer balanced to the cent.' : (closed.variance ?? 0) > 0 ? `Over by ${money(closed.variance)}.` : `Short by ${money(Math.abs(closed.variance ?? 0))}.`}
            </p>
            <dl className="mt-4 space-y-1 font-[family-name:var(--stall-font-till)] text-[14px] tabular-nums">
              <Row k="Sales rung up" v={String(closed.figures?.orderCount ?? 0)} />
              <Row k="Gross sales" v={money(closed.figures?.grossSales)} />
              <Row k="Expected in drawer" v={money(closed.figures?.expectedCash)} />
              <Row k="Counted" v={money(closed.countedCash)} />
            </dl>
            <p className="mt-4 text-[12px] text-[color:var(--stall-chalk-faint)]">
              {closed.ledgerDtuId ? <>Today&rsquo;s ledger was saved as DTU <span className="font-mono text-[color:var(--stall-chalk-dim)]">{closed.ledgerDtuId}</span>.</> : `The till closed, but the ledger DTU wasn't saved (${closed.ledgerMintError || 'unknown error'}).`}
            </p>
            <button type="button" onClick={onClose} autoFocus className="mt-5 h-11 w-full rounded-lg bg-[color:var(--stall-brass)] text-[14px] font-semibold text-[color:var(--stall-ink)] hover:brightness-110">Done</button>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="px-6 pb-6 pt-2">
            {opening ? (
              <p className="text-[13px] text-[color:var(--stall-chalk-dim)]">Count the cash you&rsquo;re starting the day with. Sales rung up while the till is open are reconciled against it at close.</p>
            ) : (
              <>
                <p className="text-[13px] text-[color:var(--stall-chalk-dim)]">Open since {status.session ? timeAgo(status.session.openedAt) : '—'}. Count the drawer.</p>
                {f && (
                  <dl className="stall-paper mt-3 space-y-1 rounded-md px-4 py-3 font-[family-name:var(--stall-font-till)] text-[13px] tabular-nums">
                    <Row k="Float" v={money(status.session?.float)} ink />
                    <Row k={`Cash taken (${f.orderCount} sales)`} v={`+${money(f.cashIn)}`} ink />
                    <Row k="Change given" v={`−${money(f.changeGiven)}`} ink />
                    <div className="stall-dashed my-1" />
                    <Row k="Expected in drawer" v={money(f.expectedCash)} ink strong />
                    {(f.cardSales > 0 || f.giftCardSales > 0) && <Row k="Not in drawer: card / gift" v={`${money(f.cardSales)} / ${money(f.giftCardSales)}`} ink dim />}
                    {f.refundsOnSessionOrders > 0 && <Row k="Refunds on these sales" v={money(f.refundsOnSessionOrders)} ink dim />}
                  </dl>
                )}
              </>
            )}

            <label className="mt-4 block text-[12px] text-[color:var(--stall-chalk-dim)]" htmlFor="till-amount">{opening ? 'Float' : 'Counted cash'}</label>
            <input id="till-amount" type="number" inputMode="decimal" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus
              className="mt-1 h-12 w-full rounded-lg border border-[color:var(--stall-line)] bg-black/20 px-3 font-[family-name:var(--stall-font-till)] text-[20px] text-[color:var(--stall-chalk)] focus:border-[color:var(--stall-brass)] focus:outline-none" />
            {!opening && preview !== null && (
              <p className={cn('mt-2 font-[family-name:var(--stall-font-hand)] text-[20px]', preview === 0 ? 'text-[color:var(--stall-leaf)]' : 'text-[color:var(--stall-brass)]')} role="status">
                {preview === 0 ? 'Balanced' : preview > 0 ? `Over by ${money(preview)}` : `Short by ${money(Math.abs(preview))}`}
              </p>
            )}
            {!opening && (
              <input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the ledger (optional)" maxLength={280}
                className="mt-3 h-10 w-full rounded-lg border border-[color:var(--stall-line)] bg-transparent px-3 text-[13px] text-[color:var(--stall-chalk)] placeholder:text-[color:var(--stall-chalk-faint)] focus:outline-none" />
            )}
            {error && <div role="alert" className="mt-3 rounded-md bg-[color:var(--stall-tomato-dim)] px-3 py-2 text-[12px] text-[color:var(--stall-tomato)]">{error}</div>}
            <button type="submit" disabled={busy || (!opening && amount.trim() === '')}
              className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[color:var(--stall-brass)] text-[15px] font-semibold text-[color:var(--stall-ink)] hover:brightness-110 disabled:opacity-40">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}{opening ? 'Open the shop' : 'Close the till & save the ledger'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function Row({ k, v, ink, strong, dim }: { k: string; v: string; ink?: boolean; strong?: boolean; dim?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-3', strong && 'font-bold', dim && (ink ? 'text-[color:var(--stall-ink-dim)]' : 'text-[color:var(--stall-chalk-faint)]'))}>
      <dt>{k}</dt><dd>{v}</dd>
    </div>
  );
}

export default TillSheet;
