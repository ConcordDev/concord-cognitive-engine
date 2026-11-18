'use client';

/**
 * OrdersView — Shopify-admin style order list with a detail pane.
 *
 * List: retail.orders-list (newest first, server-capped at 100), filterable
 * by status and searchable by order number / customer / SKU. Detail: lines,
 * totals, tenders, customer, Stripe reference, and the two real
 * post-sale actions — refund (retail.refunds-create, which moves the order's
 * status + refundedAmount and optionally restocks) and start a return
 * (retail.returns-create, an RMA that never refunds by itself).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Loader2, RotateCcw, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { retail, money, timeAgo, tenderLabel, orderStatusLabel, round2, type Order } from './retailApi';

type Filter = 'all' | 'paid' | 'partially_refunded' | 'refunded';

export function OrdersView({ onOpenReturns }: { onOpenReturns: () => void }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await retail<{ orders: Order[] }>('orders-list');
    if (r.ok && r.result) { setOrders(r.result.orders); setState('ready'); }
    else { setState('error'); setErr(r.error || 'Could not load orders.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return orders.filter((o) =>
      (filter === 'all' || (o.status || 'paid') === filter) &&
      (!s || (o.number || o.id).toLowerCase().includes(s) || (o.customerName || '').toLowerCase().includes(s) || o.lines.some((l) => l.sku.toLowerCase().includes(s) || l.name.toLowerCase().includes(s))),
    );
  }, [orders, filter, q]);

  const selected = orders.find((o) => o.id === selectedId) || null;
  useEffect(() => {
    if (!selectedId && visible.length) setSelectedId(visible[0].id);
  }, [visible, selectedId]);

  const counts = useMemo(() => ({
    all: orders.length,
    paid: orders.filter((o) => (o.status || 'paid') === 'paid').length,
    partially_refunded: orders.filter((o) => o.status === 'partially_refunded').length,
    refunded: orders.filter((o) => o.status === 'refunded').length,
  }), [orders]);

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <section className="flex min-h-0 flex-1 flex-col border-white/[0.06] lg:max-w-[560px] lg:border-r" aria-label="Order list">
        <div className="flex items-center gap-2 px-4 pt-3">
          <label className="relative flex-1">
            <span className="sr-only">Search orders</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order #, customer, SKU" className="h-9 w-full rounded-lg border border-white/10 bg-white/[0.03] pl-9 pr-3 text-[13px] text-zinc-100 placeholder:text-zinc-600 focus:border-white/25 focus:outline-none" />
          </label>
        </div>
        <div className="flex gap-1 overflow-x-auto px-4 py-2" role="tablist" aria-label="Order status">
          {([['all', 'All'], ['paid', 'Paid'], ['partially_refunded', 'Partly refunded'], ['refunded', 'Refunded']] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={filter === id} onClick={() => setFilter(id)}
              className={cn('whitespace-nowrap rounded-md px-2.5 py-1 text-[12px]', filter === id ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200')}>
              {label} <span className="font-mono opacity-60">{counts[id]}</span>
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={state === 'loading'}>
          {state === 'loading' ? (
            <div className="space-y-1 px-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded bg-white/[0.03]" />)}</div>
          ) : state === 'error' ? (
            <div role="alert" className="m-4 rounded-lg bg-rose-500/10 p-3 text-[13px] text-rose-200">{err} <button type="button" onClick={load} className="ml-2 underline">Retry</button></div>
          ) : orders.length === 0 ? (
            <p className="px-4 py-12 text-center text-[13px] text-zinc-500">No orders yet. Sales rung up at the register land here.</p>
          ) : visible.length === 0 ? (
            <p className="px-4 py-12 text-center text-[13px] text-zinc-500">No orders match.</p>
          ) : (
            <table className="w-full text-[13px] tabular-nums">
              <thead className="sticky top-0 bg-zinc-950 text-left text-[11px] text-zinc-500">
                <tr><th className="px-4 py-2 font-normal">Order</th><th className="px-2 py-2 font-normal">Customer</th><th className="px-2 py-2 font-normal">Status</th><th className="px-4 py-2 text-right font-normal">Total</th></tr>
              </thead>
              <tbody>
                {visible.map((o) => {
                  const st = orderStatusLabel(o);
                  return (
                    <tr key={o.id} onClick={() => setSelectedId(o.id)} onKeyDown={(e) => { if (e.key === 'Enter') setSelectedId(o.id); }} tabIndex={0} aria-selected={o.id === selectedId}
                      className={cn('cursor-pointer border-t border-white/[0.04] outline-none focus-visible:bg-white/[0.05]', o.id === selectedId ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]')}>
                      <td className="px-4 py-2.5"><div className="font-mono text-zinc-100">{o.number || `#${o.id.slice(-6)}`}</div><div className="text-[11px] text-zinc-500">{timeAgo(o.completedAt)}</div></td>
                      <td className="max-w-[140px] truncate px-2 py-2.5 text-zinc-300">{o.customerName || <span className="text-zinc-600">Walk-in</span>}</td>
                      <td className="px-2 py-2.5"><StatusPill tone={st.tone}>{st.label}</StatusPill></td>
                      <td className="px-4 py-2.5 text-right font-mono text-zinc-100">{money(o.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="min-h-0 flex-1 overflow-y-auto" aria-label="Order detail">
        {selected ? <OrderDetail key={selected.id} order={selected} onChanged={load} onOpenReturns={onOpenReturns} /> : (
          <p className="px-6 py-16 text-center text-[13px] text-zinc-600">{orders.length ? 'Select an order.' : ''}</p>
        )}
      </section>
    </div>
  );
}

function StatusPill({ tone, children }: { tone: 'ok' | 'warn' | 'muted'; children: React.ReactNode }) {
  return (
    <span className={cn('inline-block rounded px-1.5 py-0.5 text-[11px]',
      tone === 'ok' && 'bg-emerald-500/10 text-emerald-300',
      tone === 'warn' && 'bg-amber-500/10 text-amber-300',
      tone === 'muted' && 'bg-white/[0.06] text-zinc-400')}>{children}</span>
  );
}

const REFUND_REASONS = [
  ['customer_request', 'Customer request'],
  ['damaged', 'Damaged'],
  ['wrong_item', 'Wrong item'],
  ['not_as_described', 'Not as described'],
  ['other', 'Other'],
] as const;

function OrderDetail({ order, onChanged, onOpenReturns }: { order: Order; onChanged: () => void; onOpenReturns: () => void }) {
  const refundable = round2(order.total - (Number(order.refundedAmount) || 0));
  const [refundOpen, setRefundOpen] = useState(false);
  const [amount, setAmount] = useState(String(refundable));
  const [reason, setReason] = useState<string>('customer_request');
  const [restock, setRestock] = useState(true);
  const [busy, setBusy] = useState<null | 'refund' | 'return'>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const st = orderStatusLabel(order);

  const refund = async () => {
    const amt = Number(amount);
    if (!(amt > 0) || amt > refundable + 0.001) { setMsg({ tone: 'error', text: `Refund must be between $0.01 and ${money(refundable)}.` }); return; }
    setBusy('refund'); setMsg(null);
    const r = await retail<{ refund: { id: string; amount: number } }>('refunds-create', { orderId: order.id, amount: amt, reason, restock });
    setBusy(null);
    if (r.ok && r.result) { setMsg({ tone: 'ok', text: `Refunded ${money(r.result.refund.amount)}${restock ? ' and restocked' : ''}.` }); setRefundOpen(false); onChanged(); }
    else setMsg({ tone: 'error', text: r.error || 'Refund failed.' });
  };

  const startReturn = async () => {
    setBusy('return'); setMsg(null);
    const r = await retail<{ return: { rmaNumber: string } }>('returns-create', { orderId: order.id, reason, restock });
    setBusy(null);
    if (r.ok && r.result) setMsg({ tone: 'ok', text: `Return ${r.result.return.rmaNumber} opened — track it under Returns.` });
    else setMsg({ tone: 'error', text: r.error || 'Could not open a return.' });
  };

  return (
    <article className="px-6 py-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-mono text-[20px] text-zinc-50">{order.number || `#${order.id.slice(-6)}`}</h2>
          <p className="mt-1 text-[12px] text-zinc-500">{new Date(order.completedAt).toLocaleString()} · {order.customerName || 'Walk-in'}</p>
        </div>
        <StatusPill tone={st.tone}>{st.label}</StatusPill>
      </header>

      <table className="mt-5 w-full text-[13px] tabular-nums">
        <thead className="text-left text-[11px] text-zinc-500"><tr><th className="py-1.5 font-normal">Item</th><th className="py-1.5 text-right font-normal">Qty</th><th className="py-1.5 text-right font-normal">Price</th><th className="py-1.5 text-right font-normal">Total</th></tr></thead>
        <tbody>
          {order.lines.map((l) => (
            <tr key={l.sku} className="border-t border-white/[0.04]">
              <td className="py-2"><div className="text-zinc-100">{l.name}</div><div className="font-mono text-[11px] text-zinc-500">{l.sku}</div></td>
              <td className="py-2 text-right font-mono text-zinc-300">{l.qty}</td>
              <td className="py-2 text-right font-mono text-zinc-300">{money(l.unitPrice)}</td>
              <td className="py-2 text-right font-mono text-zinc-100">{money(l.qty * l.unitPrice)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ml-auto mt-3 max-w-xs space-y-1 text-[13px] tabular-nums">
        {order.subtotal != null && <Row k="Subtotal" v={money(order.subtotal)} />}
        {!!order.discount && <Row k="Discount" v={`−${money(order.discount)}`} />}
        {order.tax != null && <Row k={`Tax${order.taxRate != null ? ` · ${order.taxRate}%` : ''}`} v={money(order.tax)} />}
        <Row k="Total" v={money(order.total)} strong />
        {(order.tenders || []).map((t, i) => <Row key={i} k={tenderLabel(t)} v={money(t.amount)} muted />)}
        {!!order.change && <Row k="Change given" v={money(order.change)} muted />}
        {!!order.refundedAmount && <Row k="Refunded" v={`−${money(order.refundedAmount)}`} warn />}
      </dl>
      {order.stripePaymentIntentId && <p className="mt-2 text-right font-mono text-[11px] text-zinc-600">Stripe {order.stripePaymentIntentId}</p>}

      <div className="mt-6 flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
        <button type="button" onClick={() => setRefundOpen((o) => !o)} disabled={refundable <= 0} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white/[0.06] px-3 text-[13px] text-zinc-100 hover:bg-white/[0.1] disabled:opacity-40">
          <Undo2 className="h-4 w-4" /> Refund
        </button>
        <button type="button" onClick={startReturn} disabled={busy !== null} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] text-zinc-300 hover:bg-white/5 disabled:opacity-40">
          {busy === 'return' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Start return
        </button>
        <button type="button" onClick={onOpenReturns} className="h-9 rounded-lg px-3 text-[13px] text-zinc-500 hover:bg-white/5 hover:text-zinc-300">Returns →</button>
      </div>

      {refundOpen && (
        <form onSubmit={(e) => { e.preventDefault(); refund(); }} className="mt-3 grid max-w-md gap-3 rounded-lg border border-white/10 p-4">
          <label className="grid gap-1 text-[12px] text-zinc-400">Amount (up to {money(refundable)})
            <input type="number" min={0.01} step="0.01" max={refundable} value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9 rounded-md border border-white/10 bg-transparent px-2.5 font-mono text-[14px] text-zinc-100 focus:border-white/25 focus:outline-none" />
          </label>
          <label className="grid gap-1 text-[12px] text-zinc-400">Reason
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="h-9 rounded-md border border-white/10 bg-zinc-950 px-2 text-[13px] text-zinc-100">
              {REFUND_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[13px] text-zinc-300"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> Put items back in stock</label>
          <button type="submit" disabled={busy !== null} className="h-9 rounded-lg bg-zinc-100 text-[13px] font-semibold text-zinc-900 hover:bg-white disabled:opacity-40">
            {busy === 'refund' ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : `Refund ${money(Number(amount) || 0)}`}
          </button>
        </form>
      )}
      {msg && <div role={msg.tone === 'error' ? 'alert' : 'status'} className={cn('mt-3 max-w-md rounded-md px-3 py-2 text-[12px]', msg.tone === 'error' ? 'bg-rose-500/10 text-rose-200' : 'bg-emerald-500/10 text-emerald-200')}>{msg.text}</div>}
    </article>
  );
}

function Row({ k, v, strong, muted, warn }: { k: string; v: string; strong?: boolean; muted?: boolean; warn?: boolean }) {
  return (
    <div className={cn('flex justify-between', strong ? 'border-t border-white/[0.06] pt-1 font-semibold text-zinc-50' : muted ? 'text-zinc-500' : warn ? 'text-amber-300' : 'text-zinc-400')}>
      <dt>{k}</dt><dd className="font-mono">{v}</dd>
    </div>
  );
}

export default OrdersView;
